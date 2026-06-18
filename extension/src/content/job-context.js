const JOB_ID_KEYS = [
  "jobid",
  "jobId",
  "encryptJobId",
  "encryptJobid",
  "positionId",
  "positionid",
  "jobSourceId",
  "jobsourceid"
];

const JOB_STATUS_KEYS = [
  "status",
  "jobStatus",
  "jobstatus"
];

export function buildJobContextSnapshot({ urls = [], datasets = [], jobNames = [] } = {}) {
  const jobNameOnlyContext = buildJobNameOnlyContext(jobNames);
  const datasetContext = datasets
    .map((dataset) => extractJobContextFromDataset(dataset))
    .find((context) => context.jobId);
  if (datasetContext) {
    return withJobName(datasetContext, jobNames);
  }

  const urlContext = urls
    .map((url) => extractJobContextFromUrl(url))
    .find((context) => context.jobId) || null;

  return urlContext ? withJobName(urlContext, jobNames) : jobNameOnlyContext;
}

export function extractJobContextFromUrl(href = "") {
  try {
    const parsed = new URL(href, "https://www.zhipin.com");
    const jobIdInfo = findSearchParam(parsed.searchParams, JOB_ID_KEYS);
    if (!jobIdInfo.value) {
      return emptyJobContext();
    }

    const statusInfo = findSearchParam(parsed.searchParams, JOB_STATUS_KEYS);
    return {
      jobId: jobIdInfo.value,
      jobIdSource: `url.${jobIdInfo.key}`,
      jobStatus: statusInfo.value,
      jobStatusSource: statusInfo.value ? `url.${statusInfo.key}` : "",
      sourceUrl: parsed.href,
      confidence: "high"
    };
  } catch {
    return emptyJobContext();
  }
}

export function extractJobContextFromDataset(dataset = {}) {
  const jobIdInfo = findObjectValue(dataset, JOB_ID_KEYS);
  if (!jobIdInfo.value) {
    return emptyJobContext();
  }

  const statusInfo = findObjectValue(dataset, JOB_STATUS_KEYS);
  return {
    jobId: jobIdInfo.value,
    jobIdSource: `dataset.${jobIdInfo.key}`,
    jobStatus: statusInfo.value,
    jobStatusSource: statusInfo.value ? `dataset.${statusInfo.key}` : "",
    sourceUrl: "",
    confidence: "high"
  };
}

export function buildJobContextKey(jobContext) {
  if (!jobContext?.jobId && !jobContext?.jobName) {
    return "";
  }

  const parts = [];

  if (jobContext.jobId) {
    parts.push(
      jobContext.jobIdSource || "unknown",
      jobContext.jobId,
      jobContext.jobStatus || ""
    );
  }

  if (jobContext.jobName) {
    parts.push(jobContext.jobNameSource || "unknown", jobContext.jobName);
  }

  return parts.join(":");
}

export function buildJobNameCandidate(value = "", source = "unknown") {
  const jobName = normalizeJobName(value);
  if (!jobName) {
    return null;
  }

  return {
    value: jobName,
    source: source || "unknown"
  };
}

export function extractJobNameFromPageTitle(pageTitle = "") {
  const normalizedTitle = normalizeWhitespace(pageTitle);
  if (!normalizedTitle || normalizedTitle === "BOSS直聘") {
    return null;
  }

  const titleWithoutBrand = normalizedTitle
    .replace(/\s*[_\-|｜—–].*?BOSS直聘.*$/u, "")
    .replace(/\s*BOSS直聘.*$/u, "")
    .trim();
  const match = titleWithoutBrand.match(/^(.{2,60}?)(?:招聘信息|招聘|职位详情|岗位详情|职位|岗位)$/u);
  if (!match) {
    return null;
  }

  return buildJobNameCandidate(match[1], "page_title");
}

