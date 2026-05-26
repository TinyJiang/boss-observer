import { useEffect, useMemo, useState } from "react";
import { fetchDashboard, fetchHistory, fetchLogQuality, fetchOperator, fetchOperators } from "./api";
import type { ActiveOperator, DailyActiveDuration, DailyBasicStatsRecord, DashboardPayload, HealthStatus, HistoryPayload, LogQualityPayload, OperatorMinutePoint, OperatorPayload, OperatorProfile } from "./types";
import "./styles.css";

type LoadState = "loading" | "ready" | "error";
type AppTab = "dashboard" | "history" | "quality";

const REFRESH_INTERVAL_MS = 15_000;

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
  | "chat_snapshots"
  | "wechat_captured";

const CHART_SERIES: Array<{ key: MinuteMetricKey; label: string; color: string }> = [
  { key: "card_exposed", label: "卡片", color: "#0f766e" },
  { key: "detail_opened", label: "详情", color: "#2563eb" },
  { key: "greeting_succeeded", label: "招呼成功", color: "#9333ea" },
  { key: "chat_snapshots", label: "聊天", color: "#ea580c" },
  { key: "wechat_captured", label: "微信", color: "#16a34a" }
];

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("dashboard");
  const [operator, setOperator] = useState<OperatorPayload | null>(null);
  const [quality, setQuality] = useState<LogQualityPayload | null>(null);
  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [operatorProfiles, setOperatorProfiles] = useState<OperatorProfile[]>([]);
  const [selectedOperatorId, setSelectedOperatorId] = useState("");
  const [historyOperatorId, setHistoryOperatorId] = useState("");
  const [historyActiveDate, setHistoryActiveDate] = useState(getYesterdayDateInput());
  const [historySubmittedFilters, setHistorySubmittedFilters] = useState({
    operatorId: "",
    activeDate: getYesterdayDateInput()
  });
  const [historyQueryVersion, setHistoryQueryVersion] = useState(0);
  const [qualityOperatorId, setQualityOperatorId] = useState("");
  const [qualityPluginVersion, setQualityPluginVersion] = useState("");
  const [operatorLoadState, setOperatorLoadState] = useState<LoadState>("loading");
  const [dashboardLoadState, setDashboardLoadState] = useState<LoadState>("loading");
  const [detailLoadState, setDetailLoadState] = useState<LoadState>("loading");
  const [historyLoadState, setHistoryLoadState] = useState<LoadState>("ready");
  const [qualityLoadState, setQualityLoadState] = useState<LoadState>("loading");
  const [operatorErrorMessage, setOperatorErrorMessage] = useState<string | null>(null);
  const [dashboardErrorMessage, setDashboardErrorMessage] = useState<string | null>(null);
  const [detailErrorMessage, setDetailErrorMessage] = useState<string | null>(null);
  const [historyErrorMessage, setHistoryErrorMessage] = useState<string | null>(null);
  const [qualityErrorMessage, setQualityErrorMessage] = useState<string | null>(null);

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
        </nav>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">本地开发</p>
            <h1>{formatTabTitle(activeTab)}</h1>
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

        {activeTab === "dashboard" ? (
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
    ["聊天快照", funnel?.chat_snapshots ?? 0],
    ["微信获取", funnel?.wechat_captured ?? 0]
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
        <FunnelCell label="微信" value={funnel?.wechat_captured ?? 0} />
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
            <th>微信</th>
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
  const activeText = record.has_values
    ? formatDuration(record.active_minutes)
    : "--";
  const rangeText = record.first_active_minute && record.last_active_minute
    ? `${formatTime(record.first_active_minute).slice(0, 5)}-${formatTime(record.last_active_minute).slice(0, 5)}`
    : "--";
  const firstRoundRate = formatRatio(
    record.first_round_boss_replied_count,
    record.first_round_candidate_initiated_count
  );
  const bossEndRate = formatRatio(record.boss_ended_conversation_count, record.chat_conversation_count);
  return (
    <tr className={record.has_values ? "" : "missingValues"}>
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
      <td>{record.has_values ? `${record.card_exposed} / ${record.detail_opened}` : "--"}</td>
      <td>{record.has_values ? `${record.greeting_clicked} / ${record.greeting_succeeded}` : "--"}</td>
      <td>{record.has_values ? `${record.chat_opened} / ${record.snapshot_captured}` : "--"}</td>
      <td>
        {record.has_values ? (
          <HistoryMetricCell
            primary={firstRoundRate}
            secondary={`中 ${formatElapsedMs(record.first_round_boss_reply_elapsed_median_ms)} / 均 ${formatElapsedMs(record.first_round_boss_reply_elapsed_avg_ms)}`}
          />
        ) : "--"}
      </td>
      <td>
        {record.has_values ? (
          <HistoryMetricCell
            primary={bossEndRate}
            secondary={`${record.boss_ended_conversation_count}/${record.chat_conversation_count} 会话`}
          />
        ) : "--"}
      </td>
      <td>
        {record.has_values ? (
          <HistoryMetricCell
            primary={`${record.boss_reply_count} 次`}
            secondary={`中 ${formatElapsedMs(record.boss_reply_elapsed_median_ms)} / 均 ${formatElapsedMs(record.boss_reply_elapsed_avg_ms)}`}
          />
        ) : "--"}
      </td>
      <td>{record.has_values ? record.wechat_captured : "--"}</td>
      <td>{record.has_values ? record.total_events : "--"}</td>
      <td>
        <span className={`historyStatus ${record.has_values ? "ok" : "missing"}`}>
          {record.has_values ? "有数值" : "指标值暂不可查"}
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
  const totalActiveMinutes = records.reduce((total, record) => total + record.active_minutes, 0);
  const totalEvents = records.reduce((total, record) => total + record.total_events, 0);
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

function formatTabTitle(tab: AppTab) {
  if (tab === "quality") {
    return "数据质量";
  }
  if (tab === "history") {
    return "历史数据";
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
  const safeMinutes = Math.max(0, Math.round(minutes));
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
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
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
  if (denominator <= 0) {
    return "--";
  }
  return `${formatPercent(numerator / denominator)} (${numerator}/${denominator})`;
}

function formatPercent(rate: number) {
  return `${Math.round(rate * 1000) / 10}%`;
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
