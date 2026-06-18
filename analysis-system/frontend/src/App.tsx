import { useEffect, useMemo, useState } from "react";
import { createOperatorAdminOperator, deleteOperatorAdminOperator, fetchDailyAnalysis, fetchDashboard, fetchHistory, fetchLogQuality, fetchOperator, fetchOperatorAdminOperators, fetchOperators, loginOperatorAdmin, updateOperatorAdminOperator } from "./api";
import type { ActiveOperator, DailyActiveDuration, DailyAnalysisPayload, DailyAnalysisStatus, DailyBasicStatsRecord, DashboardPayload, HealthStatus, HistoryPayload, LogQualityPayload, OperatorAdminInput, OperatorAdminPayload, OperatorMinutePoint, OperatorPayload, OperatorProfile } from "./types";
import "./styles.css";

type LoadState = "loading" | "ready" | "error";
type AppTab = "dashboard" | "history" | "quality" | "operators";
type DailyOperatorEvidence = DailyAnalysisPayload["evidence_bundle"]["operator_results"][number];
type DailyOperatorSummary = ReturnType<typeof dailyOperatorSummaries>[number];

const REFRESH_INTERVAL_MS = 15_000;
const DAILY_ANALYSIS_PATH = "/daily-analysis";

const STATUS_LABELS: Record<HealthStatus, string> = {
  ok: "正常",
  warning: "预警",
  critical: "严重",
  unknown: "未知"
};

const HISTORY_STATUS_LABELS: Record<HistoryPayload["history"]["status"], string> = {
  ok: "正常",
  partial: "部分缺值",
  missing_values: "指标值暂不可查",
  empty: "无记录"
};

const DAILY_ANALYSIS_STATUS_LABELS: Record<DailyAnalysisStatus, string> = {
  ready: "可用",
  partial: "部分可用",
  analyzing: "分析中",
  failed: "失败"
};

const ACTION_LABELS: Record<string, string> = {
  "candidate_card.exposed": "候选人卡片曝光",
  "candidate_list.card_exposed": "候选人卡片曝光",
  "candidate_detail.opened": "打开候选人详情",
  "greeting.clicked": "点击打招呼",
  "greeting.succeeded": "打招呼成功",
  "greeting.failed": "打招呼失败",
  "candidate_greeting.clicked": "点击打招呼",
  "candidate_greeting.succeeded": "打招呼成功",
  "candidate_greeting.failed": "打招呼失败",
  "candidate_chat.opened": "打开聊天",
  "candidate_chat.snapshot_captured": "采集聊天快照",
  "candidate_chat.wechat_captured": "获取微信",
  "candidate_chat.capture_failed": "聊天采集失败",
  "boss_minute_operator_funnel": "分钟漏斗汇总",
  "boss_minute_chat": "分钟聊天汇总",
  "boss_daily_operator_active_duration": "当日活跃时长"
};

type MinuteMetricKey =
  | "card_exposed"
  | "detail_opened"
  | "greeting_succeeded"
  | "chat_snapshots";

const CHART_SERIES: Array<{ key: MinuteMetricKey; label: string; color: string }> = [
  { key: "card_exposed", label: "卡片", color: "#0f766e" },
  { key: "detail_opened", label: "详情", color: "#2563eb" },
  { key: "greeting_succeeded", label: "招呼成功", color: "#9333ea" },
  { key: "chat_snapshots", label: "聊天", color: "#ea580c" }
];

const EMPTY_OPERATOR_FORM: OperatorAdminInput = {
  operatorId: "",
  displayName: "",
  accountName: "",
  enabled: true,
  role: "",
  note: ""
};

