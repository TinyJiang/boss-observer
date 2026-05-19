from __future__ import annotations

import json
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from boss_analysis.consumer.cls_search import (
  CLS_SEARCH_VERSION,
  ClsSearchConfig,
  TencentCloudApiClient,
  TencentCloudCredentials,
  build_search_payload,
  iter_log_values_from_search_response,
  load_cls_daily_summary_search_config,
  load_cls_summary_search_config,
  search_cls_log_values,
)


class FakeClsClient:
  def __init__(self, response):
    self.response = response
    self.calls = []

  def call(self, action, payload, *, version, region):
    self.calls.append({
      "action": action,
      "payload": payload,
      "version": version,
      "region": region,
    })
    if isinstance(self.response, list):
      index = len(self.calls) - 1
      return self.response[index]
    return self.response


class ClsSearchTests(unittest.TestCase):
  def test_load_cls_summary_config_reads_environment_without_logging_secrets(self):
    config = load_cls_summary_search_config({
      "CLS_SUMMARY_TOPIC_ID": "topic-summary",
      "TENCENTCLOUD_SECRET_ID": "secret-id",
      "TENCENTCLOUD_SECRET_KEY": "secret-key",
      "TENCENTCLOUD_TOKEN": "token-a",
      "CLS_SUMMARY_REGION": "ap-guangzhou",
      "CLS_SUMMARY_QUERY": "metric_name:boss_minute_chat",
      "CLS_SUMMARY_WINDOW_MINUTES": "30",
      "CLS_SUMMARY_LIMIT": "200",
      "CLS_SUMMARY_MAX_PAGES": "3",
      "CLS_SUMMARY_SORT": "asc",
    })

    self.assertEqual(config.topic_id, "topic-summary")
    self.assertEqual(config.region, "ap-guangzhou")
    self.assertEqual(config.query, "metric_name:boss_minute_chat")
    self.assertEqual(config.window_minutes, 30)
    self.assertEqual(config.limit, 200)
    self.assertEqual(config.max_pages, 3)
    self.assertEqual(config.sort, "asc")
    self.assertEqual(config.credentials.secret_id, "secret-id")
    self.assertEqual(config.credentials.token, "token-a")

  def test_load_cls_daily_summary_config_reads_daily_topic(self):
    config = load_cls_daily_summary_search_config({
      "CLS_DAILY_SUMMARY_TOPIC_ID": "topic-daily",
      "TENCENTCLOUD_SECRET_ID": "secret-id",
      "TENCENTCLOUD_SECRET_KEY": "secret-key",
      "CLS_DAILY_SUMMARY_REGION": "ap-shanghai",
      "CLS_DAILY_SUMMARY_LIMIT": "300",
    })

    self.assertEqual(config.topic_id, "topic-daily")
    self.assertEqual(config.region, "ap-shanghai")
    self.assertEqual(config.query, "*")
    self.assertEqual(config.window_mode, "today")
    self.assertEqual(config.limit, 300)

  def test_build_search_payload_uses_window_in_milliseconds(self):
    config = ClsSearchConfig(
      topic_id="topic-real",
      credentials=TencentCloudCredentials("secret-id", "secret-key"),
      query="*",
      window_minutes=15,
      limit=50,
    )

    payload = build_search_payload(
      config,
      now=datetime(2026, 5, 17, 10, 0, tzinfo=timezone.utc),
    )

    self.assertEqual(payload["TopicId"], "topic-real")
    self.assertEqual(payload["To"], 1779012000000)
    self.assertEqual(payload["From"], 1779011100000)
    self.assertEqual(payload["QueryString"], "*")
    self.assertEqual(payload["Limit"], 50)
    self.assertEqual(payload["QuerySyntax"], 1)

  def test_build_search_payload_can_use_local_today_window(self):
    config = ClsSearchConfig(
      topic_id="topic-real",
      credentials=TencentCloudCredentials("secret-id", "secret-key"),
      query="*",
      window_mode="today",
      timezone_name="Asia/Shanghai",
      limit=50,
    )

    payload = build_search_payload(
      config,
      now=datetime(2026, 5, 19, 2, 40, tzinfo=timezone.utc),
    )

    self.assertEqual(payload["To"], 1779158400000)
    self.assertEqual(payload["From"], 1779120000000)

  def test_api_client_builds_tc3_headers(self):
    client = TencentCloudApiClient(
      TencentCloudCredentials("secret-id", "secret-key", token="token-a"),
      endpoint="cls.tencentcloudapi.com",
      service="cls",
    )

    headers = client.build_headers(
      "SearchLog",
      b"{}",
      region="ap-guangzhou",
      timestamp=1779012000,
    )

    self.assertEqual(headers["X-TC-Action"], "SearchLog")
    self.assertEqual(headers["X-TC-Version"], CLS_SEARCH_VERSION)
    self.assertEqual(headers["X-TC-Region"], "ap-guangzhou")
    self.assertEqual(headers["X-TC-Token"], "token-a")
    self.assertIn("Credential=secret-id/2026-05-17/cls/tc3_request", headers["Authorization"])
    self.assertIn("SignedHeaders=content-type;host", headers["Authorization"])
    self.assertRegex(headers["Authorization"], r"Signature=[0-9a-f]{64}$")

  def test_iter_log_values_decodes_cls_log_json(self):
    log_json = {
      "event_id": "evt_real",
      "event_type": "candidate_list.card_exposed",
    }

    values = list(iter_log_values_from_search_response({
      "Response": {
        "Results": [
          {"LogJson": json.dumps(log_json)},
          {"RawLog": json.dumps({"contents": log_json})},
        ]
      }
    }))

    self.assertEqual(values[0]["event_id"], "evt_real")
    self.assertEqual(values[1]["contents"]["event_type"], "candidate_list.card_exposed")

  def test_search_cls_log_values_calls_searchlog(self):
    response = {
      "Response": {
        "ListOver": True,
        "Results": [
          {"LogJson": json.dumps({"event_id": "evt_real"})},
        ]
      }
    }
    fake_client = FakeClsClient(response)
    config = ClsSearchConfig(
      topic_id="topic-real",
      credentials=TencentCloudCredentials("secret-id", "secret-key"),
      region="ap-guangzhou",
    )

    values = search_cls_log_values(
      config,
      now=datetime(2026, 5, 17, 10, 0, tzinfo=timezone.utc),
      client=fake_client,
    )

    self.assertEqual(values, [{"event_id": "evt_real"}])
    self.assertEqual(fake_client.calls[0]["action"], "SearchLog")
    self.assertEqual(fake_client.calls[0]["version"], CLS_SEARCH_VERSION)
    self.assertEqual(fake_client.calls[0]["region"], "ap-guangzhou")

  def test_search_cls_log_values_paginates_until_list_over(self):
    responses = [
      {
        "Response": {
          "Context": "page-2",
          "ListOver": False,
          "Results": [
            {"LogJson": json.dumps({"event_id": "evt_page_1"})},
          ],
        }
      },
      {
        "Response": {
          "Context": "done",
          "ListOver": True,
          "Results": [
            {"LogJson": json.dumps({"event_id": "evt_page_2"})},
          ],
        }
      },
    ]
    fake_client = FakeClsClient(responses)
    config = ClsSearchConfig(
      topic_id="topic-real",
      credentials=TencentCloudCredentials("secret-id", "secret-key"),
      max_pages=5,
    )

    values = search_cls_log_values(
      config,
      now=datetime(2026, 5, 17, 10, 0, tzinfo=timezone.utc),
      client=fake_client,
    )

    self.assertEqual(values, [{"event_id": "evt_page_1"}, {"event_id": "evt_page_2"}])
    self.assertNotIn("Context", fake_client.calls[0]["payload"])
    self.assertEqual(fake_client.calls[1]["payload"]["Context"], "page-2")

  def test_search_cls_log_values_is_disabled_in_production(self):
    config = ClsSearchConfig(
      topic_id="topic-summary",
      credentials=TencentCloudCredentials("secret-id", "secret-key"),
    )

    with patch.dict(os.environ, {"APP_ENV": "production"}, clear=False):
      with self.assertRaisesRegex(RuntimeError, "disabled in production"):
        search_cls_log_values(
          config,
          now=datetime(2026, 5, 17, 10, 0, tzinfo=timezone.utc),
          client=FakeClsClient({"Response": {"Results": []}}),
        )

  def test_iter_log_values_raises_cls_error(self):
    with self.assertRaisesRegex(RuntimeError, "FailedOperation"):
      list(iter_log_values_from_search_response({
        "Response": {
          "Error": {
            "Code": "FailedOperation.QueryError",
            "Message": "bad query",
          }
        }
      }))


if __name__ == "__main__":
  unittest.main()
