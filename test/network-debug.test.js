import test from "node:test";
import assert from "node:assert/strict";

import {
  appendNetworkDebugRequest,
  classifyNetworkDebugRequest,
  clearNetworkDebugRequests,
  createEmptyNetworkDebugState,
  filterNetworkDebugRequests,
  isGeekDetailInfoUrl,
  sanitizeNetworkDebugRequest,
  setNetworkDebugEnabled
} from "../extension/src/shared/network-debug.js";

test("network debug state starts disabled and local-only", () => {
  const state = createEmptyNetworkDebugState();

  assert.equal(state.enabled, false);
  assert.equal(state.requestCount, 0);
  assert.deepEqual(state.recentRequests, []);
});

test("network debug control toggles capture state", () => {
  const started = setNetworkDebugEnabled(createEmptyNetworkDebugState(), true, {
    now: () => "2026-05-13T11:30:00.000+08:00"
  });
  const stopped = setNetworkDebugEnabled(started, false, {
    now: () => "2026-05-13T11:31:00.000+08:00"
  });

  assert.equal(started.enabled, true);
  assert.equal(started.startedAt, "2026-05-13T11:30:00.000+08:00");
  assert.equal(stopped.enabled, false);
  assert.equal(stopped.stoppedAt, "2026-05-13T11:31:00.000+08:00");
});

test("network debug request previews are truncated and contact-redacted", () => {
  const request = sanitizeNetworkDebugRequest({
    id: "xhr_1",
    type: "xhr",
    method: "post",
    url: "https://www.zhipin.com/wapi/zpgeek/resume/detail",
    status: 200,
    ok: true,
    responseContentType: "application/json",
    responseBodyPreview: "a".repeat(40),
    requestBodyPreview: "phone=13800000000"
  }, {
    maxPreviewChars: 32
  });

  assert.equal(request.type, "xhr");
  assert.equal(request.method, "POST");
  assert.equal(request.category, "other");
  assert.equal(request.responseBodyPreview, `${"a".repeat(32)}...`);
  assert.equal(request.responseBodyTruncated, true);
  assert.equal(request.requestBodyPreview, "phone=[redacted_phone]");
});

test("network debug keeps detail API response structure with contact fields redacted", () => {
  const request = sanitizeNetworkDebugRequest({
    id: "xhr_detail",
    type: "xhr",
    method: "GET",
    url: "https://www.zhipin.com/wapi/zpjob/view/geek/info/v2?expectId=1",
    status: 200,
    ok: true,
    responseContentType: "application/json",
    responseBodyPreview: JSON.stringify({
      code: 0,
      zpData: {
        encryptGeekDetailInfo: "encrypted_blob",
        name: "林先生",
        phone: "13800000000",
        weixin: "wx-test",
        advantage: "熟悉微信运营，可独立负责销售转化",
        nested: {
          email: "candidate@example.com"
        }
      }
    })
  });

  const parsed = JSON.parse(request.responseBodyPreview);

  assert.equal(isGeekDetailInfoUrl(request.url), true);
  assert.equal(request.category, "candidate_detail");
  assert.equal(parsed.zpData.name, "林先生");
  assert.equal(parsed.zpData.phone, "[redacted_contact]");
  assert.equal(parsed.zpData.weixin, "[redacted_contact]");
  assert.equal(parsed.zpData.advantage, "[redacted_contact_text]");
  assert.equal(parsed.zpData.nested.email, "[redacted_contact]");
});

test("network debug still blanks non-detail previews with contact keywords", () => {
  const request = sanitizeNetworkDebugRequest({
    id: "xhr_other",
    type: "xhr",
    method: "GET",
    url: "https://www.zhipin.com/wapi/other",
    status: 200,
    ok: true,
    responseBodyPreview: "{\"message\":\"包含微信字段\"}"
  });

  assert.equal(request.responseBodyPreview, "");
});

