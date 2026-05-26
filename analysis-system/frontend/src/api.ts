import type { DashboardPayload, HistoryPayload, LogQualityPayload, OperatorPayload, OperatorsPayload } from "./types";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`请求失败：${url}`);
  }
  return response.json() as Promise<T>;
}

export function fetchDashboard(): Promise<DashboardPayload> {
  return getJson<DashboardPayload>("/api/dashboard");
}

export function fetchOperators(): Promise<OperatorsPayload> {
  return getJson<OperatorsPayload>("/api/operators");
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
