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

export function buildJobContextSnapshot({ urls = [], datasets = [] } = {}) {
  const datasetContext = datasets
    .map((dataset) => extractJobContextFromDataset(dataset))
    .find((context) => context.jobId);
  if (datasetContext) {
    return datasetContext;
  }

  return urls
    .map((url) => extractJobContextFromUrl(url))
    .find((context) => context.jobId) || null;
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
  if (!jobContext?.jobId) {
    return "";
  }

  return [
    jobContext.jobIdSource || "unknown",
    jobContext.jobId,
    jobContext.jobStatus || ""
  ].join(":");
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
