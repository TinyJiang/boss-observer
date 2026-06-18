from __future__ import annotations

import unittest
from typing import Any

from boss_analysis.feishu.bitable import FeishuBitableClient, FeishuBitableConfig


class FakeWikiResolvingFeishuClient(FeishuBitableClient):
  def __init__(self, config: FeishuBitableConfig) -> None:
    super().__init__(config)
    self.requests: list[tuple[str, str, dict[str, Any]]] = []

  def _request(self, method: str, path: str, **kwargs):
    query = dict(kwargs.get("query") or {})
    self.requests.append((method, path, query))
    if path == "/open-apis/wiki/v2/spaces/get_node":
      return {
        "code": 0,
        "data": {
          "node": {
            "obj_type": "bitable",
            "obj_token": "bascn-target",
          },
        },
      }
    if path == "/open-apis/bitable/v1/apps/bascn-target/tables/tbl-target/records":
      return {"code": 0, "data": {"items": [], "has_more": False}}
    raise AssertionError(f"unexpected request path: {path}")


class FeishuBitableTests(unittest.TestCase):
  def test_config_accepts_wiki_node_token_when_app_token_is_missing(self):
    config = FeishuBitableConfig.from_env({
      "FEISHU_APP_ID": "cli_test",
      "FEISHU_APP_SECRET": "secret",
      "FEISHU_BITABLE_WIKI_NODE_TOKEN": "wiki-node",
    })

    self.assertEqual(config.app_id, "cli_test")
    self.assertIsNone(config.app_token)
    self.assertEqual(config.wiki_node_token, "wiki-node")

  def test_table_records_resolve_bitable_app_token_from_wiki_node(self):
    client = FakeWikiResolvingFeishuClient(FeishuBitableConfig(
      app_id="cli_test",
      app_secret="secret",
      app_token=None,
      wiki_node_token="wiki-node",
    ))

    records = client.table("tbl-target").list_records()

    self.assertEqual(records, [])
    self.assertEqual(client.requests[0], (
      "GET",
      "/open-apis/wiki/v2/spaces/get_node",
      {"token": "wiki-node"},
    ))
    self.assertEqual(client.requests[1][1], "/open-apis/bitable/v1/apps/bascn-target/tables/tbl-target/records")


if __name__ == "__main__":
  unittest.main()
