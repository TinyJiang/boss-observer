import { useEffect, useMemo, useState } from "react";
import { fetchDashboard, fetchLogQuality, fetchOperator, fetchOperators } from "./api";
import type { ActiveOperator, DailyActiveDuration, DashboardPayload, HealthStatus, LogQualityPayload, OperatorMinutePoint, OperatorPayload, OperatorProfile } from "./types";
import "./styles.css";

type LoadState = "loading" | "ready" | "error";
type AppTab = "dashboard" | "quality";

const REFRESH_INTERVAL_MS = 15_000;

const STATUS_LABELS: Record<HealthStatus, string> = {
  ok: "正常",
  warning: "预警",
  critical: "严重",
  unknown: "未知"
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
  const [operatorProfiles, setOperatorProfiles] = useState<OperatorProfile[]>([]);
  const [selectedOperatorId, setSelectedOperatorId] = useState("");
  const [qualityOperatorId, setQualityOperatorId] = useState("");
  const [qualityPluginVersion, setQualityPluginVersion] = useState("");
  const [operatorLoadState, setOperatorLoadState] = useState<LoadState>("loading");
  const [dashboardLoadState, setDashboardLoadState] = useState<LoadState>("loading");
  const [detailLoadState, setDetailLoadState] = useState<LoadState>("loading");
  const [qualityLoadState, setQualityLoadState] = useState<LoadState>("loading");
  const [operatorErrorMessage, setOperatorErrorMessage] = useState<string | null>(null);
  const [dashboardErrorMessage, setDashboardErrorMessage] = useState<string | null>(null);
  const [detailErrorMessage, setDetailErrorMessage] = useState<string | null>(null);
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
    loadOperators();
    loadDashboard(true);
    const dashboardTimer = window.setInterval(() => {
      loadDashboard(false);
    }, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(dashboardTimer);
    };
  }, []);

  useEffect(() => {
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
  }, [selectedOperatorId]);

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
            <h1>{activeTab === "quality" ? "数据质量" : "招聘活动实时大盘"}</h1>
          </div>
          <div className={`freshness ${dashboardLoadState}`}>
            {dashboardLoadState === "ready" && dashboard
              ? (
                  <>
                    <span>数据生成于 {formatTime(dashboard.dashboard.generated_at)}</span>
                    <span className="sourceLine">{formatSource(dashboard)}</span>
                    <span className="sourceLine">{formatSummarySource(dashboard)}</span>
                    <span className="sourceLine">{formatDailySummarySource(dashboard)}</span>
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
        ) : (
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
  const statusText = active
    ? `${formatAction(active.last_action)} · ${active.job_id ?? "未关联职位"}`
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

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
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
