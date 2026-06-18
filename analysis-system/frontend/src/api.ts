import type { DailyAnalysisPayload, DashboardPayload, HistoryPayload, LogQualityPayload, OperatorAdminInput, OperatorAdminLoginPayload, OperatorAdminMutationPayload, OperatorAdminPayload, OperatorPayload, OperatorsPayload } from "./types";

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(await errorMessage(response, url));
  }
  return response.json() as Promise<T>;
}

async function sendJson<T>(url: string, init: RequestInit): Promise<T> {
  return getJson<T>(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
}

export function fetchDashboard(): Promise<DashboardPayload> {
  return getJson<DashboardPayload>("/api/dashboard");
}

export function fetchOperators(): Promise<OperatorsPayload> {
  return getJson<OperatorsPayload>("/api/operators");
}

export function loginOperatorAdmin(password: string): Promise<OperatorAdminLoginPayload> {
  return sendJson<OperatorAdminLoginPayload>("/api/operator-admin/login", {
    method: "POST",
    body: JSON.stringify({ password })
  });
}

export function fetchOperatorAdminOperators(token: string): Promise<OperatorAdminPayload> {
  return getJson<OperatorAdminPayload>("/api/operator-admin/operators", {
    headers: authHeaders(token)
  });
}

export function createOperatorAdminOperator(
  token: string,
  operator: OperatorAdminInput,
  encryptSensitive: boolean
): Promise<OperatorAdminMutationPayload> {
  return sendJson<OperatorAdminMutationPayload>("/api/operator-admin/operators", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ operator, encryptSensitive })
  });
}

export function updateOperatorAdminOperator(
  token: string,
  operatorId: string,
  operator: OperatorAdminInput,
  encryptSensitive: boolean
): Promise<OperatorAdminMutationPayload> {
  return sendJson<OperatorAdminMutationPayload>(`/api/operator-admin/operators/${encodeURIComponent(operatorId)}`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify({ operator, encryptSensitive })
  });
}

export function deleteOperatorAdminOperator(
  token: string,
  operatorId: string
): Promise<OperatorAdminMutationPayload> {
  return getJson<OperatorAdminMutationPayload>(`/api/operator-admin/operators/${encodeURIComponent(operatorId)}`, {
    method: "DELETE",
    headers: authHeaders(token)
  });
}

export function fetchOperator(operatorId: string): Promise<OperatorPayload> {
  return getJson<OperatorPayload>(`/api/operator/${encodeURIComponent(operatorId)}`);
}

export function fetchLogQuality(filters: {
  operatorId?: string;
  pluginVersion?: string;
}): Promise<LogQualityPayload> {
  const params = new URLSearchParams();
  if (filters.operatorId) {
    params.set("operator_id", filters.operatorId);
  }
  if (filters.pluginVersion) {
    params.set("plugin_version", filters.pluginVersion);
  }
  const query = params.toString();
  return getJson<LogQualityPayload>(`/api/log-quality${query ? `?${query}` : ""}`);
}

export function fetchHistory(filters: {
  operatorId?: string;
  activeDate?: string;
  days?: number;
}): Promise<HistoryPayload> {
  const params = new URLSearchParams();
  if (filters.operatorId) {
    params.set("operator_id", filters.operatorId);
  }
  if (filters.activeDate) {
    params.set("active_date", filters.activeDate);
  }
  if (filters.days) {
    params.set("days", String(filters.days));
  }
  const query = params.toString();
  return getJson<HistoryPayload>(`/api/history${query ? `?${query}` : ""}`);
}

export function fetchDailyAnalysis(filters: {
  operatorId?: string;
  activeDate?: string;
}): Promise<DailyAnalysisPayload> {
  const params = new URLSearchParams();
  if (filters.operatorId) {
    params.set("operator_id", filters.operatorId);
  }
  if (filters.activeDate) {
    params.set("date", filters.activeDate);
  }
  const query = params.toString();
  return getJson<DailyAnalysisPayload>(`/api/daily-analysis${query ? `?${query}` : ""}`);
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`
  };
}

async function errorMessage(response: Response, url: string) {
  try {
    const body = await response.json() as { error?: string; message?: string };
    return body.error ?? body.message ?? `请求失败：${url}`;
  } catch {
    return `请求失败：${url}`;
  }
}