test("network debug classifies known BOSS request categories by URL", () => {
  assert.equal(classifyNetworkDebugRequest({
    url: "https://www.zhipin.com/wapi/zpjob/view/geek/info/v2?expectId=1"
  }), "candidate_detail");
  assert.equal(classifyNetworkDebugRequest({
    url: "https://www.zhipin.com/wapi/zpitem/web/boss/search/getRelatedInfo?securityId=1"
  }), "candidate_list");
  assert.equal(classifyNetworkDebugRequest({
    url: "https://www.zhipin.com/wapi/zpitem/web/rec/showCard?encryptJobId=1"
  }), "candidate_list");
  assert.equal(classifyNetworkDebugRequest({
    url: "https://www.zhipin.com/wapi/zpjob/job/search/job/list"
  }), "job_list");
  assert.equal(classifyNetworkDebugRequest({
    url: "https://www.zhipin.com/wapi/zpboss/h5/mate/remarkList.json"
  }), "remark");
  assert.equal(classifyNetworkDebugRequest({
    url: "https://www.zhipin.com/wapi/zpitem/web/push/get?source=10"
  }), "page_support");
  assert.equal(classifyNetworkDebugRequest({
    url: "https://apm-fe.zhipin.com/wapi/zpApm/actionLog/fe/common.json"
  }), "analytics");
  assert.equal(classifyNetworkDebugRequest({
    url: "https://static.zhipin.com/assets/zhipin/wasm/resume/wasm_canvas_bg-1.0.2-5081.wasm"
  }), "static_asset");
  assert.equal(classifyNetworkDebugRequest({
    url: "https://www.zhipin.com/wapi/unknown"
  }), "other");
});

test("network debug filters requests by known category", () => {
  const requests = [
    sanitizeNetworkDebugRequest({
      id: "detail",
      url: "https://www.zhipin.com/wapi/zpjob/view/geek/info/v2?expectId=1"
    }),
    sanitizeNetworkDebugRequest({
      id: "list",
      url: "https://www.zhipin.com/wapi/zpitem/web/boss/search/getRelatedInfo?securityId=1"
    }),
    sanitizeNetworkDebugRequest({
      id: "unknown",
      url: "https://www.zhipin.com/wapi/unknown"
    })
  ];

  assert.deepEqual(filterNetworkDebugRequests(requests, "candidate_detail").map((request) => request.id), ["detail"]);
  assert.deepEqual(filterNetworkDebugRequests(requests, "candidate_list").map((request) => request.id), ["list"]);
  assert.deepEqual(filterNetworkDebugRequests(requests, "other").map((request) => request.id), ["unknown"]);
  assert.deepEqual(filterNetworkDebugRequests(requests, "all").map((request) => request.id), ["detail", "list", "unknown"]);
  assert.deepEqual(filterNetworkDebugRequests(requests, "missing").map((request) => request.id), ["detail", "list", "unknown"]);
});

test("network debug appends recent requests without touching formal events", () => {
  const initial = {
    ...createEmptyNetworkDebugState(),
    maxRecentRequests: 2
  };
  const first = appendNetworkDebugRequest(initial, {
    id: "fetch_1",
    url: "https://www.zhipin.com/api/first",
    responseBodyPreview: "{\"ok\":true}"
  }, {
    now: () => "2026-05-13T11:30:01.000+08:00"
  });
  const second = appendNetworkDebugRequest(first, {
    id: "xhr_2",
    type: "xhr",
    url: "https://www.zhipin.com/api/second"
  });
  const third = appendNetworkDebugRequest(second, {
    id: "xhr_3",
    type: "xhr",
    url: "https://www.zhipin.com/api/third"
  });

  assert.equal(third.requestCount, 3);
  assert.deepEqual(third.recentRequests.map((request) => request.id), ["xhr_3", "xhr_2"]);

  const cleared = clearNetworkDebugRequests(third);
  assert.equal(cleared.requestCount, 0);
  assert.deepEqual(cleared.recentRequests, []);
});
