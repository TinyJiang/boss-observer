import { buildJobContextKey, buildJobContextSnapshot } from "./job-context.js";
import { EVENT_TYPES } from "../shared/event-types.js";
import { nowLocalIsoString } from "../shared/time.js";

const SCAN_INTERVAL_MS = 2000;
const DATASET_SELECTOR = [
  "[data-jobid]",
  "[data-job-id]",
  "[data-job-status]",
  "[data-position-id]",
  "[data-encrypt-job-id]"
].join(",");
const MAX_DATASET_ELEMENTS = 80;

// Responsibilities:
// - detect the current recruiting job context from stable URL/dataset fields
// - update SessionContext so later events carry context.jobContext
// - avoid parsing job descriptions or other free-form page text
export class JobContextProbe {
  constructor({
    collector,
    sessionContext,
    scanIntervalMs = SCAN_INTERVAL_MS,
    detectJobContext = detectCurrentJobContext,
    now = nowLocalIsoString
  }) {
    this.collector = collector;
    this.sessionContext = sessionContext;
    this.scanIntervalMs = scanIntervalMs;
    this.detectJobContext = detectJobContext;
    this.now = now;
    this.started = false;
    this.pollHandle = null;
    this.currentKey = buildJobContextKey(sessionContext.jobContext);
  }

  start() {
    if (this.started) {
      return;
    }

    this.started = true;
    this.safeScan("start");
    this.pollHandle = globalThis.setInterval(() => this.safeScan("poll"), this.scanIntervalMs);
  }

  stop() {
    if (!this.started) {
      return;
    }

    this.started = false;
    if (this.pollHandle !== null) {
      globalThis.clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }

  scan(source) {
    const detected = this.detectJobContext(globalThis.document);
    if (!detected?.jobId) {
      return;
    }

    const nextKey = buildJobContextKey(detected);
    if (!nextKey || nextKey === this.currentKey) {
      return;
    }

    const previous = this.sessionContext.jobContext || null;
    const current = {
      ...detected,
      updatedAt: this.now()
    };
    const currentContext = compactJobContextPayload(current);
    this.sessionContext.updateJobContext(currentContext);
    this.currentKey = nextKey;

    this.collector.collect(
      previous?.jobId ? EVENT_TYPES.JOB_CONTEXT_CHANGED : EVENT_TYPES.JOB_CONTEXT_DETECTED,
      buildJobContextEventPayload({
        source,
        previous,
        current: currentContext
      })
    );
  }

  safeScan(source) {
    try {
      this.scan(source);
    } catch (error) {
      this.collector.collect(EVENT_TYPES.PLUGIN_EXCEPTION, {
        source: `job_context:${source}`,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

function buildJobContextEventPayload({ source = "", previous = null, current = null } = {}) {
  const payload = {
    source,
    current: compactJobContextPayload(current)
  };

  if (previous?.jobId) {
    payload.previous = compactJobContextPayload(previous);
  }

  return compactJobContextWrapper(payload);
}

function compactJobContextPayload(jobContext = null) {
  if (!jobContext) {
    return {};
  }

  return compactJobContextWrapper({
    jobId: jobContext.jobId,
    jobIdSource: jobContext.jobIdSource,
    jobStatus: jobContext.jobStatus,
    jobStatusSource: jobContext.jobStatusSource
  });
}

function compactJobContextWrapper(value = {}) {
  const result = {};
  Object.entries(value || {}).forEach(([key, current]) => {
    if (current && typeof current === "object" && !Array.isArray(current)) {
      if (Object.keys(current).length > 0) {
        result[key] = current;
      }
      return;
    }
    if (current !== null && current !== undefined && current !== "") {
      result[key] = current;
    }
  });
  return result;
}

export function detectCurrentJobContext(rootDocument) {
  if (!rootDocument) {
    return null;
  }

  const urls = [];
  const datasets = [];
  collectAccessibleDocuments(rootDocument).forEach((currentDocument) => {
    const href = currentDocument.location?.href;
    if (href) {
      urls.push(href);
    }

    collectDatasets(currentDocument).forEach((dataset) => datasets.push(dataset));
  });

  return buildJobContextSnapshot({ urls, datasets });
}

function collectAccessibleDocuments(rootDocument) {
  const documents = [rootDocument];
  rootDocument.querySelectorAll?.("iframe").forEach((frame) => {
    try {
      if (frame.contentDocument) {
        documents.push(frame.contentDocument);
      }
    } catch {
      // Cross-origin frames are ignored; observed BOSS candidate frames are same-origin.
    }
  });
  return documents;
}

function collectDatasets(currentDocument) {
  const datasets = [];
  if (currentDocument.body?.dataset) {
    datasets.push(currentDocument.body.dataset);
  }

  Array.from(currentDocument.querySelectorAll?.(DATASET_SELECTOR) || [])
    .slice(0, MAX_DATASET_ELEMENTS)
    .forEach((element) => {
      if (element.dataset) {
        datasets.push(element.dataset);
      }
    });
  return datasets;
}