export function extractJobNameFromVisibleText(text = "", source = "dom.selected_job_title") {
  const normalized = normalizeWhitespace(text).replace(/[]/gu, "");
  const labeledMatch = normalized.match(
    /^(?:当前|沟通|招聘)?(?:职位|岗位)(?:名称)?[:：\-\s]+(.{2,80})$/u
  );
  if (labeledMatch) {
    return buildJobNameCandidate(labeledMatch[1], source);
  }

  const salaryMatch = normalized.match(
    /^(.{2,100}?\s+[_＿]\s+[^\s_＿]{1,20}\s+\d+(?:\.\d+)?\s*(?:[-~–—]\s*\d+(?:\.\d+)?)?\s*(?:[kK]|千|万|元)(?:\/(?:时|天|月|年|小时))?(?:\s*·\s*\d+薪)?)/u
  );
  if (salaryMatch) {
    return buildJobNameCandidate(salaryMatch[1], source);
  }

  const match = normalized.match(/^(.{2,100}?\s+[_＿]\s+[^\s_＿]{1,20})(?:\s|$)/u);
  if (!match) {
    return null;
  }

  return buildJobNameCandidate(match[1], source);
}

function findSearchParam(searchParams, keys) {
  for (const key of keys) {
    const value = searchParams.get(key);
    if (value) {
      return {
        key,
        value
      };
    }
  }

  const normalizedKeys = new Map(keys.map((key) => [key.toLowerCase(), key]));
  for (const [key, value] of searchParams.entries()) {
    const matchedKey = normalizedKeys.get(key.toLowerCase());
    if (matchedKey && value) {
      return {
        key,
        value
      };
    }
  }

  return { key: "", value: "" };
}

function findObjectValue(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value) {
      return {
        key,
        value: String(value)
      };
    }
  }

  const entries = Object.entries(source || {});
  const normalizedKeys = new Map(keys.map((key) => [key.toLowerCase(), key]));
  for (const [key, value] of entries) {
    const matchedKey = normalizedKeys.get(key.toLowerCase());
    if (matchedKey && value) {
      return {
        key,
        value: String(value)
      };
    }
  }

  return { key: "", value: "" };
}

function withJobName(jobContext, jobNames) {
  const candidate = findJobNameCandidate(jobNames);
  if (!candidate) {
    return jobContext;
  }

  return {
    ...jobContext,
    jobName: candidate.value,
    jobNameSource: candidate.source
  };
}

function buildJobNameOnlyContext(jobNames) {
  const candidate = findJobNameCandidate(jobNames);
  if (!candidate) {
    return null;
  }

  return {
    jobName: candidate.value,
    jobNameSource: candidate.source
  };
}

function findJobNameCandidate(jobNames) {
  for (const candidate of jobNames || []) {
    const value = typeof candidate === "object" && candidate !== null ? candidate.value : candidate;
    const source = typeof candidate === "object" && candidate !== null ? candidate.source : "unknown";
    const normalized = buildJobNameCandidate(value, source || "unknown");
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function normalizeJobName(value) {
  let normalized = normalizeWhitespace(value);
  if (!normalized) {
    return "";
  }

  normalized = stripLeadingRecommendationTabs(normalized);
  normalized = normalized
    .replace(/^(?:当前|沟通)?(?:招聘)?职位(?:名称)?[:：\-\s]*/u, "")
    .replace(/^(?:当前|招聘)?岗位(?:名称)?[:：\-\s]*/u, "")
    .replace(/\s*(?:切换职位|展开|收起|请选择职位)$/u, "")
    .trim();
  normalized = normalizeWhitespace(normalized);

  if (!normalized || normalized.length > 60) {
    return "";
  }

  if (/职位描述|岗位职责|工作内容|任职要求|岗位要求|薪资详情|福利待遇|公司介绍/u.test(normalized)) {
    return "";
  }

  return normalized;
}

function stripLeadingRecommendationTabs(value) {
  const tokens = normalizeWhitespace(value).split(" ");
  let index = 0;
  let sawRecommendationNav = false;
  let sawLatest = false;

  while (index < tokens.length) {
    const token = tokens[index];
    if (["推荐", "精选", "精选牛人", "新牛人", "最新"].includes(token)) {
      sawRecommendationNav = true;
      sawLatest = sawLatest || token === "最新";
      index += 1;
      continue;
    }

    if (/^\d+$/.test(token) && sawRecommendationNav) {
      index += 1;
      continue;
    }

    break;
  }

  if (!sawRecommendationNav || !sawLatest || index <= 0 || index >= tokens.length) {
    return value;
  }

  return tokens.slice(index).join(" ");
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function emptyJobContext() {
  return {
    jobId: "",
    jobIdSource: "",
    jobStatus: "",
    jobStatusSource: "",
    sourceUrl: "",
    confidence: ""
  };
}
