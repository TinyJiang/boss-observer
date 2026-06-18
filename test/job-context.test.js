import test from "node:test";
import assert from "node:assert/strict";

import {
  buildJobContextKey,
  buildJobContextSnapshot,
  extractJobNameFromPageTitle,
  extractJobNameFromVisibleText,
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
    datasets: [{ positionId: "dataset-job" }],
    jobNames: [{ value: " 主播运营 ", source: "dom.selected_job_title" }]
  });

  assert.equal(context.jobId, "dataset-job");
  assert.equal(context.jobIdSource, "dataset.positionId");
  assert.equal(context.jobName, "主播运营");
  assert.equal(context.jobNameSource, "dom.selected_job_title");
  assert.equal(buildJobContextKey(context), "dataset.positionId:dataset-job::dom.selected_job_title:主播运营");
});

test("job name can be extracted from conservative page title", () => {
  const candidate = extractJobNameFromPageTitle("直播中控招聘_BOSS直聘");

  assert.equal(candidate.value, "直播中控");
  assert.equal(candidate.source, "page_title");
});

test("job name snapshot keeps visible selected job label", () => {
  const context = buildJobContextSnapshot({
    urls: ["https://www.zhipin.com/web/frame/recommend/?jobid=job-a"],
    jobNames: [{ value: "【8000+】居家黑板主播（时薪40+可兼职）", source: "dom.job_menu" }]
  });

  assert.equal(context.jobName, "【8000+】居家黑板主播（时薪40+可兼职）");
  assert.equal(context.jobNameSource, "dom.job_menu");
});

test("job name can be extracted from real BOSS visible selected job text", () => {
  const visibleLabel = "兼职·【8000+】居家黑板主播（时薪40+可兼职） _ 杭州 35-40元/时";
  const candidate = extractJobNameFromVisibleText(
    `${visibleLabel} `
  );

  assert.equal(candidate.value, visibleLabel);
  assert.equal(candidate.source, "dom.selected_job_title");
});

test("job name can be extracted from labeled visible job text", () => {
  const candidate = extractJobNameFromVisibleText(
    "当前职位：兼职·【8000+】居家黑板主播（时薪40+可兼职）",
    "dom.selected_job_title"
  );

  assert.equal(candidate.value, "兼职·【8000+】居家黑板主播（时薪40+可兼职）");
  assert.equal(candidate.source, "dom.selected_job_title");
});

test("job name extraction removes recommendation tab text from parent containers", () => {
  const visibleLabel = "兼职·【8000+】居家黑板主播（时薪40+可兼职） _ 杭州 35-40元/时";
  const candidate = extractJobNameFromVisibleText(
    `推荐 精选 13 最新 ${visibleLabel} 杭州 筛选 `
  );

  assert.equal(candidate.value, visibleLabel);
  assert.equal(candidate.source, "dom.selected_job_title");
});

test("job name extraction keeps menu visible label", () => {
  const visibleLabel = "0基础抖音主播｜保底6~10K起｜包住 _ 杭州 6-11K";
  const candidate = extractJobNameFromVisibleText(
    visibleLabel,
    "dom.job_menu"
  );

  assert.equal(candidate.value, visibleLabel);
  assert.equal(candidate.source, "dom.job_menu");
});

test("job name extraction removes recommendation tabs from alternate selected job", () => {
  const visibleLabel = "0基础抖音主播｜保底6~10K起｜包住 _ 杭州 6-11K";
  const candidate = extractJobNameFromVisibleText(
    `推荐 精选 13 最新 ${visibleLabel} 杭州 筛选`,
    "dom.selected_job_title"
  );

  assert.equal(candidate.value, visibleLabel);
  assert.equal(candidate.source, "dom.selected_job_title");
});

test("job name extraction supports visible label without salary", () => {
  const visibleLabel = "直播中控 _ 杭州";
  const candidate = extractJobNameFromVisibleText(
    `${visibleLabel} 杭州 筛选`,
    "dom.selected_job_title"
  );

  assert.equal(candidate.value, visibleLabel);
  assert.equal(candidate.source, "dom.selected_job_title");
});

