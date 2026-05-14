import test from "node:test";
import assert from "node:assert/strict";

import {
  buildJobContextKey,
  buildJobContextSnapshot,
  extractJobContextFromDataset,
  extractJobContextFromUrl
} from "../extension/src/content/job-context.js";
import { JobContextProbe } from "../extension/src/content/job-context-probe.js";
import { EVENT_TYPES } from "../extension/src/shared/event-types.js";

test("job context can be extracted from BOSS frame url", () => {
  const context = extractJobContextFromUrl(
    "https://www.zhipin.com/web/frame/recommend/?jobid=80ddfe02037b9e230nd-3d27FlRT&status=0&source=0"
  );

  assert.equal(context.jobId, "80ddfe02037b9e230nd-3d27FlRT");
  assert.equal(context.jobIdSource, "url.jobid");
  assert.equal(context.jobStatus, "0");
  assert.equal(context.jobStatusSource, "url.status");
  assert.equal(context.confidence, "high");
});

test("job context can be extracted from dataset keys", () => {
  assert.deepEqual(
    extractJobContextFromDataset({
      jobId: "job-123",
      jobStatus: "online"
    }),
    {
      jobId: "job-123",
      jobIdSource: "dataset.jobId",
      jobStatus: "online",
      jobStatusSource: "dataset.jobStatus",
      sourceUrl: "",
      confidence: "high"
    }
  );
});

test("job context snapshot prefers dataset ids over urls", () => {
  const context = buildJobContextSnapshot({
    urls: ["https://www.zhipin.com/web/frame/recommend/?jobid=url-job&status=0"],
    datasets: [{ positionId: "dataset-job" }]
  });

  assert.equal(context.jobId, "dataset-job");
  assert.equal(context.jobIdSource, "dataset.positionId");
  assert.equal(buildJobContextKey(context), "dataset.positionId:dataset-job:");
});

test("job context probe emits detected once and changed on job switch", () => {
  let now = "2026-05-12T23:27:00.000+08:00";
  let detected = extractJobContextFromUrl(
    "https://www.zhipin.com/web/frame/recommend/?jobid=job-a&status=0"
  );
  const sessionContext = createSessionContext();
  const collector = createCollector(sessionContext);
  const probe = new JobContextProbe({
    collector,
    sessionContext,
    detectJobContext: () => detected,
    now: () => now
  });

  probe.scan("start");
  probe.scan("poll");
  now = "2026-05-12T23:28:00.000+08:00";
  detected = extractJobContextFromUrl(
    "https://www.zhipin.com/web/frame/recommend/?jobid=job-b&status=0"
  );
  probe.scan("poll");

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [
      EVENT_TYPES.JOB_CONTEXT_DETECTED,
      EVENT_TYPES.JOB_CONTEXT_CHANGED
    ]
  );
  assert.equal(collector.events[0].payload.current.jobId, "job-a");
  assert.equal(Object.hasOwn(collector.events[0].payload.current, "sourceUrl"), false);
  assert.equal(Object.hasOwn(collector.events[0].payload.current, "confidence"), false);
  assert.equal(Object.hasOwn(collector.events[0].payload.current, "updatedAt"), false);
  assert.equal(collector.events[0].context.jobContext.jobId, "job-a");
  assert.equal(Object.hasOwn(collector.events[0].context.jobContext, "sourceUrl"), false);
  assert.equal(Object.hasOwn(collector.events[0].context.jobContext, "confidence"), false);
  assert.equal(Object.hasOwn(collector.events[0].context.jobContext, "updatedAt"), false);
  assert.equal(collector.events[1].payload.previous.jobId, "job-a");
  assert.equal(collector.events[1].payload.current.jobId, "job-b");
  assert.equal(sessionContext.snapshot().jobContext.jobId, "job-b");
});

function createCollector(sessionContext) {
  return {
    events: [],
    collect(type, payload) {
      this.events.push({
        type,
        payload,
        context: sessionContext.snapshot()
      });
    }
  };
}

function createSessionContext() {
  const sessionContext = {
    jobContext: null,
    updateJobContext(jobContext) {
      this.jobContext = jobContext;
    },
    snapshot() {
      return {
        jobContext: this.jobContext
      };
    }
  };
  return sessionContext;
}