const OPERATOR_ADMIN_TOKEN_KEY = "bossAnalysisOperatorAdminToken";

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("dashboard");
  const isDailyAnalysisRoute = window.location.pathname.endsWith(DAILY_ANALYSIS_PATH);
  const [operator, setOperator] = useState<OperatorPayload | null>(null);
  const [quality, setQuality] = useState<LogQualityPayload | null>(null);
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [dailyAnalysis, setDailyAnalysis] = useState<DailyAnalysisPayload | null>(null);
  const [operatorAdmin, setOperatorAdmin] = useState<OperatorAdminPayload | null>(null);
  const [operatorProfiles, setOperatorProfiles] = useState<OperatorProfile[]>([]);
  const [operatorAdminToken, setOperatorAdminToken] = useState(() => window.sessionStorage.getItem(OPERATOR_ADMIN_TOKEN_KEY) ?? "");
  const [operatorAdminPassword, setOperatorAdminPassword] = useState("");
  const [operatorAdminForm, setOperatorAdminForm] = useState<OperatorAdminInput>(EMPTY_OPERATOR_FORM);
  const [editingOperatorId, setEditingOperatorId] = useState("");
  const [encryptSensitiveFields, setEncryptSensitiveFields] = useState(true);
  const [selectedOperatorId, setSelectedOperatorId] = useState("");
  const [historyOperatorId, setHistoryOperatorId] = useState("");
  const [historyActiveDate, setHistoryActiveDate] = useState(getYesterdayDateInput());
  const [historySubmittedFilters, setHistorySubmittedFilters] = useState({
    operatorId: "",
    activeDate: getYesterdayDateInput()
  });
  const [historyQueryVersion, setHistoryQueryVersion] = useState(0);
  const [dailyAnalysisOperatorId, setDailyAnalysisOperatorId] = useState("");
  const [dailyAnalysisActiveDate, setDailyAnalysisActiveDate] = useState(getYesterdayDateInput());
  const [dailyAnalysisSubmittedFilters, setDailyAnalysisSubmittedFilters] = useState({
    operatorId: "",
    activeDate: getYesterdayDateInput()
  });
  const [dailyAnalysisQueryVersion, setDailyAnalysisQueryVersion] = useState(0);
  const [qualityOperatorId, setQualityOperatorId] = useState("");
  const [qualityPluginVersion, setQualityPluginVersion] = useState("");
  const [operatorLoadState, setOperatorLoadState] = useState<LoadState>("loading");
  const [dashboardLoadState, setDashboardLoadState] = useState<LoadState>("loading");
  const [detailLoadState, setDetailLoadState] = useState<LoadState>("loading");
  const [historyLoadState, setHistoryLoadState] = useState<LoadState>("ready");
  const [dailyAnalysisLoadState, setDailyAnalysisLoadState] = useState<LoadState>("ready");
  const [qualityLoadState, setQualityLoadState] = useState<LoadState>("loading");
  const [operatorAdminLoadState, setOperatorAdminLoadState] = useState<LoadState>("ready");
  const [operatorAdminSaveState, setOperatorAdminSaveState] = useState<LoadState>("ready");
  const [operatorErrorMessage, setOperatorErrorMessage] = useState<string | null>(null);
  const [dashboardErrorMessage, setDashboardErrorMessage] = useState<string | null>(null);
  const [detailErrorMessage, setDetailErrorMessage] = useState<string | null>(null);
  const [historyErrorMessage, setHistoryErrorMessage] = useState<string | null>(null);
  const [dailyAnalysisErrorMessage, setDailyAnalysisErrorMessage] = useState<string | null>(null);
  const [qualityErrorMessage, setQualityErrorMessage] = useState<string | null>(null);
  const [operatorAdminErrorMessage, setOperatorAdminErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadOperators() {
      try {
        setOperatorLoadState("loading");
        const payload = await fetchOperators();
        if (cancelled) return;
        const profiles = payload.operators ?? [];
        setOperatorProfiles(profiles);
        setSelectedOperatorId((current) => current || profiles[0]?.operator_id || "");
        setOperatorLoadState("ready");
      } catch (error) {
        if (cancelled) return;
        setOperatorLoadState("error");
        setOperatorErrorMessage(error instanceof Error ? error.message : "未知错误");
      }
    }
    loadOperators();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "dashboard") {
      return;
    }
    let cancelled = false;
    async function loadDashboard(showLoading = false) {
      try {
        if (showLoading) {
          setDashboardLoadState("loading");
        }
        const payload = await fetchDashboard();
        if (cancelled) return;
        setDashboard(payload);
        setSelectedOperatorId((current) => {
          if (current) {
            return current;
          }
          return payload.dashboard.configured_operators?.[0]?.operator_id
            ?? payload.dashboard.active_operators?.[0]?.operator_id
            ?? "";
        });
        setDashboardLoadState("ready");
        setDashboardErrorMessage(null);
      } catch (error) {
        if (cancelled) return;
        setDashboardLoadState("error");
        setDashboardErrorMessage(error instanceof Error ? error.message : "未知错误");
      }
    }
    loadDashboard(true);
    const dashboardTimer = window.setInterval(() => {
      loadDashboard(false);
    }, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(dashboardTimer);
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "dashboard") {
      return;
    }
    if (!selectedOperatorId) {
      setDetailLoadState("ready");
      return;
    }
    let cancelled = false;
    async function loadOperatorDetail(showLoading = false) {
      try {
        if (showLoading) {
          setDetailLoadState("loading");
          setOperator(null);
        }
        setDetailErrorMessage(null);
        const payload = await fetchOperator(selectedOperatorId);
        if (cancelled) return;
        setOperator(payload);
        setDetailLoadState("ready");
      } catch (error) {
        if (cancelled) return;
        setDetailLoadState("error");
        setDetailErrorMessage(error instanceof Error ? error.message : "未知错误");
      }
    }
    loadOperatorDetail(true);
    const detailTimer = window.setInterval(() => {
      loadOperatorDetail(false);
    }, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(detailTimer);
    };
  }, [activeTab, selectedOperatorId]);

  useEffect(() => {
    if (activeTab !== "quality") {
      return;
    }
    let cancelled = false;
    async function loadQuality(showLoading = false) {
      try {
        if (showLoading) {
          setQualityLoadState("loading");
        }
        setQualityErrorMessage(null);
        const payload = await fetchLogQuality({
          operatorId: qualityOperatorId || undefined,
          pluginVersion: qualityPluginVersion || undefined
        });
        if (cancelled) return;
        setQuality(payload);
        setQualityLoadState("ready");
      } catch (error) {
        if (cancelled) return;
        setQualityLoadState("error");
        setQualityErrorMessage(error instanceof Error ? error.message : "未知错误");
      }
    }
    loadQuality(true);
    const qualityTimer = window.setInterval(() => {
      loadQuality(false);
    }, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(qualityTimer);
    };
  }, [activeTab, qualityOperatorId, qualityPluginVersion]);

  useEffect(() => {
    if (activeTab !== "history") {
      return;
    }
    let cancelled = false;
    async function loadHistory(showLoading = false) {
      try {
        if (showLoading) {
          setHistoryLoadState("loading");
        }
        setHistoryErrorMessage(null);
        const payload = await fetchHistory({
          operatorId: historySubmittedFilters.operatorId || undefined,
          activeDate: historySubmittedFilters.activeDate || undefined
        });
        if (cancelled) return;
        setHistory(payload);
        setHistoryLoadState("ready");
      } catch (error) {
        if (cancelled) return;
        setHistoryLoadState("error");
        setHistoryErrorMessage(error instanceof Error ? error.message : "未知错误");
      }
    }
    loadHistory(true);
    return () => {
      cancelled = true;
    };
  }, [activeTab, historySubmittedFilters, historyQueryVersion]);

  useEffect(() => {
    if (!isDailyAnalysisRoute) {
      return;
    }
    let cancelled = false;
    async function loadDailyAnalysis() {
      try {
        setDailyAnalysisLoadState("loading");
        setDailyAnalysisErrorMessage(null);
        const payload = await fetchDailyAnalysis({
          operatorId: dailyAnalysisSubmittedFilters.operatorId || undefined,
          activeDate: dailyAnalysisSubmittedFilters.activeDate || undefined
        });
        if (cancelled) return;
        setDailyAnalysis(payload);
        setDailyAnalysisLoadState("ready");
      } catch (error) {
        if (cancelled) return;
        setDailyAnalysisLoadState("error");
        setDailyAnalysisErrorMessage(error instanceof Error ? error.message : "未知错误");
      }
    }
    loadDailyAnalysis();
    return () => {
      cancelled = true;
    };
  }, [isDailyAnalysisRoute, dailyAnalysisSubmittedFilters, dailyAnalysisQueryVersion]);

  useEffect(() => {
    if (activeTab !== "operators" || !operatorAdminToken) {
      return;
    }
    let cancelled = false;
    async function loadOperatorAdmin() {
      try {
        setOperatorAdminLoadState("loading");
        setOperatorAdminErrorMessage(null);
        const payload = await fetchOperatorAdminOperators(operatorAdminToken);
        if (cancelled) return;
        setOperatorAdmin(payload);
        setOperatorProfiles(payload.operators);
        setOperatorAdminLoadState("ready");
      } catch (error) {
        if (cancelled) return;
        setOperatorAdminLoadState("error");
        setOperatorAdminErrorMessage(error instanceof Error ? error.message : "未知错误");
        setOperatorAdminToken("");
        window.sessionStorage.removeItem(OPERATOR_ADMIN_TOKEN_KEY);
      }
    }
    loadOperatorAdmin();
    return () => {
      cancelled = true;
    };
  }, [activeTab, operatorAdminToken]);

  const issueCount = (dashboard?.health.parse_error_count ?? 0)
    + (dashboard?.health.projection_error_count ?? 0)
    + (dashboard?.health.unknown_event_type_count ?? 0)
    + (dashboard?.health.summary_missing_operator_count ?? 0)
    + (dashboard?.health.log_quality_finding_count ?? 0);
  const totalActiveMinutes = (dashboard?.dashboard.daily_active_durations ?? [])
    .reduce((total, item) => total + item.active_minutes, 0);
  const operatorRows = useMemo(
    () => buildOperatorRows(operatorProfiles, dashboard),
    [operatorProfiles, dashboard]
  );
  const pluginVersionOptions = useMemo(
    () => buildPluginVersionOptions(dashboard, quality),
    [dashboard, quality]
  );
  const activityLoading = dashboardLoadState === "loading";
  const handleHistoryQuery = () => {
    setHistorySubmittedFilters({
      operatorId: historyOperatorId.trim(),
      activeDate: historyActiveDate
    });
    setHistoryQueryVersion((version) => version + 1);
  };
  const handleDailyAnalysisQuery = () => {
    setDailyAnalysisSubmittedFilters({
      operatorId: dailyAnalysisOperatorId.trim(),
      activeDate: dailyAnalysisActiveDate
    });
    setDailyAnalysisQueryVersion((version) => version + 1);
  };
  const handleOperatorAdminLogin = async () => {
    try {
      setOperatorAdminLoadState("loading");
      setOperatorAdminErrorMessage(null);
      const payload = await loginOperatorAdmin(operatorAdminPassword);
      if (!payload.authenticated || !payload.token) {
        throw new Error(payload.message ?? "密码不正确");
      }
      setOperatorAdminToken(payload.token);
      window.sessionStorage.setItem(OPERATOR_ADMIN_TOKEN_KEY, payload.token);
      setOperatorAdminPassword("");
      const adminPayload = await fetchOperatorAdminOperators(payload.token);
      setOperatorAdmin(adminPayload);
      setOperatorProfiles(adminPayload.operators);
      setOperatorAdminLoadState("ready");
    } catch (error) {
      setOperatorAdminLoadState("error");
      setOperatorAdminErrorMessage(error instanceof Error ? error.message : "未知错误");
    }
  };
  const handleOperatorAdminLogout = () => {
    setOperatorAdminToken("");
    setOperatorAdmin(null);
    setOperatorAdminForm(EMPTY_OPERATOR_FORM);
    setEditingOperatorId("");
    window.sessionStorage.removeItem(OPERATOR_ADMIN_TOKEN_KEY);
  };
  const handleOperatorAdminSave = async () => {
    if (!operatorAdminToken) {
      return;
    }
    try {
      setOperatorAdminSaveState("loading");
      setOperatorAdminErrorMessage(null);
      const payload = editingOperatorId
        ? await updateOperatorAdminOperator(
            operatorAdminToken,
            editingOperatorId,
            operatorAdminForm,
            encryptSensitiveFields
          )
        : await createOperatorAdminOperator(
            operatorAdminToken,
            operatorAdminForm,
            encryptSensitiveFields
          );
      setOperatorAdmin({
        operators: payload.operators,
        config_path: payload.config_path,
        encryption_enabled: payload.encryption_enabled
      });
      setOperatorProfiles(payload.operators);
      setOperatorAdminForm(EMPTY_OPERATOR_FORM);
      setEditingOperatorId("");
      setOperatorAdminSaveState("ready");
    } catch (error) {
      setOperatorAdminSaveState("error");
      setOperatorAdminErrorMessage(error instanceof Error ? error.message : "未知错误");
    }
  };
  const handleOperatorAdminDelete = async (operatorId: string) => {
    if (!operatorAdminToken) {
      return;
    }
    try {
      setOperatorAdminSaveState("loading");
      setOperatorAdminErrorMessage(null);
      const payload = await deleteOperatorAdminOperator(operatorAdminToken, operatorId);
      setOperatorAdmin({
        operators: payload.operators,
        config_path: payload.config_path,
        encryption_enabled: payload.encryption_enabled
      });
      setOperatorProfiles(payload.operators);
      if (editingOperatorId === operatorId) {
        setOperatorAdminForm(EMPTY_OPERATOR_FORM);
        setEditingOperatorId("");
      }
      setOperatorAdminSaveState("ready");
    } catch (error) {
      setOperatorAdminSaveState("error");
      setOperatorAdminErrorMessage(error instanceof Error ? error.message : "未知错误");
    }
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brandMark" />
          <span>招聘分析系统</span>
        </div>
        <nav className="nav" aria-label="主导航">
          <button
            className={`navItem ${activeTab === "dashboard" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveTab("dashboard")}
          >
            实时大盘
          </button>
          <button
            className={`navItem ${activeTab === "history" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveTab("history")}
          >
            历史数据
          </button>
          <button
            className={`navItem ${activeTab === "quality" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveTab("quality")}
          >
            数据质量
          </button>
          <button
            className={`navItem ${activeTab === "operators" ? "active" : ""}`}
            type="button"
            onClick={() => setActiveTab("operators")}
          >
            操作员管理
          </button>
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">本地开发</p>
            <h1>{isDailyAnalysisRoute ? "日常分析" : formatTabTitle(activeTab)}</h1>
          </div>
          <div className={`freshness ${dashboardLoadState}`}>
            {dashboardLoadState === "ready" && dashboard
              ? (
                  <>
                    <span>数据生成于 {formatTime(dashboard.dashboard.generated_at)}</span>
                    <span className="sourceLine">{formatSource(dashboard)}</span>
                    <span className="sourceLine">{formatSummarySource(dashboard)}</span>
                    <span className="sourceLine">{formatDailySummarySource(dashboard)}</span>
                    <span className="sourceLine">{formatDailyBasicSummarySource(dashboard)}</span>
                  </>
                )
              : dashboardLoadState === "error"
                ? dashboardErrorMessage
                : <LoadingText label="正在加载分钟汇总" />}
          </div>
        </header>

        {isDailyAnalysisRoute ? (
          <DailyAnalysisTab
            payload={dailyAnalysis}
            loadState={dailyAnalysisLoadState}
            errorMessage={dailyAnalysisErrorMessage}
            operators={operatorRows.map((item) => item.profile)}
            operatorId={dailyAnalysisOperatorId}
            activeDate={dailyAnalysisActiveDate}
            onOperatorIdChange={setDailyAnalysisOperatorId}
            onActiveDateChange={setDailyAnalysisActiveDate}
            onQuery={handleDailyAnalysisQuery}
          />
        ) : activeTab === "dashboard" ? (
          <>
            <section className="metricsGrid">
              <Metric label="当前活跃" value={dashboard?.dashboard.active_count ?? 0} loading={activityLoading} />
              <Metric label="已观测操作员" value={dashboard?.dashboard.observed_operator_count ?? 0} loading={activityLoading} />
              <Metric label="今日活跃分钟" value={totalActiveMinutes} loading={activityLoading} />
              <Metric label="原始事件" value={dashboard?.health.raw_event_count ?? 0} loading={activityLoading} />
              <Metric label="分钟汇总" value={dashboard?.health.summary_record_count ?? 0} loading={activityLoading} />
              <Metric label="流水线异常" value={issueCount} loading={activityLoading} />
              <StatusMetric label="质量状态" status={dashboard?.health.log_quality_status ?? "unknown"} loading={activityLoading} />
            </section>

            <section className="contentGrid">
              <section className="panel">
                <div className="panelHead">
                  <h2>操作员列表</h2>
                  <span className="panelNote">配置文件热加载</span>
                </div>
                <div className="operatorList">
                  {operatorLoadState === "loading" && <LoadingText label="正在加载操作员" />}
                  {operatorLoadState === "error" && (
                    <div className="inlineError">{operatorErrorMessage}</div>
                  )}
                  {operatorRows.map((item) => (
                    <OperatorRow
                      key={item.profile.operator_id}
                      item={item}
                      selected={item.profile.operator_id === selectedOperatorId}
                      activityLoading={activityLoading}
                      onSelect={setSelectedOperatorId}
                    />
                  ))}
                </div>
              </section>

              <section className="panel">
                <div className="panelHead">
                  <h2>单人明细</h2>
                  <span className="panelNote">{selectedOperatorId || "未选择"}</span>
                </div>
                <OperatorDetail payload={operator} loadState={detailLoadState} errorMessage={detailErrorMessage} />
              </section>
            </section>
          </>
        ) : activeTab === "quality" ? (
          <DataQualityTab
            payload={quality}
            loadState={qualityLoadState}
            errorMessage={qualityErrorMessage}
            operators={operatorRows.map((item) => item.profile)}
            pluginVersionOptions={pluginVersionOptions}
            operatorId={qualityOperatorId}
            pluginVersion={qualityPluginVersion}
            onOperatorIdChange={setQualityOperatorId}
            onPluginVersionChange={setQualityPluginVersion}
          />
        ) : activeTab === "operators" ? (
          <OperatorAdminTab
            payload={operatorAdmin}
            token={operatorAdminToken}
            password={operatorAdminPassword}
            form={operatorAdminForm}
            editingOperatorId={editingOperatorId}
            encryptSensitiveFields={encryptSensitiveFields}
            loadState={operatorAdminLoadState}
            saveState={operatorAdminSaveState}
            errorMessage={operatorAdminErrorMessage}
            onPasswordChange={setOperatorAdminPassword}
            onLogin={handleOperatorAdminLogin}
            onLogout={handleOperatorAdminLogout}
            onFormChange={setOperatorAdminForm}
            onEdit={(profile) => {
              setOperatorAdminForm(operatorProfileToForm(profile));
              setEditingOperatorId(profile.operator_id);
            }}
            onNew={() => {
              setOperatorAdminForm(EMPTY_OPERATOR_FORM);
              setEditingOperatorId("");
            }}
            onEncryptSensitiveFieldsChange={setEncryptSensitiveFields}
            onSave={handleOperatorAdminSave}
            onDelete={handleOperatorAdminDelete}
          />
        ) : (
          <HistoryTab
            payload={history}
            loadState={historyLoadState}
            errorMessage={historyErrorMessage}
            operators={operatorRows.map((item) => item.profile)}
            operatorId={historyOperatorId}
            activeDate={historyActiveDate}
            onOperatorIdChange={setHistoryOperatorId}
            onActiveDateChange={setHistoryActiveDate}
            onQuery={handleHistoryQuery}
          />
        )}
      </main>
    </div>
  );
}

function Metric({ label, value, loading = false }: { label: string; value: number; loading?: boolean }) {
  return (
    <article className="metric">
      <span className="metricLabel">{label}</span>
      <strong>{loading ? "..." : value}</strong>
    </article>
  );
}

function OperatorAdminTab({
  payload,
  token,
  password,
  form,
  editingOperatorId,
  encryptSensitiveFields,
  loadState,
  saveState,
  errorMessage,
  onPasswordChange,
  onLogin,
  onLogout,
  onFormChange,
  onEdit,
  onNew,
  onEncryptSensitiveFieldsChange,
  onSave,
  onDelete
}: {
  payload: OperatorAdminPayload | null;
  token: string;
  password: string;
  form: OperatorAdminInput;
  editingOperatorId: string;
  encryptSensitiveFields: boolean;
  loadState: LoadState;
  saveState: LoadState;
  errorMessage: string | null;
  onPasswordChange: (password: string) => void;
  onLogin: () => void;
  onLogout: () => void;
  onFormChange: (form: OperatorAdminInput) => void;
  onEdit: (profile: OperatorProfile) => void;
  onNew: () => void;
  onEncryptSensitiveFieldsChange: (enabled: boolean) => void;
  onSave: () => void;
  onDelete: (operatorId: string) => void;
}) {
  const operators = payload?.operators ?? [];
  const canSave = form.operatorId.trim() !== "" && form.displayName.trim() !== "" && saveState !== "loading";
  if (!token) {
    return (
      <section className="panel adminLoginPanel">
        <div className="panelHead">
          <h2>操作员管理</h2>
          <span className="panelNote">需要本地 env 密码</span>
        </div>
        {loadState === "error" && errorMessage && (
          <div className="inlineError">{errorMessage}</div>
        )}
        <label className="adminPasswordField">
          <span>管理密码</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(event) => onPasswordChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onLogin();
              }
            }}
          />
        </label>
        <button
          className="queryButton"
          type="button"
          onClick={onLogin}
          disabled={loadState === "loading" || password.trim() === ""}
        >
          {loadState === "loading" ? <LoadingText label="验证中" /> : "进入管理"}
        </button>
      </section>
    );
  }

  return (
    <>
      <section className="panel adminToolbar">
        <div>
          <h2>操作员管理</h2>
          <p>{payload?.config_path ?? "正在读取配置路径"}</p>
        </div>
        <div className="adminToolbarActions">
          <span className={`adminEncryptState ${payload?.encryption_enabled ? "enabled" : ""}`}>
            {payload?.encryption_enabled ? "加密可用" : "未配置加密密钥"}
          </span>
          <button className="tableActionButton" type="button" onClick={onNew}>
            新增
          </button>
          <button className="tableActionButton" type="button" onClick={onLogout}>
            退出
          </button>
        </div>
      </section>
      {errorMessage && (
        <div className="inlineError qualityError">{errorMessage}</div>
      )}
      <section className="adminGrid">
        <section className="panel adminListPanel">
          <div className="panelHead">
            <h2>本地操作员</h2>
            <span className="panelNote">{loadState === "loading" ? "加载中" : `${operators.length} 人`}</span>
          </div>
          {loadState === "loading" && payload === null ? (
            <LoadingText label="正在加载操作员" />
          ) : operators.length === 0 ? (
            <div className="emptyQuality">暂无本地操作员</div>
          ) : (
            <div className="adminOperatorRows">
              {operators.map((operator) => (
                <div className="adminOperatorRow" key={operator.operator_id}>
                  <div>
                    <strong>{operator.display_name}</strong>
                    <span>{operator.operator_id}</span>
                    <small>
                      {operator.account_name ?? "未填账号"}
                      {operator.role ? ` · ${operator.role}` : ""}
                      {operator.enabled ? " · 启用" : " · 停用"}
                    </small>
                  </div>
                  <div className="adminRowActions">
                    <button className="tableActionButton" type="button" onClick={() => onEdit(operator)}>
                      编辑
                    </button>
                    <button className="dangerButton" type="button" onClick={() => onDelete(operator.operator_id)}>
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel adminFormPanel">
          <div className="panelHead">
            <h2>{editingOperatorId ? "编辑操作员" : "新增操作员"}</h2>
            <span className="panelNote">写回本地 JSON</span>
          </div>
          <div className="adminForm">
            <label>
              <span>操作员 ID</span>
              <input
                value={form.operatorId}
                disabled={Boolean(editingOperatorId)}
                onChange={(event) => onFormChange({ ...form, operatorId: event.target.value })}
              />
            </label>
            <label>
              <span>展示名称</span>
              <input
                value={form.displayName}
                onChange={(event) => onFormChange({ ...form, displayName: event.target.value })}
              />
            </label>
            <label>
              <span>BOSS 账号姓名</span>
              <input
                value={form.accountName}
                onChange={(event) => onFormChange({ ...form, accountName: event.target.value })}
              />
            </label>
            <label>
              <span>角色</span>
              <input
                value={form.role}
                onChange={(event) => onFormChange({ ...form, role: event.target.value })}
              />
            </label>
            <label className="adminWideField">
              <span>备注</span>
              <textarea
                value={form.note}
                rows={4}
                onChange={(event) => onFormChange({ ...form, note: event.target.value })}
              />
            </label>
            <label className="adminCheckRow">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => onFormChange({ ...form, enabled: event.target.checked })}
              />
              <span>启用</span>
            </label>
            <label className="adminCheckRow">
              <input
                type="checkbox"
                checked={encryptSensitiveFields}
                onChange={(event) => onEncryptSensitiveFieldsChange(event.target.checked)}
              />
              <span>保存时加密账号和备注</span>
            </label>
            <div className="adminFormActions">
              <button
                className="queryButton"
                type="button"
                disabled={!canSave}
                onClick={onSave}
              >
                {saveState === "loading" ? <LoadingText label="保存中" /> : "保存"}
              </button>
              <button className="tableActionButton" type="button" onClick={onNew}>
                清空
              </button>
            </div>
          </div>
        </section>
      </section>
    </>
  );
}

function DailyAnalysisTab({
  payload,
  loadState,
  errorMessage,
  operators,
  operatorId,
  activeDate,
  onOperatorIdChange,
  onActiveDateChange,
  onQuery
}: {
  payload: DailyAnalysisPayload | null;
  loadState: LoadState;
  errorMessage: string | null;
  operators: OperatorProfile[];
  operatorId: string;
  activeDate: string;
  onOperatorIdChange: (operatorId: string) => void;
  onActiveDateChange: (activeDate: string) => void;
  onQuery: () => void;
}) {
  const [personalDetailOperatorId, setPersonalDetailOperatorId] = useState("");
  const [isPersonalDrawerOpen, setPersonalDrawerOpen] = useState(false);
  const isQuerying = loadState === "loading";
  const evidenceCount = payload ? dailyEvidenceCount(payload) : 0;
  const reviewOperators = payload ? dailyOperatorSummaries(payload) : [];
  const selectedPersonalOperatorId = payload
    ? dailySelectedOperatorId(payload, personalDetailOperatorId, operatorId, reviewOperators)
    : "";
  const handleSelectPersonalOperator = (nextOperatorId: string) => {
    setPersonalDetailOperatorId(nextOperatorId);
    setPersonalDrawerOpen(true);
  };
  return (
    <>
      <section className="panel dailyAnalysisFilters">
        <label>
          <span>分析日期</span>
          <input
            type="date"
            value={activeDate}
            onChange={(event) => onActiveDateChange(event.target.value)}
          />
        </label>
        <label>
          <span>操作员 ID</span>
          <input
            value={operatorId}
            list="daily-analysis-operator-options"
            placeholder="全部操作员"
            onChange={(event) => onOperatorIdChange(event.target.value)}
          />
          <datalist id="daily-analysis-operator-options">
            {operators.map((operator) => (
              <option key={operator.operator_id} value={operator.operator_id}>
                {operator.display_name}
              </option>
            ))}
          </datalist>
        </label>
        <button
          className="queryButton"
          type="button"
          onClick={onQuery}
          disabled={isQuerying}
        >
          {isQuerying ? <LoadingText label="分析中" /> : "查询"}
        </button>
        <span className={`queryState ${loadState}`}>
          {loadState === "loading"
            ? "正在生成分析包"
            : loadState === "error"
              ? "分析失败"
              : payload
                ? "分析完成"
                : "等待查询"}
        </span>
      </section>

      {loadState === "error" && (
        <div className="inlineError qualityError">{errorMessage}</div>
      )}

      <DailyOverviewStrip
        payload={payload}
        activeDate={activeDate}
        evidenceCount={evidenceCount}
      />

      <DailyCollectionAlert
        payload={payload}
        loadState={loadState}
        errorMessage={errorMessage}
      />

      {loadState === "loading" && payload !== null && (
        <div className="historyLoadingBanner">
          <LoadingText label="正在刷新日常分析" />
        </div>
      )}

      {payload ? (
        <>
          <DailyCoachingSummary payload={payload} />
          <div className={`dailyAnalysisReviewShell ${isPersonalDrawerOpen ? "drawerOpen" : ""}`}>
            <DailyReviewOperatorList
              payload={payload}
              selectedOperatorId={isPersonalDrawerOpen ? selectedPersonalOperatorId : ""}
              onSelectOperator={handleSelectPersonalOperator}
            />
            <DailyPersonalDetailDrawer
              payload={payload}
              operatorId={selectedPersonalOperatorId}
              isOpen={isPersonalDrawerOpen}
              onClose={() => setPersonalDrawerOpen(false)}
            />
          </div>
        </>
      ) : loadState === "loading" ? (
        <section className="panel dailyCoachingHero">
          <LoadingText label="正在加载日常分析" />
        </section>
      ) : (
        <section className="panel historyPanel">
          <EmptyQuality label="暂无日常分析数据" />
        </section>
      )}
    </>
  );
}

function DailyStatusBadge({ status }: { status: DailyAnalysisStatus }) {
  return (
    <span className={`dailyStatusBadge ${status}`}>
      {DAILY_ANALYSIS_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function DailyOverviewStrip({
  payload,
  activeDate,
  evidenceCount
}: {
  payload: DailyAnalysisPayload | null;
  activeDate: string;
  evidenceCount: number;
}) {
  const items = buildDailyOverviewItems(payload, activeDate, evidenceCount);
  return (
    <section className="panel dailyOverviewStrip">
      <div className="panelHead">
        <h2>整体概览</h2>
        <span className="panelNote">{payload?.scope.display_name ?? "未生成"}</span>
      </div>
      <div className="dailyOverviewItems">
        {items.map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            {item.note && <small>{item.note}</small>}
          </div>
        ))}
      </div>
    </section>
  );
}

function DailyCollectionAlert({
  payload,
  loadState,
  errorMessage
}: {
  payload: DailyAnalysisPayload | null;
  loadState: LoadState;
  errorMessage: string | null;
}) {
  const issues = buildCollectionIssues(payload, loadState, errorMessage);
  const tone = loadState === "error" || payload?.status === "failed" ? "error" : issues.length > 0 ? "warning" : "ok";
  return (
    <section className={`dailyCollectionAlert ${tone}`}>
      <div>
        <strong>采集状态</strong>
        <span>
          {issues.length === 0
            ? "采集状态：正常，当前分析可按已同步证据阅读。"
            : `发现 ${issues.length} 个数据质量提示，以下判断需结合可用证据阅读。`}
        </span>
      </div>
      {issues.length > 0 && (
        <ul>
          {issues.slice(0, 4).map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DailyCoachingSummary({ payload }: { payload: DailyAnalysisPayload }) {
  const issueCount = buildCollectionIssues(payload, "ready", null).length;
  return (
    <section className="panel dailyCoachingHero">
      <div className="panelHead">
        <h2>今日团队判断</h2>
        <DailyStatusBadge status={payload.status} />
      </div>
      <p>{payload.model_analysis.summary}</p>
      <div className="dailyCoachingMeta">
        <span>基于当前可用证据</span>
        <span>{payload.model_analysis.attributions.length} 个辅导线索</span>
        <span>{issueCount > 0 ? `${issueCount} 个数据缺口` : "数据质量正常"}</span>
      </div>
    </section>
  );
}

function DailyReviewOperatorList({
  payload,
  selectedOperatorId,
  onSelectOperator
}: {
  payload: DailyAnalysisPayload;
  selectedOperatorId: string;
  onSelectOperator: (operatorId: string) => void;
}) {
  const summaries = dailyOperatorSummaries(payload);
  return (
    <section className="panel dailyReviewOperatorList">
      <div className="panelHead">
        <h2>今日复盘对象</h2>
        <span className="panelNote">按严重程度排序 · {summaries.length} 人</span>
      </div>
      {summaries.length === 0 ? (
        <EmptyQuality label="暂无今日复盘对象" />
      ) : (
        <div className="dailyReviewOperatorRows">
          {summaries.map((item, index) => (
            <article
              className={`dailyReviewOperatorRow ${item.operatorId === selectedOperatorId ? "selected" : ""}`}
              key={item.operatorId}
            >
              <div className="dailyReviewOperatorRank">
                <strong>{index + 1}</strong>
                <span>严重程度</span>
              </div>
              <div className="dailyReviewOperatorBody">
                <header>
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.severityLabel} · {item.quality}</span>
                  </div>
                  <button
                    className="tableActionButton"
                    type="button"
                    onClick={() => onSelectOperator(item.operatorId)}
                  >
                    查看详情
                  </button>
                </header>
                <dl>
                  <div>
                    <dt>复盘重点</dt>
                    <dd>{item.focus}</dd>
                  </div>
                  <div>
                    <dt>数据波动</dt>
                    <dd>{item.volatility}</dd>
                  </div>
                  <div>
                    <dt>优化建议</dt>
                    <dd>{item.action}</dd>
                  </div>
                  <div>
                    <dt>证据覆盖</dt>
                    <dd>{item.evidenceCount} 条</dd>
                  </div>
                </dl>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function DailyPersonalDetailDrawer({
  payload,
  operatorId,
  isOpen,
  onClose
}: {
  payload: DailyAnalysisPayload;
  operatorId: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <aside
      className={`dailyPersonalDrawer ${isOpen ? "open" : ""}`}
      aria-hidden={!isOpen}
      aria-label="详情抽屉"
    >
      <div className="dailyPersonalDrawerHead">
        <strong>详情抽屉</strong>
        <button className="tableActionButton" type="button" onClick={onClose}>
          关闭详情
        </button>
      </div>
      {isOpen && (
        <DailyPersonalDetailPanel
          payload={payload}
          operatorId={operatorId}
        />
      )}
    </aside>
  );
}

function DailyPersonalDetailPanel({
  payload,
  operatorId
}: {
  payload: DailyAnalysisPayload;
  operatorId: string;
}) {
  const detail = dailyPersonalDetail(payload, operatorId);
  if (!detail) {
    return (
      <section className="panel dailyPersonalDetailPanel">
        <EmptyQuality label="暂无个人详情分析" />
      </section>
    );
  }
  return (
    <section className="panel dailyPersonalDetailPanel">
      <div className="panelHead">
        <div>
          <h2>个人详情分析</h2>
          <p>{detail.name} · {detail.summary.severityLabel} · {detail.summary.quality}</p>
        </div>
        <DailyStatusBadge status={payload.status} />
      </div>

      <section className="dailyPersonalSection">
        <div className="qualityBlockHead">
          <h3>核心数据</h3>
          <span>{detail.coreMetrics.length} 项</span>
        </div>
        <div className="dailyPersonalCoreGrid">
          {detail.coreMetrics.map((item) => (
            <div key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.note}</small>
            </div>
          ))}
        </div>
      </section>

      <div className="dailyPersonalColumns">
        <section className="dailyPersonalSection">
          <div className="qualityBlockHead">
            <h3>波动归因</h3>
            <span>{detail.volatilityAttributions.length} 条</span>
          </div>
          <div className="dailyPersonalList">
            {detail.volatilityAttributions.map((item) => (
              <article key={`${item.metric}-${item.baseline}`}>
                <strong>{item.metric}</strong>
                <span>{item.baseline} {item.delta} · 当前 {item.current}，基线 {item.baselineValue}</span>
                <p>{item.reason}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="dailyPersonalSection">
          <div className="qualityBlockHead">
            <h3>问题排查</h3>
            <span>{detail.issueChecks.length} 项</span>
          </div>
          <div className="dailyPersonalList">
            {detail.issueChecks.map((item) => (
              <article key={item.title}>
                <strong>{item.title}</strong>
                <span>{item.signal}</span>
                <p>{item.check}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="dailyPersonalSection">
        <div className="qualityBlockHead">
          <h3>辅导建议</h3>
          <span>{detail.coachingSuggestions.length} 条</span>
        </div>
        <div className="dailyPersonalAdviceRows">
          {detail.coachingSuggestions.map((item, index) => (
            <article key={item}>
              <span>{index + 1}</span>
              <p>{item}</p>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function StatusMetric({
  label,
  status,
  loading = false
}: {
  label: string;
  status: HealthStatus;
  loading?: boolean;
}) {
  return (
    <article className="metric">
      <span className="metricLabel">{label}</span>
      {loading ? <strong>...</strong> : <StatusPill status={status} large />}
    </article>
  );
}

function LoadingText({ label }: { label: string }) {
  return (
    <span className="loadingText">
      <span className="spinner" aria-hidden="true" />
      {label}
    </span>
  );
}

type OperatorRowItem = {
  profile: OperatorProfile;
  active: ActiveOperator | null;
  daily: DailyActiveDuration | null;
};

function OperatorRow({
  item,
  selected,
  activityLoading,
  onSelect
}: {
  item: OperatorRowItem;
  selected: boolean;
  activityLoading: boolean;
  onSelect: (operatorId: string) => void;
}) {
  const { profile, active } = item;
  const dailyText = item.daily
    ? `今日 ${formatDuration(item.daily.active_minutes)}`
    : "今日暂无时长";
  const jobText = active
    ? active.job_name ?? active.job_id ?? "未关联职位"
    : "未关联职位";
  const statusText = active
    ? `${formatAction(active.last_action)} · ${jobText}`
    : activityLoading
      ? "状态加载中"
      : "暂无活跃";
  const timeText = active
    ? `${active.minutes_since_active} 分钟前`
    : activityLoading
      ? "加载中"
      : "未活跃";
  return (
    <button
      className={`operatorRow ${selected ? "selected" : ""}`}
      type="button"
      onClick={() => onSelect(profile.operator_id)}
    >
      <span>
        <span className="operatorMain">
          <span className={`statusDot ${active ? "" : activityLoading ? "loading" : "inactive"}`} />
          {profile.display_name}
        </span>
        <span className="operatorMeta">
          {profile.operator_id}
          {profile.account_name ? ` · ${profile.account_name}` : ""}
          {` · ${statusText}`}
          {` · ${dailyText}`}
        </span>
      </span>
      <span className={`operatorTime ${active ? "" : activityLoading ? "loading" : "inactive"}`}>
        {timeText}
      </span>
    </button>
  );
}

function OperatorDetail({
  payload,
  loadState,
  errorMessage
}: {
  payload: OperatorPayload | null;
  loadState: LoadState;
  errorMessage: string | null;
}) {
  if (loadState === "loading" && payload === null) {
    return <LoadingText label="正在加载单人明细" />;
  }
  if (loadState === "error" && payload === null) {
    return <div className="inlineError">{errorMessage}</div>;
  }
  const funnel = payload?.operator.funnel;
  const chat = payload?.operator.chat;
  const dailyDuration = payload?.operator.daily_active_duration ?? null;
  const pluginVersion = payload?.operator.plugin_version ?? null;
  const pluginVersionObservedAt = payload?.operator.plugin_version_observed_at ?? null;
  const detailOpened = funnel?.detail_opened ?? 0;
  const bossLikeDetailOpened = detailOpened + (chat?.chat_opened ?? funnel?.chat_opened ?? 0);
  const greetingClicked = funnel?.greeting_clicked ?? 0;
  const greetingSucceeded = funnel?.greeting_succeeded ?? 0;
  const values = [
    ["卡片曝光", funnel?.card_exposed ?? 0],
    ["详情打开", detailOpened],
    ["后台近似", bossLikeDetailOpened],
    ["打招呼点击", greetingClicked],
    ["打招呼成功", greetingSucceeded],
    ["聊天快照", funnel?.chat_snapshots ?? 0]
  ] as const;
  const maxValue = Math.max(1, ...values.map(([, value]) => value));

  return (
    <>
      <div className="durationSummary">
        <div>
          <span>当日活跃</span>
          <strong>{dailyDuration ? formatDuration(dailyDuration.active_minutes) : "暂无数据"}</strong>
        </div>
        <div>
          <span>首末活跃</span>
          <strong>
            {dailyDuration?.first_active_minute && dailyDuration?.last_active_minute
              ? `${formatTime(dailyDuration.first_active_minute).slice(0, 5)} - ${formatTime(dailyDuration.last_active_minute).slice(0, 5)}`
              : "--"}
          </strong>
        </div>
        <div>
          <span>统计来源</span>
          <strong>{dailyDuration ? "分钟汇总" : "--"}</strong>
          {dailyDuration && (
            <small>{dailyDuration.source_row_count} 行来源记录</small>
          )}
        </div>
        <div>
          <span>插件版本</span>
          <strong>{pluginVersion ?? "--"}</strong>
          {pluginVersionObservedAt && (
            <small>最近观测 {formatDateTime(pluginVersionObservedAt)}</small>
          )}
        </div>
      </div>
      <div className="funnel">
        <FunnelCell label="卡片" value={funnel?.card_exposed ?? 0} />
        <FunnelCell label="详情" value={detailOpened} />
        <FunnelCell label="后台口径" value={bossLikeDetailOpened} />
        <FunnelCell label="招呼成功" value={greetingSucceeded} />
        <FunnelCell label="聊天" value={(funnel?.chat_snapshots ?? 0) + (funnel?.chat_opened ?? 0)} />
      </div>
      <div className="bars">
        {values.map(([label, value]) => (
          <div key={label}>
            <div className="barLabel">
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
            <div className="barTrack">
              <div className="barFill" style={{ width: `${Math.max(4, (value / maxValue) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <MinuteLineChart points={payload?.operator.minute_points ?? []} />
    </>
  );
}

function HistoryTab({
  payload,
  loadState,
  errorMessage,
  operators,
  operatorId,
  activeDate,
  onOperatorIdChange,
  onActiveDateChange,
  onQuery
}: {
  payload: HistoryPayload | null;
  loadState: LoadState;
  errorMessage: string | null;
  operators: OperatorProfile[];
  operatorId: string;
  activeDate: string;
  onOperatorIdChange: (operatorId: string) => void;
  onActiveDateChange: (activeDate: string) => void;
  onQuery: () => void;
}) {
  const [detailOperatorId, setDetailOperatorId] = useState("");
  const [detailPayload, setDetailPayload] = useState<HistoryPayload | null>(null);
  const [detailLoadState, setDetailLoadState] = useState<LoadState>("ready");
  const [detailErrorMessage, setDetailErrorMessage] = useState<string | null>(null);
  const operatorById = useMemo(
    () => new Map(operators.map((operator) => [operator.operator_id, operator])),
    [operators]
  );
  const history = payload?.history;
  const sourceText = payload ? formatHistoryPayloadSource(payload) : "日级基础指标：加载中";
  const records = history?.records ?? [];
  const emptyReason = history ? historyEmptyReason(history) : null;
  const dialogMetricGap = hasHistoryDialogMetricGap(records);
  const isQuerying = loadState === "loading";

  useEffect(() => {
    if (!detailOperatorId) {
      return;
    }
    let cancelled = false;
    async function loadOperatorHistory() {
      try {
        setDetailLoadState("loading");
        setDetailErrorMessage(null);
        setDetailPayload(null);
        const nextPayload = await fetchHistory({
          operatorId: detailOperatorId,
          days: 31
        });
        if (cancelled) return;
        setDetailPayload(nextPayload);
        setDetailLoadState("ready");
      } catch (error) {
        if (cancelled) return;
        setDetailLoadState("error");
        setDetailErrorMessage(error instanceof Error ? error.message : "未知错误");
      }
    }
    loadOperatorHistory();
    return () => {
      cancelled = true;
    };
  }, [detailOperatorId]);

  if (detailOperatorId) {
    return (
      <HistoryOperatorDetail
        operatorId={detailOperatorId}
        profile={operatorById.get(detailOperatorId) ?? null}
        payload={detailPayload}
        loadState={detailLoadState}
        errorMessage={detailErrorMessage}
        operatorById={operatorById}
        onBack={() => setDetailOperatorId("")}
      />
    );
  }

  return (
    <>
      <section className="panel historyFilters">
        <label>
          <span>统计日期</span>
          <input
            type="date"
            value={activeDate}
            onChange={(event) => onActiveDateChange(event.target.value)}
          />
        </label>
        <label>
          <span>操作员 ID</span>
          <input
            value={operatorId}
            list="history-operator-options"
            placeholder="全部操作员"
            onChange={(event) => onOperatorIdChange(event.target.value)}
          />
          <datalist id="history-operator-options">
            {operators.map((operator) => (
              <option key={operator.operator_id} value={operator.operator_id}>
                {operator.display_name}
              </option>
            ))}
          </datalist>
        </label>
        <button
          className="queryButton"
          type="button"
          onClick={onQuery}
          disabled={isQuerying}
        >
          {isQuerying ? (
            <LoadingText label="查询中" />
          ) : "查询"}
        </button>
        <span className={`queryState ${loadState}`}>
          {loadState === "loading"
            ? "正在查询日级基础指标"
            : loadState === "error"
              ? "查询失败"
              : payload
                ? "查询完成"
                : "等待查询"}
        </span>
      </section>

      {loadState === "error" && (
        <div className="inlineError qualityError">{errorMessage}</div>
      )}

      <section className="panel historyPanel">
        <div className="panelHead">
          <h2>历史数据</h2>
          <span className="panelNote">{isQuerying ? "查询中" : sourceText}</span>
        </div>
        {loadState === "loading" && payload === null ? (
          <LoadingText label="正在加载历史数据" />
        ) : (
          <>
            {isQuerying && payload !== null && (
              <div className="historyLoadingBanner">
                <LoadingText label="正在刷新查询结果" />
              </div>
            )}
            <div className="historySummary">
              <div>
                <span>查询状态</span>
                <strong>{HISTORY_STATUS_LABELS[history?.status ?? "empty"]}</strong>
              </div>
              <div>
                <span>匹配记录</span>
                <strong>{history?.record_count ?? 0}</strong>
              </div>
              <div>
                <span>来源记录</span>
                <strong>{history?.source_record_count ?? 0}</strong>
              </div>
              <div>
                <span>最新写入</span>
                <strong>{history?.latest_recorded_at ? formatDateTime(history.latest_recorded_at) : "--"}</strong>
              </div>
            </div>
            <div className="historyNotice">
              来源：CLS 日级基础指标库；本页不使用分钟汇总累加。
            </div>
            {emptyReason && (
              <div className="historyNotice">
                {emptyReason}
              </div>
            )}
            {dialogMetricGap && (
              <div className="historyNotice">
                已有聊天快照数据，但日级指标库尚未写入对话分析字段；首轮回复、BOSS 结束和全轮回复暂按暂无展示。
              </div>
            )}
            <HistoryTable
              records={records}
              operatorById={operatorById}
              onOperatorDetail={setDetailOperatorId}
            />
          </>
        )}
      </section>
    </>
  );
}

function HistoryTable({
  records,
  operatorById,
  onOperatorDetail
}: {
  records: DailyBasicStatsRecord[];
  operatorById: Map<string, OperatorProfile>;
  onOperatorDetail?: (operatorId: string) => void;
}) {
  if (records.length === 0) {
    return <div className="emptyQuality">暂无日级基础统计</div>;
  }
  return (
    <div className="historyTableWrap">
      <table className="historyTable">
        <thead>
          <tr>
            <th>日期</th>
            <th>操作员</th>
            <th>账号</th>
            <th>活跃</th>
            <th>曝光/详情</th>
            <th>招呼</th>
            <th>聊天</th>
            <th>首轮回复</th>
            <th>BOSS 结束</th>
            <th>全轮回复</th>
            <th>总事件</th>
            <th>状态</th>
            {onOperatorDetail && <th>操作</th>}
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <HistoryRow
              key={`${record.active_date}-${record.operator_id}`}
              record={record}
              profile={operatorById.get(record.operator_id) ?? null}
              onOperatorDetail={onOperatorDetail}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryRow({
  record,
  profile,
  onOperatorDetail
}: {
  record: DailyBasicStatsRecord;
  profile: OperatorProfile | null;
  onOperatorDetail?: (operatorId: string) => void;
}) {
  const operatorLabel = profile?.display_name ?? record.operator_id;
  const accountName = record.operator_account_name ?? record.boss_account_name ?? profile?.account_name ?? "--";
  const hasValues = record.has_values !== false;
  const activeMinutes = recordNumber(record, "active_minutes");
  const cardExposed = recordNumber(record, "card_exposed");
  const detailOpened = recordNumber(record, "detail_opened");
  const greetingClicked = recordNumber(record, "greeting_clicked");
  const greetingSucceeded = recordNumber(record, "greeting_succeeded");
  const chatOpened = recordNumber(record, "chat_opened");
  const snapshotCaptured = recordNumber(record, "snapshot_captured");
  const totalEvents = recordNumber(record, "total_events");
  const firstRoundCandidateInitiatedCount = recordNumber(record, "first_round_candidate_initiated_count");
  const firstRoundBossRepliedCount = recordNumber(record, "first_round_boss_replied_count");
  const firstRoundBossReplyElapsedMedianMs = recordNumber(record, "first_round_boss_reply_elapsed_median_ms");
  const firstRoundBossReplyElapsedAvgMs = recordNumber(record, "first_round_boss_reply_elapsed_avg_ms");
  const chatConversationCount = recordNumber(record, "chat_conversation_count");
  const bossEndedConversationCount = recordNumber(record, "boss_ended_conversation_count");
  const bossReplyCount = recordNumber(record, "boss_reply_count");
  const bossReplyElapsedMedianMs = recordNumber(record, "boss_reply_elapsed_median_ms");
  const bossReplyElapsedAvgMs = recordNumber(record, "boss_reply_elapsed_avg_ms");
  const activeText = hasValues
    ? formatDuration(activeMinutes)
    : "--";
  const rangeText = record.first_active_minute && record.last_active_minute
    ? `${formatTime(record.first_active_minute).slice(0, 5)}-${formatTime(record.last_active_minute).slice(0, 5)}`
    : "--";
  const firstRoundRate = formatRatio(
    firstRoundBossRepliedCount,
    firstRoundCandidateInitiatedCount
  );
  const bossEndRate = formatRatio(bossEndedConversationCount, chatConversationCount);
  return (
    <tr className={hasValues ? "" : "missingValues"}>
      <td>{record.active_date}</td>
      <td>
        <span className="historyOperator">{operatorLabel}</span>
        <small>{record.operator_id}</small>
      </td>
      <td>{accountName}</td>
      <td>
        <strong>{activeText}</strong>
        <small>{rangeText}</small>
      </td>
      <td>{hasValues ? `${cardExposed} / ${detailOpened}` : "--"}</td>
      <td>{hasValues ? `${greetingClicked} / ${greetingSucceeded}` : "--"}</td>
      <td>{hasValues ? `${chatOpened} / ${snapshotCaptured}` : "--"}</td>
      <td>
        {hasValues ? (
          <HistoryMetricCell
            primary={firstRoundRate}
            secondary={`中 ${formatElapsedMs(firstRoundBossReplyElapsedMedianMs)} / 均 ${formatElapsedMs(firstRoundBossReplyElapsedAvgMs)}`}
          />
        ) : "--"}
      </td>
      <td>
        {hasValues ? (
          <HistoryMetricCell
            primary={bossEndRate}
            secondary={`${bossEndedConversationCount}/${chatConversationCount} 会话`}
          />
        ) : "--"}
      </td>
      <td>
        {hasValues ? (
          <HistoryMetricCell
            primary={`${bossReplyCount} 次`}
            secondary={`中 ${formatElapsedMs(bossReplyElapsedMedianMs)} / 均 ${formatElapsedMs(bossReplyElapsedAvgMs)}`}
          />
        ) : "--"}
      </td>
      <td>{hasValues ? totalEvents : "--"}</td>
      <td>
        <span className={`historyStatus ${hasValues ? "ok" : "missing"}`}>
          {hasValues ? "有数值" : "指标值暂不可查"}
        </span>
      </td>
      {onOperatorDetail && (
        <td>
          <button
            className="tableActionButton"
            type="button"
            onClick={() => onOperatorDetail(record.operator_id)}
          >
            查询详情
          </button>
        </td>
      )}
    </tr>
  );
}

function HistoryMetricCell({
  primary,
  secondary
}: {
  primary: string;
  secondary: string;
}) {
  return (
    <span className="historyMetricCell">
      <strong>{primary}</strong>
      <small>{secondary}</small>
    </span>
  );
}

function HistoryOperatorDetail({
  operatorId,
  profile,
  payload,
  loadState,
  errorMessage,
  operatorById,
  onBack
}: {
  operatorId: string;
  profile: OperatorProfile | null;
  payload: HistoryPayload | null;
  loadState: LoadState;
  errorMessage: string | null;
  operatorById: Map<string, OperatorProfile>;
  onBack: () => void;
}) {
  const records = payload?.history.records ?? [];
  const totalActiveMinutes = records.reduce((total, record) => total + recordNumber(record, "active_minutes"), 0);
  const totalEvents = records.reduce((total, record) => total + recordNumber(record, "total_events"), 0);
  const dialogMetricGap = hasHistoryDialogMetricGap(records);
  const operatorLabel = profile?.display_name ?? operatorId;
  return (
    <section className="panel historyPanel">
      <div className="detailTopbar">
        <button className="backButton" type="button" onClick={onBack}>
          返回
        </button>
        <div>
          <p className="eyebrow">操作员历史详情</p>
          <h2>{operatorLabel}</h2>
        </div>
      </div>
      {loadState === "error" && (
        <div className="inlineError qualityError">{errorMessage}</div>
      )}
      {loadState === "loading" && payload === null ? (
        <LoadingText label="正在加载操作员每日明细" />
      ) : (
        <>
          {loadState === "loading" && payload !== null && (
            <div className="historyLoadingBanner">
              <LoadingText label="正在刷新操作员每日明细" />
            </div>
          )}
          <div className="historySummary">
            <div>
              <span>操作员 ID</span>
              <strong>{operatorId}</strong>
            </div>
            <div>
              <span>统计天数</span>
              <strong>{records.length}</strong>
            </div>
            <div>
              <span>累计活跃</span>
              <strong>{formatDuration(totalActiveMinutes)}</strong>
            </div>
            <div>
              <span>累计事件</span>
              <strong>{totalEvents}</strong>
            </div>
          </div>
          <div className="historyNotice">
            来源：CLS 日级基础指标库；按操作员查询最近 31 天日级明细。
          </div>
          {dialogMetricGap && (
            <div className="historyNotice">
              已有聊天快照数据，但日级指标库尚未写入对话分析字段；首轮回复、BOSS 结束和全轮回复暂按暂无展示。
            </div>
          )}
          <HistoryTable records={records} operatorById={operatorById} />
        </>
      )}
    </section>
  );
}

function DataQualityTab({
  payload,
  loadState,
  errorMessage,
  operators,
  pluginVersionOptions,
  operatorId,
  pluginVersion,
  onOperatorIdChange,
  onPluginVersionChange
}: {
  payload: LogQualityPayload | null;
  loadState: LoadState;
  errorMessage: string | null;
  operators: OperatorProfile[];
  pluginVersionOptions: string[];
  operatorId: string;
  pluginVersion: string;
  onOperatorIdChange: (operatorId: string) => void;
  onPluginVersionChange: (pluginVersion: string) => void;
}) {
  return (
    <>
      <section className="panel qualityFilters">
        <label>
          <span>操作员 ID</span>
          <input
            value={operatorId}
            list="quality-operator-options"
            placeholder="全部操作员"
            onChange={(event) => onOperatorIdChange(event.target.value)}
          />
          <datalist id="quality-operator-options">
            {operators.map((operator) => (
              <option key={operator.operator_id} value={operator.operator_id}>
                {operator.display_name}
              </option>
            ))}
          </datalist>
        </label>
        <label>
          <span>插件版本</span>
          <input
            value={pluginVersion}
            list="quality-plugin-version-options"
            placeholder="全部版本"
            onChange={(event) => onPluginVersionChange(event.target.value)}
          />
          <datalist id="quality-plugin-version-options">
            {pluginVersionOptions.map((version) => (
              <option key={version} value={version}>{version}</option>
            ))}
          </datalist>
        </label>
      </section>
      {loadState === "error" && (
        <div className="inlineError qualityError">{errorMessage}</div>
      )}
      <DataQualityPanel payload={payload} loading={loadState === "loading"} />
    </>
  );
}

function DataQualityPanel({
  payload,
  loading
}: {
  payload: LogQualityPayload | null;
  loading: boolean;
}) {
  const quality = payload?.quality;
  const versions = quality?.version_summaries ?? [];
  const eventSummaries = quality?.event_summaries ?? [];
  const checkedCount = quality?.checked_event_count ?? 0;
  const findingCount = quality?.finding_count ?? 0;
  const latestWindow = quality?.latest_window_start;
  const sourceText = payload ? formatLogQualityPayloadSource(payload) : "10分钟质量：加载中";

  return (
    <section className="panel qualityPanel">
      <div className="panelHead">
        <h2>数据质量</h2>
        <span className="panelNote">{sourceText}</span>
      </div>
      {loading && payload === null ? (
        <LoadingText label="正在加载质量报告" />
      ) : (
        <>
          <div className="qualitySummary">
            <div>
              <span>质量状态</span>
              <StatusPill status={quality?.status ?? "unknown"} />
            </div>
            <div>
              <span>检查事件</span>
              <strong>{checkedCount}</strong>
            </div>
            <div>
              <span>质量问题</span>
              <strong>{findingCount}</strong>
            </div>
            <div>
              <span>问题密度</span>
              <strong>{formatPercent(quality?.finding_rate ?? 0)}</strong>
            </div>
            <div>
              <span>最新窗口</span>
              <strong>{latestWindow ? formatTime(latestWindow).slice(0, 5) : "--"}</strong>
              <small>{quality?.window_minutes ?? 10} 分钟粒度</small>
            </div>
          </div>

          <div className="qualityGrid">
            <section className="qualityBlock">
              <div className="qualityBlockHead">
                <h3>插件版本</h3>
                <span>{versions.length} 个版本</span>
              </div>
              <div className="qualityRows">
                {versions.length === 0 && <EmptyQuality label="暂无 10 分钟质量汇总" />}
                {versions.map((item) => (
                  <div className="qualityRow" key={item.plugin_version}>
                    <div className="qualityRowMain">
                      <span className="qualityTitle">
                        <StatusDot status={item.status} />
                        {item.plugin_version}
                      </span>
                      <span className="qualityMeta">
                        {item.checked_event_count} 条检查 · {item.finding_count} 个问题 · {formatPercent(item.finding_rate)}
                      </span>
                      <IssueList issues={item.top_issues} />
                    </div>
                    <StatusPill status={item.status} />
                  </div>
                ))}
              </div>
            </section>

            <section className="qualityBlock">
              <div className="qualityBlockHead">
                <h3>事件类型问题排行</h3>
                <span>{eventSummaries.length} 条</span>
              </div>
              <div className="qualityRows">
                {eventSummaries.length === 0 && <EmptyQuality label="暂无事件级质量问题" />}
                {eventSummaries.map((item) => (
                  <div className="qualityRow" key={`${item.plugin_version}-${item.event_type}`}>
                    <div className="qualityRowMain">
                      <span className="qualityTitle">
                        <StatusDot status={item.status} />
                        {formatAction(item.event_type)}
                      </span>
                      <span className="qualityMeta">
                        {item.plugin_version} · {item.checked_event_count} 条检查 · {item.finding_count} 个问题
                      </span>
                      <IssueList issues={item.top_issues} />
                    </div>
                    <strong className="qualityRate">{formatPercent(item.finding_rate)}</strong>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </>
      )}
    </section>
  );
}

function EmptyQuality({ label }: { label: string }) {
  return <div className="emptyQuality">{label}</div>;
}

function IssueList({ issues }: { issues: Array<{ key: string; label: string; count: number }> }) {
  if (issues.length === 0) {
    return <span className="issueList">无主要问题</span>;
  }
  return (
    <span className="issueList">
      {issues.map((issue) => `${issue.label} ${issue.count}`).join(" · ")}
    </span>
  );
}

function StatusPill({ status, large = false }: { status: HealthStatus; large?: boolean }) {
  return (
    <span className={`statusPill ${status} ${large ? "large" : ""}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function StatusDot({ status }: { status: HealthStatus }) {
  return <span className={`qualityDot ${status}`} />;
}

function MinuteLineChart({ points }: { points: OperatorMinutePoint[] }) {
  const width = 520;
  const height = 220;
  const padding = { top: 18, right: 18, bottom: 36, left: 34 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const sortedPoints = [...points].sort((left, right) => (
    new Date(left.minute).getTime() - new Date(right.minute).getTime()
  ));
  const maxValue = Math.max(
    1,
    ...sortedPoints.flatMap((point) => CHART_SERIES.map((series) => point[series.key] ?? 0))
  );
  const xFor = (index: number) => padding.left + (
    sortedPoints.length <= 1 ? innerWidth : (index / (sortedPoints.length - 1)) * innerWidth
  );
  const yFor = (value: number) => padding.top + innerHeight - (value / maxValue) * innerHeight;

  return (
    <div className="minuteChart">
      <div className="chartHead">
        <h3>分钟趋势</h3>
        <div className="chartLegend">
          {CHART_SERIES.map((series) => (
            <span key={series.key}>
              <i style={{ background: series.color }} />
              {series.label}
            </span>
          ))}
        </div>
      </div>
      {sortedPoints.length === 0 ? (
        <div className="emptyChart">暂无分钟数据</div>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="操作员分钟趋势折线图">
          <line
            className="axisLine"
            x1={padding.left}
            y1={padding.top + innerHeight}
            x2={padding.left + innerWidth}
            y2={padding.top + innerHeight}
          />
          <line
            className="axisLine"
            x1={padding.left}
            y1={padding.top}
            x2={padding.left}
            y2={padding.top + innerHeight}
          />
          {[0, 0.5, 1].map((ratio) => {
            const y = padding.top + innerHeight - ratio * innerHeight;
            return (
              <g key={ratio}>
                <line className="gridLine" x1={padding.left} y1={y} x2={padding.left + innerWidth} y2={y} />
                <text className="axisText" x={padding.left - 8} y={y + 4} textAnchor="end">
                  {Math.round(maxValue * ratio)}
                </text>
              </g>
            );
          })}
          {CHART_SERIES.map((series) => {
            const path = sortedPoints
              .map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(point[series.key] ?? 0)}`)
              .join(" ");
            return (
              <g key={series.key}>
                <path className="chartLine" d={path} stroke={series.color} />
                {sortedPoints.map((point, index) => (
                  <circle
                    key={`${series.key}-${point.minute}`}
                    className="chartDot"
                    cx={xFor(index)}
                    cy={yFor(point[series.key] ?? 0)}
                    r="3"
                    fill={series.color}
                  />
                ))}
              </g>
            );
          })}
          {sortedPoints.map((point, index) => {
            if (index !== 0 && index !== sortedPoints.length - 1) {
              return null;
            }
            return (
              <text
                key={point.minute}
                className="axisText"
                x={xFor(index)}
                y={height - 10}
                textAnchor={index === 0 ? "start" : "end"}
              >
                {formatTime(point.minute).slice(0, 5)}
              </text>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function FunnelCell({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatAction(action: string) {
  return ACTION_LABELS[action] ?? action;
}

function dailyEvidenceCount(payload: DailyAnalysisPayload) {
  return payload.evidence_bundle.operator_results.length
    + payload.evidence_bundle.job_results.length
    + payload.evidence_bundle.behavior_summaries.length
    + payload.evidence_bundle.job_actions.length;
}

function formatDailySyncState(payload: DailyAnalysisPayload | null, key: string) {
  if (!payload) {
    return "--";
  }
  const value = payload.sync_state[key];
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return formatDateTime(value);
  }
  return formatEvidenceValue(value);
}

function buildDailyOverviewItems(
  payload: DailyAnalysisPayload | null,
  activeDate: string,
  evidenceCount: number
) {
  if (!payload) {
    return [
      { label: "分析日期", value: activeDate },
      { label: "覆盖操作员", value: "未覆盖" },
      { label: "证据数量", value: String(evidenceCount) },
      { label: "关键漏斗", value: "暂无", note: "等待分析包生成" },
    ];
  }
  const totals = dailyOfficialTotals(payload);
  const coverage = dailyOperatorCoverage(payload);
  return [
    { label: "分析日期", value: payload.analysis_date },
    { label: "覆盖操作员", value: coverage === null ? "未覆盖" : `${coverage} 人` },
    { label: "证据数量", value: `${evidenceCount} 条` },
    {
      label: "关键漏斗",
      value: `查看 ${formatDailyNumber(totals.boss_view_candidates)} · 沟通 ${formatDailyNumber(totals.boss_communication_count)}`,
      note: `简历 ${formatDailyNumber(totals.resume_received)} · 微信 ${formatDailyNumber(totals.phone_wechat_exchanged)}`
    },
    {
      label: "模型生成",
      value: formatDateTime(payload.model_analysis.generated_at),
      note: payload.model_analysis.analyzer
    },
  ];
}

function buildCollectionIssues(
  payload: DailyAnalysisPayload | null,
  loadState: LoadState,
  errorMessage: string | null
) {
  const issues: string[] = [];
  if (loadState === "loading" && !payload) {
    issues.push("分析包正在生成，首屏结论暂不可用");
  }
  if (loadState === "error") {
    issues.push(errorMessage || "分析请求失败");
  }
  if (!payload) {
    return issues;
  }
  if (payload.status === "partial") {
    issues.push("当前分析为部分可用，部分证据缺失");
  }
  if (payload.status === "failed") {
    issues.push("当前分析失败，请先检查官方结果或模型输出");
  }
  if (payload.status === "analyzing") {
    issues.push("模型分析仍在生成，当前结果只可作为临时参考");
  }
  issues.push(...payload.errors);
  issues.push(...payload.data_quality.missing_fields.map((item) => `缺少字段：${item}`));
  issues.push(...payload.data_quality.unmatched_jobs.map((item) => `岗位未匹配：${item}`));
  issues.push(...payload.data_quality.low_sample_warnings.map((item) => `低样本提示：${item}`));
  return Array.from(new Set(issues));
}

function dailySelectedOperatorId(
  payload: DailyAnalysisPayload,
  selectedOperatorId: string,
  filterOperatorId: string,
  summaries: DailyOperatorSummary[]
) {
  const operatorIds = new Set(payload.evidence_bundle.operator_results.map(dailyOperatorEvidenceId));
  const selected = selectedOperatorId.trim();
  if (selected && operatorIds.has(selected)) {
    return selected;
  }
  const filtered = filterOperatorId.trim();
  if (filtered && operatorIds.has(filtered)) {
    return filtered;
  }
  return summaries[0]?.operatorId ?? payload.evidence_bundle.operator_results[0]?.operator_id ?? "";
}

function dailyOperatorSummaries(payload: DailyAnalysisPayload) {
  return payload.evidence_bundle.operator_results.map((item) => {
    const current = asRecord(item.values.current);
    const values = asRecord(item.values);
    const baselines = asRecord(item.values.baselines);
    const operatorId = item.operator_id ?? item.evidence_id;
    const name = formatEvidenceValue(values.display_name || values.boss_name || item.title);
    const views = toFiniteNumber(current.boss_view_candidates);
    const chats = toFiniteNumber(current.boss_started_chats);
    const communication = toFiniteNumber(current.boss_communication_count);
    const resumes = toFiniteNumber(current.resume_received);
    const viewToChat = views > 0 ? chats / views : 0;
    const chatToCommunication = chats > 0 ? communication / chats : 0;
    const evidenceCount = dailyEvidenceCountForOperator(payload, operatorId);
    const quality = dailyOperatorQuality(payload, operatorId);
    const volatility = dailyOperatorVolatility(current, baselines);
    const severityScore = dailyOperatorSeverityScore({
      views,
      chats,
      communication,
      evidenceCount,
      quality,
      volatilityDelta: volatility.delta,
    });
    if (views > 0 && viewToChat < 0.35) {
      return {
        operatorId,
        name,
        focus: "详情后触达节奏",
        volatility: `${volatility.label}；查看 ${formatDailyNumber(views)}，发起聊天 ${formatDailyNumber(chats)}`,
        action: "复盘详情后未打招呼的岗位，先确认候选人匹配度和触达时机",
        evidenceCount,
        quality,
        severityLabel: dailySeverityLabel(severityScore),
        severityScore,
      };
    }
    if (chats > 0 && chatToCommunication < 0.75) {
      return {
        operatorId,
        name,
        focus: "发起聊天后的沟通推进",
        volatility: `${volatility.label}；发起聊天 ${formatDailyNumber(chats)}，形成沟通 ${formatDailyNumber(communication)}`,
        action: "检查已有聊天后的跟进动作，优先补看高意向会话",
        evidenceCount,
        quality,
        severityLabel: dailySeverityLabel(severityScore),
        severityScore,
      };
    }
    return {
      operatorId,
      name,
      focus: "高机会岗位复盘",
      volatility: `${volatility.label}；沟通 ${formatDailyNumber(communication)}，收获简历 ${formatDailyNumber(resumes)}`,
      action: "复盘结果较集中的岗位，确认可复制的触达节奏",
      evidenceCount,
      quality,
      severityLabel: dailySeverityLabel(severityScore),
      severityScore,
    };
  }).sort((left, right) => right.severityScore - left.severityScore).slice(0, 6);
}

function dailyPersonalDetail(payload: DailyAnalysisPayload, operatorId: string) {
  const operatorItem = payload.evidence_bundle.operator_results.find((item) => (
    dailyOperatorEvidenceId(item) === operatorId
  )) ?? payload.evidence_bundle.operator_results[0];
  if (!operatorItem) {
    return null;
  }
  const actualOperatorId = dailyOperatorEvidenceId(operatorItem);
  const current = asRecord(operatorItem.values.current);
  const baselines = asRecord(operatorItem.values.baselines);
  const values = asRecord(operatorItem.values);
  const summary = dailyOperatorSummaries(payload).find((item) => item.operatorId === actualOperatorId)
    ?? dailyFallbackOperatorSummary(payload, operatorItem);
  const issueChecks = dailyPersonalIssueChecks(payload, actualOperatorId, current);
  return {
    operatorId: actualOperatorId,
    name: formatEvidenceValue(values.display_name || values.boss_name || operatorItem.title),
    summary,
    coreMetrics: dailyPersonalCoreMetrics(current),
    volatilityAttributions: dailyOperatorVolatilityAttributions(current, baselines),
    issueChecks,
    coachingSuggestions: dailyPersonalCoachingSuggestions(summary, issueChecks),
  };
}

function dailyOperatorEvidenceId(item: DailyOperatorEvidence) {
  return item.operator_id ?? item.evidence_id;
}

function dailyFallbackOperatorSummary(
  payload: DailyAnalysisPayload,
  item: DailyOperatorEvidence
): DailyOperatorSummary {
  const current = asRecord(item.values.current);
  const values = asRecord(item.values);
  const operatorId = dailyOperatorEvidenceId(item);
  const baselines = asRecord(item.values.baselines);
  const volatility = dailyOperatorVolatility(current, baselines);
  const views = toFiniteNumber(current.boss_view_candidates);
  const chats = toFiniteNumber(current.boss_started_chats);
  const communication = toFiniteNumber(current.boss_communication_count);
  const quality = dailyOperatorQuality(payload, operatorId);
  const severityScore = dailyOperatorSeverityScore({
    views,
    chats,
    communication,
    evidenceCount: dailyEvidenceCountForOperator(payload, operatorId),
    quality,
    volatilityDelta: volatility.delta,
  });
  return {
    operatorId,
    name: formatEvidenceValue(values.display_name || values.boss_name || item.title),
    focus: "个人链路复盘",
    volatility: volatility.label,
    action: "先看核心漏斗数据，再确认当天岗位供给和触达节奏是否有变化",
    evidenceCount: dailyEvidenceCountForOperator(payload, operatorId),
    quality,
    severityLabel: dailySeverityLabel(severityScore),
    severityScore,
  };
}

function dailyPersonalCoreMetrics(current: Record<string, unknown>) {
  const views = toFiniteNumber(current.boss_view_candidates);
  const chats = toFiniteNumber(current.boss_started_chats);
  const communication = toFiniteNumber(current.boss_communication_count);
  const resumes = toFiniteNumber(current.resume_received);
  const contacts = toFiniteNumber(current.phone_wechat_exchanged);
  const interviews = toFiniteNumber(current.interview_accepted);
  return [
    { label: "查看", value: formatDailyNumber(views), note: "BOSS查看牛人" },
    { label: "发起聊天", value: formatDailyNumber(chats), note: `查看到聊天 ${formatRatio(chats, views)}` },
    { label: "沟通", value: formatDailyNumber(communication), note: `聊天到沟通 ${formatRatio(communication, chats)}` },
    { label: "收获简历", value: formatDailyNumber(resumes), note: `聊天到简历 ${formatRatio(resumes, chats)}` },
    { label: "电话微信", value: formatDailyNumber(contacts), note: `沟通到联系 ${formatRatio(contacts, communication)}` },
    { label: "接受面试", value: formatDailyNumber(interviews), note: `简历到面试 ${formatRatio(interviews, resumes)}` },
  ];
}

function dailyOperatorVolatilityAttributions(
  current: Record<string, unknown>,
  baselines: Record<string, unknown>
) {
  const metricKeys = [
    "boss_started_chats",
    "boss_communication_count",
    "resume_received",
    "phone_wechat_exchanged",
    "interview_accepted",
  ];
  const baselineLabels: Record<string, string> = {
    vs_yesterday: "较昨日",
    vs_same_weekday: "较上周同日",
    vs_7d_avg: "较7日均值",
    vs_14d_avg: "较14日均值",
  };
  const items = Object.entries(baselines).flatMap(([baselineKey, rawBaseline]) => {
    const baseline = asRecord(rawBaseline);
    return metricKeys.map((metricKey) => {
      const currentValue = toFiniteNumber(current[metricKey]);
      const baselineValue = toFiniteNumber(baseline[metricKey]);
      const delta = currentValue - baselineValue;
      return {
        metric: dailyOfficialMetricLabel(metricKey),
        baseline: baselineLabels[baselineKey] ?? baselineKey,
        current: formatDailyNumber(currentValue),
        baselineValue: formatDailyNumber(baselineValue),
        delta: formatSignedNumber(delta),
        deltaValue: delta,
        reason: dailyVolatilityReason(metricKey, delta),
      };
    });
  }).filter((item) => item.deltaValue !== 0);
  const sorted = items.sort((left, right) => Math.abs(right.deltaValue) - Math.abs(left.deltaValue)).slice(0, 4);
  if (sorted.length > 0) {
    return sorted;
  }
  return [{
    metric: "核心漏斗",
    baseline: "多基线",
    current: "--",
    baselineValue: "--",
    delta: "0",
    deltaValue: 0,
    reason: "当前没有明显偏离基线的信号，先按常规节奏观察。",
  }];
}

function dailyVolatilityReason(metricKey: string, delta: number) {
  const label = dailyOfficialMetricLabel(metricKey);
  if (delta < 0) {
    return `${label}低于基线，优先排查岗位供给、详情后触达和聊天跟进是否有断点。`;
  }
  if (delta > 0) {
    return `${label}高于基线，建议确认是否来自可复制的岗位结构、刷新节奏或跟进动作。`;
  }
  return `${label}与基线接近，继续观察样本变化。`;
}

function dailyPersonalIssueChecks(
  payload: DailyAnalysisPayload,
  operatorId: string,
  current: Record<string, unknown>
) {
  const views = toFiniteNumber(current.boss_view_candidates);
  const chats = toFiniteNumber(current.boss_started_chats);
  const communication = toFiniteNumber(current.boss_communication_count);
  const resumes = toFiniteNumber(current.resume_received);
  const checks: Array<{ title: string; signal: string; check: string }> = [];
  const viewToChatRate = views > 0 ? chats / views : 0;
  const chatToCommunicationRate = chats > 0 ? communication / chats : 0;
  if (views <= 0) {
    checks.push({
      title: "上游样本不足",
      signal: "今日查看为 0",
      check: "先确认是否有岗位开放、刷新动作或官方结果同步缺口。",
    });
  }
  if (views > 0 && viewToChatRate < 0.35) {
    checks.push({
      title: "详情后触达断点",
      signal: `查看到聊天 ${formatPercent(viewToChatRate)}`,
      check: "抽查查看量最高的岗位，确认未打招呼原因是匹配度、时机还是入口动作。",
    });
  }
  if (chats > 0 && chatToCommunicationRate < 0.75) {
    checks.push({
      title: "聊天推进断点",
      signal: `聊天到沟通 ${formatPercent(chatToCommunicationRate)}`,
      check: "检查已发起聊天后的跟进节奏，优先补看有回复或有简历信号的会话。",
    });
  }
  if (chats > 0 && resumes === 0) {
    checks.push({
      title: "简历承接不足",
      signal: "已发起聊天但暂无简历",
      check: "复盘沟通后的下一步动作，确认是否需要补充简历邀约或岗位卖点说明。",
    });
  }
  if (payload.data_quality.low_sample_warnings.some((item) => item.startsWith(`${operatorId}:`))) {
    checks.push({
      title: "样本完整度待确认",
      signal: "存在低样本提示",
      check: "先确认采集和官方结果覆盖，再决定是否进入早会复盘。",
    });
  }
  if (payload.data_quality.unmatched_jobs.some((item) => item.startsWith(`${operatorId}:`))) {
    checks.push({
      title: "岗位匹配待确认",
      signal: "存在岗位未匹配提示",
      check: "先校准岗位名称和操作员映射，再判断岗位维度变化。",
    });
  }
  if (checks.length === 0) {
    checks.push({
      title: "暂无明显断点",
      signal: "核心漏斗未出现明显异常",
      check: "保留观察，重点复盘可复制的岗位和触达节奏。",
    });
  }
  return checks.slice(0, 5);
}

function dailyPersonalCoachingSuggestions(
  summary: DailyOperatorSummary,
  issueChecks: Array<{ title: string; signal: string; check: string }>
) {
  return Array.from(new Set([
    summary.action,
    `围绕“${summary.focus}”做一次 10 分钟复盘，只看当天动作和可验证数据。`,
    issueChecks[0]?.check,
    "如果数据缺口影响判断，先补齐采集或官方结果映射，再安排对比复盘。",
  ].filter(Boolean))).slice(0, 4);
}

function dailyOperatorVolatility(
  current: Record<string, unknown>,
  baselines: Record<string, unknown>
) {
  const metricKeys = [
    "boss_started_chats",
    "boss_communication_count",
    "resume_received",
    "phone_wechat_exchanged",
  ];
  const baselineLabels: Record<string, string> = {
    vs_yesterday: "较昨日",
    vs_same_weekday: "较上周同日",
    vs_7d_avg: "较7日均值",
    vs_14d_avg: "较14日均值",
  };
  let strongest = {
    label: `当前查看 ${formatDailyNumber(toFiniteNumber(current.boss_view_candidates))}`,
    delta: 0,
  };
  for (const [baselineKey, rawBaseline] of Object.entries(baselines)) {
    const baseline = asRecord(rawBaseline);
    for (const metricKey of metricKeys) {
      const currentValue = toFiniteNumber(current[metricKey]);
      const baselineValue = toFiniteNumber(baseline[metricKey]);
      const delta = currentValue - baselineValue;
      if (Math.abs(delta) > Math.abs(strongest.delta)) {
        strongest = {
          label: `${dailyOfficialMetricLabel(metricKey)}${baselineLabels[baselineKey] ?? baselineKey} ${formatSignedNumber(delta)}（当前 ${formatDailyNumber(currentValue)}）`,
          delta,
        };
      }
    }
  }
  return strongest;
}

function dailyOperatorSeverityScore({
  views,
  chats,
  communication,
  evidenceCount,
  quality,
  volatilityDelta,
}: {
  views: number;
  chats: number;
  communication: number;
  evidenceCount: number;
  quality: string;
  volatilityDelta: number;
}) {
  const viewToChatGap = views > 0 ? Math.max(0, 0.35 - chats / views) : 0.15;
  const chatToCommunicationGap = chats > 0 ? Math.max(0, 0.75 - communication / chats) : 0;
  const sampleWeight = Math.min(Math.max(views, chats, communication) / 80, 1);
  const qualityPenalty = quality === "当前证据可用于复盘" ? 0 : 12;
  const volatilityWeight = Math.min(Math.abs(volatilityDelta), 12);
  return Math.round((viewToChatGap * 120 + chatToCommunicationGap * 90) * (0.55 + sampleWeight) + qualityPenalty + volatilityWeight);
}

function dailySeverityLabel(score: number) {
  if (score >= 35) {
    return "优先复盘";
  }
  if (score >= 18) {
    return "建议复盘";
  }
  return "观察复盘";
}

function dailyOfficialMetricLabel(metricKey: string) {
  const labels: Record<string, string> = {
    boss_started_chats: "发起聊天",
    boss_communication_count: "沟通",
    resume_received: "收获简历",
    phone_wechat_exchanged: "交换电话微信",
    interview_accepted: "接受面试",
  };
  return labels[metricKey] ?? metricKey;
}

function dailyOfficialTotals(payload: DailyAnalysisPayload) {
  const totals = {
    boss_view_candidates: 0,
    boss_started_chats: 0,
    boss_communication_count: 0,
    resume_received: 0,
    phone_wechat_exchanged: 0,
    interview_accepted: 0,
  };
  for (const item of payload.evidence_bundle.operator_results) {
    const current = asRecord(item.values.current);
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) {
      totals[key] += toFiniteNumber(current[key]);
    }
  }
  return totals;
}

function dailyOperatorCoverage(payload: DailyAnalysisPayload) {
  if (payload.scope.operator_id) {
    return 1;
  }
  const operatorIds = new Set<string>();
  for (const group of [
    payload.evidence_bundle.operator_results,
    payload.evidence_bundle.behavior_summaries,
  ]) {
    for (const item of group) {
      if (item.operator_id) {
        operatorIds.add(item.operator_id);
      }
    }
  }
  if (operatorIds.size > 0) {
    return operatorIds.size;
  }
  if (payload.evidence_bundle.operator_results.length > 0) {
    return payload.evidence_bundle.operator_results.length;
  }
  return null;
}

function dailyEvidenceCountForOperator(payload: DailyAnalysisPayload, operatorId: string) {
  return [
    payload.evidence_bundle.operator_results,
    payload.evidence_bundle.job_results,
    payload.evidence_bundle.behavior_summaries,
    payload.evidence_bundle.job_actions,
  ].reduce((total, items) => total + items.filter((item) => item.operator_id === operatorId).length, 0);
}

function dailyOperatorQuality(payload: DailyAnalysisPayload, operatorId: string) {
  if (payload.data_quality.low_sample_warnings.some((item) => item.startsWith(`${operatorId}:`))) {
    return "低样本，先确认数据完整度";
  }
  if (payload.data_quality.unmatched_jobs.some((item) => item.startsWith(`${operatorId}:`))) {
    return "存在岗位匹配缺口";
  }
  return "当前证据可用于复盘";
}

function formatDailyNumber(value: number) {
  const safeValue = toFiniteNumber(value);
  if (Number.isInteger(safeValue)) {
    return String(safeValue);
  }
  return String(Math.round(safeValue * 1000) / 1000);
}

function formatSignedNumber(value: number) {
  const safeValue = toFiniteNumber(value);
  const formatted = formatDailyNumber(Math.abs(safeValue));
  if (safeValue > 0) {
    return `+${formatted}`;
  }
  if (safeValue < 0) {
    return `-${formatted}`;
  }
  return "0";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function formatEvidenceValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "--";
  }
  if (typeof value === "number") {
    return formatDailyNumber(value);
  }
  if (typeof value === "string") {
    return value || "--";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (Array.isArray(value)) {
    return value.map(formatEvidenceValue).join("、");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatTabTitle(tab: AppTab) {
  if (tab === "quality") {
    return "数据质量";
  }
  if (tab === "history") {
    return "历史数据";
  }
  if (tab === "operators") {
    return "操作员管理";
  }
  return "招聘活动实时大盘";
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function getYesterdayDateInput() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return formatDateInput(date);
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDuration(minutes: number) {
  const safeMinutes = Math.max(0, Math.round(toFiniteNumber(minutes)));
  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;
  if (hours > 0 && rest > 0) {
    return `${hours}小时${rest}分`;
  }
  if (hours > 0) {
    return `${hours}小时`;
  }
  return `${rest}分`;
}

function formatElapsedMs(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(toFiniteNumber(milliseconds) / 1000));
  if (totalSeconds <= 0) {
    return "--";
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours}小时${minutes}分`;
  }
  if (hours > 0) {
    return `${hours}小时`;
  }
  if (minutes > 0 && seconds > 0) {
    return `${minutes}分${seconds}秒`;
  }
  if (minutes > 0) {
    return `${minutes}分`;
  }
  return `${seconds}秒`;
}

function formatRatio(numerator: number, denominator: number) {
  const safeNumerator = toFiniteNumber(numerator);
  const safeDenominator = toFiniteNumber(denominator);
  if (safeDenominator <= 0) {
    return "--";
  }
  return `${formatPercent(safeNumerator / safeDenominator)} (${safeNumerator}/${safeDenominator})`;
}

function formatPercent(rate: number) {
  const safeRate = toFiniteNumber(rate);
  return `${Math.round(safeRate * 1000) / 10}%`;
}

function recordNumber(record: DailyBasicStatsRecord, key: keyof DailyBasicStatsRecord) {
  return toFiniteNumber((record as Record<string, unknown>)[key]);
}

function toFiniteNumber(value: unknown) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatSource(payload: DashboardPayload) {
  const source = payload.source;
  if (!source) {
    return "数据源：未上报";
  }
  return `数据源：${source.label}，读取 ${source.record_count} 条`;
}

function formatLogQualitySource(payload: DashboardPayload) {
  const source = payload.log_quality_source;
  if (!source) {
    return "10分钟质量：未配置";
  }
  const latest = payload.health.log_quality_latest_window_start
    ? `，最新 ${formatTime(payload.health.log_quality_latest_window_start)}`
    : "";
  return `10分钟质量：${source.label}，读取 ${source.record_count} 条${latest}`;
}

function formatLogQualityPayloadSource(payload: LogQualityPayload) {
  const source = payload.log_quality_source;
  if (!source) {
    return "10分钟质量：未配置";
  }
  const latest = payload.quality.latest_window_start
    ? `，最新 ${formatTime(payload.quality.latest_window_start)}`
    : "";
  return `10分钟质量：${source.label}，读取 ${source.record_count} 条${latest}`;
}

function formatHistoryPayloadSource(payload: HistoryPayload) {
  const source = payload.daily_basic_summary_source;
  if (!source) {
    return "日级基础指标：未配置";
  }
  const latest = payload.history.latest_recorded_at
    ? `，最新 ${formatDateTime(payload.history.latest_recorded_at)}`
    : "";
  return `日级基础指标：${source.label}，读取 ${source.record_count} 条${latest}`;
}

function buildOperatorRows(
  profiles: OperatorProfile[],
  payload: DashboardPayload | null
): OperatorRowItem[] {
  const activeOperators = payload?.dashboard.active_operators ?? [];
  const activeById = new Map(activeOperators.map((item) => [item.operator_id, item]));
  const dailyById = new Map((payload?.dashboard.daily_active_durations ?? []).map((item) => [item.operator_id, item]));
  const configured = profiles.length > 0
    ? profiles
    : payload?.dashboard.configured_operators ?? [];
  if (configured.length > 0) {
    return configured.map((profile) => ({
      profile,
      active: activeById.get(profile.operator_id) ?? null,
      daily: dailyById.get(profile.operator_id) ?? null
    }));
  }
  return activeOperators.map((active) => ({
    profile: {
      operator_id: active.operator_id,
      display_name: active.display_name ?? active.operator_id,
      account_name: active.account_name ?? null,
      enabled: true,
      role: null,
      note: null
    },
    active,
    daily: dailyById.get(active.operator_id) ?? null
  }));
}

function buildPluginVersionOptions(
  dashboard: DashboardPayload | null,
  quality: LogQualityPayload | null
) {
  return Array.from(new Set([
    ...(dashboard?.health.log_quality_version_summaries ?? []).map((item) => item.plugin_version),
    ...(quality?.quality.version_summaries ?? []).map((item) => item.plugin_version)
  ].filter((version) => version && version !== "<missing>"))).sort();
}

function operatorProfileToForm(profile: OperatorProfile): OperatorAdminInput {
  return {
    operatorId: profile.operator_id,
    displayName: profile.display_name,
    accountName: profile.account_name ?? "",
    enabled: profile.enabled,
    role: profile.role ?? "",
    note: profile.note ?? ""
  };
}

function historyEmptyReason(history: HistoryPayload["history"]) {
  if (history.record_count > 0 || !history.active_date) {
    return null;
  }
  const today = formatDateInput(new Date());
  if (history.active_date >= today) {
    return "当天日级历史通常在次日汇总写入；今天的实时数据请查看大盘和单人明细。";
  }
  return null;
}

function hasHistoryDialogMetricGap(records: DailyBasicStatsRecord[]) {
  const hasChatEvidence = records.some((record) => (
    recordNumber(record, "snapshot_captured") > 0
    || recordNumber(record, "visible_message_count") > 0
    || recordNumber(record, "chat_opened") > 0
  ));
  const hasDialogMetric = records.some((record) => (
    recordNumber(record, "first_round_candidate_initiated_count") > 0
    || recordNumber(record, "first_round_boss_replied_count") > 0
    || recordNumber(record, "chat_conversation_count") > 0
    || recordNumber(record, "boss_ended_conversation_count") > 0
    || recordNumber(record, "boss_reply_count") > 0
  ));
  return hasChatEvidence && !hasDialogMetric;
}

function formatSummarySource(payload: DashboardPayload) {
  const source = payload.summary_source;
  if (!source) {
    return "分钟汇总：未配置";
  }
  const missingCount = payload.health.summary_missing_operator_count ?? 0;
  const latest = payload.health.summary_latest_minute
    ? `，最新 ${formatTime(payload.health.summary_latest_minute)}`
    : "";
  const warning = missingCount > 0 ? `，${missingCount} 条缺操作员` : "";
  return `分钟汇总：${source.label}，读取 ${source.record_count} 条${latest}${warning}`;
}

function formatDailySummarySource(payload: DashboardPayload) {
  const source = payload.daily_summary_source;
  const derivedCount = payload.dashboard.daily_active_durations?.length ?? 0;
  if (!source) {
    if (derivedCount > 0) {
      return `日级指标：分钟汇总兜底，${derivedCount} 人`;
    }
    return "日级指标：未配置";
  }
  const latest = payload.health.daily_summary_latest_date
    ? `，日期 ${payload.health.daily_summary_latest_date}`
    : "";
  const fallback = source.record_count === 0 && derivedCount > 0
    ? `，分钟汇总兜底 ${derivedCount} 人`
    : "";
  return `日级指标：${source.label}，读取 ${source.record_count} 条${latest}${fallback}`;
}

function formatDailyBasicSummarySource(payload: DashboardPayload) {
  const source = payload.daily_basic_summary_source;
  if (!source) {
    return "日级基础指标：未配置";
  }
  return `日级基础指标：${source.label}，读取 ${source.record_count} 条`;
}