test("job context snapshot can carry job name without stable job id", () => {
  const context = buildJobContextSnapshot({
    urls: ["https://www.zhipin.com/beihai/"],
    jobNames: [{ value: "兼职·【8000+】居家黑板主播（时薪40+可兼职）", source: "dom.selected_job_title" }]
  });

  assert.equal(context.jobId, undefined);
  assert.equal(context.jobName, "兼职·【8000+】居家黑板主播（时薪40+可兼职）");
  assert.equal(context.jobNameSource, "dom.selected_job_title");
  assert.equal(buildJobContextKey(context), "dom.selected_job_title:兼职·【8000+】居家黑板主播（时薪40+可兼职）");
});

test("job context probe emits job name only context for city path pages", () => {
  const sessionContext = createSessionContext();
  const collector = createCollector(sessionContext);
  const probe = new JobContextProbe({
    collector,
    sessionContext,
    detectJobContext: () => ({
      jobName: "兼职·【8000+】居家黑板主播（时薪40+可兼职）",
      jobNameSource: "dom.selected_job_title"
    }),
    now: () => "2026-05-12T23:27:00.000+08:00"
  });

  probe.scan("poll");

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [EVENT_TYPES.JOB_CONTEXT_DETECTED]
  );
  assert.equal(collector.events[0].payload.current.jobId, undefined);
  assert.equal(collector.events[0].payload.current.jobName, "兼职·【8000+】居家黑板主播（时薪40+可兼职）");
  assert.equal(collector.events[0].context.jobContext.jobName, "兼职·【8000+】居家黑板主播（时薪40+可兼职）");
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
  assert.equal(collector.events[0].payload.current.jobName, undefined);
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

test("job context probe updates same job when job name becomes visible", () => {
  let detected = extractJobContextFromUrl(
    "https://www.zhipin.com/web/frame/recommend/?jobid=job-a&status=0"
  );
  const sessionContext = createSessionContext();
  const collector = createCollector(sessionContext);
  const probe = new JobContextProbe({
    collector,
    sessionContext,
    detectJobContext: () => detected,
    now: () => "2026-05-12T23:27:00.000+08:00"
  });

  probe.scan("start");
  detected = {
    ...detected,
    jobName: "主播运营",
    jobNameSource: "dom.selected_job_title"
  };
  probe.scan("poll");

  assert.deepEqual(
    collector.events.map((event) => event.type),
    [
      EVENT_TYPES.JOB_CONTEXT_DETECTED,
      EVENT_TYPES.JOB_CONTEXT_CHANGED
    ]
  );
  assert.equal(collector.events[1].payload.current.jobId, "job-a");
  assert.equal(collector.events[1].payload.current.jobName, "主播运营");
  assert.equal(collector.events[1].payload.current.jobNameSource, "dom.selected_job_title");
  assert.equal(collector.events[1].context.jobContext.jobName, "主播运营");
});

test("job context probe keeps known job name when same job loses visible title", () => {
  let detected = {
    ...extractJobContextFromUrl("https://www.zhipin.com/web/frame/recommend/?jobid=job-a&status=0"),
    jobName: "主播运营",
    jobNameSource: "dom.selected_job_title"
  };
  const sessionContext = createSessionContext();
  const collector = createCollector(sessionContext);
  const probe = new JobContextProbe({
    collector,
    sessionContext,
    detectJobContext: () => detected,
    now: () => "2026-05-12T23:27:00.000+08:00"
  });

  probe.scan("start");
  detected = extractJobContextFromUrl(
    "https://www.zhipin.com/web/frame/recommend/?jobid=job-a&status=0"
  );
  probe.scan("poll");

  assert.equal(collector.events.length, 1);
  assert.equal(sessionContext.snapshot().jobContext.jobName, "主播运营");
  assert.equal(sessionContext.snapshot().jobContext.jobNameSource, "dom.selected_job_title");
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
