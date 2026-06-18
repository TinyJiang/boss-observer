import {
  buildJobContextKey,
  buildJobContextSnapshot,
  buildJobNameCandidate,
  extractJobNameFromPageTitle,
  extractJobNameFromVisibleText
} from "./job-context.js";
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
const SELECTED_JOB_TITLE_SELECTOR = [
  "[data-current-job-title]",
  "[data-current-job-name]",
  "[data-selected-job-title]",
  "[data-selected-job-name]",
  "[data-job-title][aria-selected='true']",
  "[data-job-name][aria-selected='true']",
  "[data-position-title][aria-selected='true']",
  "[data-position-name][aria-selected='true']",
  "[data-job-title].selected",
  "[data-job-name].selected",
  "[data-position-title].selected",
  "[data-position-name].selected",
  "[data-job-title].active",
  "[data-job-name].active",
  "[data-position-title].active",
  "[data-position-name].active"
].join(",");
const JOB_MENU_TITLE_SELECTOR = [
  "[data-job-title]",
  "[data-job-name]",
  "[data-position-title]",
  "[data-position-name]"
].join(",");
const VISIBLE_JOB_TITLE_TEXT_SELECTOR = "div,span,button,a,li,p";
const MAX_DATASET_ELEMENTS = 80;
const MAX_JOB_NAME_ELEMENTS = 80;
const MAX_VISIBLE_JOB_TITLE_TEXT_ELEMENTS = 500;

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
    if (!detected?.jobId && !detected?.jobName) {
      return;
    }

    const previous = this.sessionContext.jobContext || null;
    const detectedWithPreviousName = withPreviousJobName(detected, previous);
    const nextKey = buildJobContextKey(detectedWithPreviousName);
    if (!nextKey || nextKey === this.currentKey) {
      return;
    }

    const current = {
      ...detectedWithPreviousName,
      updatedAt: this.now()
    };
    const currentContext = compactJobContextPayload(current);
    this.sessionContext.updateJobContext(currentContext);
    this.currentKey = nextKey;

    this.collector.collect(
      previous ? EVENT_TYPES.JOB_CONTEXT_CHANGED : EVENT_TYPES.JOB_CONTEXT_DETECTED,
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

function withPreviousJobName(detected, previous) {
  if (detected.jobName || !previous?.jobName || detected.jobId !== previous.jobId) {
    return detected;
  }

  return {
    ...detected,
    jobName: previous.jobName,
    jobNameSource: previous.jobNameSource || "unknown"
  };
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
    jobName: jobContext.jobName,
    jobNameSource: jobContext.jobNameSource,
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
  const jobNames = [];
  collectAccessibleDocuments(rootDocument).forEach((currentDocument) => {
    const href = currentDocument.location?.href;
    if (href) {
      urls.push(href);
    }

    collectDatasets(currentDocument).forEach((dataset) => datasets.push(dataset));
    collectJobNameCandidates(currentDocument).forEach((candidate) => jobNames.push(candidate));
  });

  return buildJobContextSnapshot({ urls, datasets, jobNames });
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

function collectJobNameCandidates(currentDocument) {
  const candidates = [];
  collectVisibleJobTitleTextCandidates(currentDocument)
    .forEach((candidate) => candidates.push(candidate));
  collectJobNameElements(currentDocument, SELECTED_JOB_TITLE_SELECTOR)
    .forEach((element) => appendElementJobName(candidates, element, "dom.selected_job_title"));
  collectJobNameElements(currentDocument, JOB_MENU_TITLE_SELECTOR)
    .forEach((element) => appendElementJobName(candidates, element, "dom.job_menu"));

  const pageTitleCandidate = extractJobNameFromPageTitle(currentDocument.title || "");
  if (pageTitleCandidate) {
    candidates.push(pageTitleCandidate);
  }

  return candidates;
}

function collectVisibleJobTitleTextCandidates(currentDocument) {
  const rows = [];
  try {
    Array.from(currentDocument.querySelectorAll?.(VISIBLE_JOB_TITLE_TEXT_SELECTOR) || [])
      .slice(0, MAX_VISIBLE_JOB_TITLE_TEXT_ELEMENTS)
      .forEach((element) => {
        if (!isVisibleElement(element)) {
          return;
        }

        const text = readElementVisibleText(element);
        if (!text || text.length > 140) {
          return;
        }

        const candidate = extractJobNameFromVisibleText(text, "dom.selected_job_title");
        if (!candidate) {
          return;
        }

        const rect = element.getBoundingClientRect?.();
        rows.push({
          ...candidate,
          top: rect?.top ?? 0,
          left: rect?.left ?? 0
        });
      });
  } catch {
    return [];
  }

  rows.sort((a, b) => a.top - b.top || a.left - b.left);
  return uniqueJobNameCandidates(rows.map((row, index) => ({
    value: row.value,
    source: index === 0 ? "dom.selected_job_title" : "dom.job_menu"
  })));
}

function collectJobNameElements(currentDocument, selector) {
  try {
    return Array.from(currentDocument.querySelectorAll?.(selector) || [])
      .slice(0, MAX_JOB_NAME_ELEMENTS)
      .filter((element) => isVisibleElement(element));
  } catch {
    return [];
  }
}

function appendElementJobName(candidates, element, source) {
  const candidate = buildJobNameCandidate(element?.textContent || "", source);
  if (candidate) {
    candidates.push(candidate);
  }
}

function uniqueJobNameCandidates(candidates) {
  const result = [];
  const seen = new Set();
  candidates.forEach((candidate) => {
    const key = `${candidate.source}:${candidate.value}`;
    if (!candidate.value || seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(candidate);
  });
  return result;
}

function readElementVisibleText(element) {
  return String(element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();
}

function isVisibleElement(element) {
  if (!element || element.hidden || element.getAttribute?.("aria-hidden") === "true") {
    return false;
  }

  const style = element.ownerDocument?.defaultView?.getComputedStyle?.(element);
  if (style?.display === "none" || style?.visibility === "hidden") {
    return false;
  }

  if (typeof element.getClientRects === "function" && element.getClientRects().length === 0) {
    return false;
  }

  return true;
}
