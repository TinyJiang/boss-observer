export type ActiveOperator = {
  operator_id: string;
  last_active_at: string;
  minutes_since_active: number;
  last_action: string;
  job_id: string | null;
  job_name?: string | null;
  display_name?: string | null;
  account_name?: string | null;
};

export type OperatorProfile = {
  operator_id: string;
  display_name: string;
  account_name: string | null;
  enabled: boolean;
  role: string | null;
  note: string | null;
};

export type OperatorAdminLoginPayload = {
  authenticated: boolean;
  token?: string;
  reason?: string;
  message?: string;
  config_path?: string;
  encryption_enabled?: boolean;
};

export type OperatorAdminPayload = {
  operators: OperatorProfile[];
  config_path: string;
  encryption_enabled: boolean;
};

export type OperatorAdminMutationPayload = OperatorAdminPayload & {
  operator?: OperatorProfile;
  deleted?: boolean;
};

export type OperatorAdminInput = {
  operatorId: string;
  displayName: string;
  accountName: string;
  enabled: boolean;
  role: string;
  note: string;
};

export type DailyActiveDuration = {
  metric_name: string;
  active_date: string;
  operator_id: string;
  active_minutes: number;
  active_seconds: number;
  first_active_minute: string | null;
  last_active_minute: string | null;
  source_minute_count: number;
  source_row_count: number;
  recorded_at: string | null;
};

export type DashboardPayload = {
  dashboard: {
    active_count: number;
    active_operators?: ActiveOperator[];
    observed_operator_count: number;
    generated_at: string;
    configured_operators?: OperatorProfile[];
    daily_active_durations?: DailyActiveDuration[];
  };
  health: {
    status?: HealthStatus;
    raw_event_count?: number;
    parse_error_count?: number;
    projection_error_count?: number;
    unknown_event_type_count?: number;
    summary_record_count?: number;
    summary_missing_operator_count?: number;
    summary_latest_minute?: string | null;
    daily_summary_record_count?: number;
    daily_summary_latest_date?: string | null;
    log_quality_status?: HealthStatus;
    log_quality_record_count?: number;
    log_quality_latest_window_start?: string | null;
    log_quality_window_minutes?: number;
    log_quality_raw_event_count?: number;
    log_quality_checked_event_count?: number;
    log_quality_finding_count?: number;
    log_quality_finding_rate?: number;
    log_quality_missing_operator_count?: number;
    log_quality_sensitive_leak_signal_count?: number;
    log_quality_version_summaries?: LogQualityVersionSummary[];
    log_quality_event_summaries?: LogQualityEventSummary[];
  };
  source?: {
    kind: string;
    label: string;
    detail: string | null;
    record_count: number;
    loaded_at: string;
  };
  summary_source?: {
    kind: string;
    label: string;
    detail: string | null;
    record_count: number;
    loaded_at: string;
  } | null;
  daily_summary_source?: {
    kind: string;
    label: string;
    detail: string | null;
    record_count: number;
    loaded_at: string;
  } | null;
  daily_basic_summary_source?: {
    kind: string;
    label: string;
    detail: string | null;
    record_count: number;
    loaded_at: string;
  } | null;
  log_quality_source?: {
    kind: string;
    label: string;
    detail: string | null;
    record_count: number;
    loaded_at: string;
  } | null;
};

export type HealthStatus = "ok" | "warning" | "critical" | "unknown";

export type DataSourceInfo = {
  kind: string;
  label: string;
  detail: string | null;
  record_count: number;
  loaded_at: string;
};

export type DailyAnalysisStatus = "ready" | "partial" | "analyzing" | "failed";

export type DailyAnalysisVolatilityMetric = {
  evidence_id: string;
  metric_key: string;
  metric_label: string;
  baseline_key: string;
  baseline_label: string;
  current_value: number;
  baseline_value: number;
  delta: number;
  percent_change: number | null;
  direction: "up" | "down" | "flat";
  sample_size: number;
  note: string | null;
  evidence_refs: string[];
};

export type DailyAnalysisEvidenceItem = {
  evidence_id: string;
  category: string;
  title: string;
  source: string;
  values: Record<string, unknown>;
  operator_id: string | null;
  job_key: string | null;
  recorded_at: string | null;
};

export type DailyAnalysisEvidenceBundle = {
  operator_results: DailyAnalysisEvidenceItem[];
  job_results: DailyAnalysisEvidenceItem[];
  behavior_summaries: DailyAnalysisEvidenceItem[];
  job_actions: DailyAnalysisEvidenceItem[];
};

export type DailyAnalysisDataQuality = {
  missing_fields: string[];
  unmatched_jobs: string[];
  low_sample_warnings: string[];
};

export type DailyAnalysisModelAttribution = {
  rank: number;
  cause: string;
  confidence: string;
  reasoning: string;
  evidence_refs: string[];
  data_gaps: string[];
  recommended_actions: string[];
};

export type DailyAnalysisActionItem = {
  rank: number;
  owner_role: "manager" | "operator" | "system";
  target_operator_id: string | null;
  target_job_key: string | null;
  action: string;
  execution_steps: string[];
  due_window: string;
  success_check: string;
  confidence: string;
  evidence_refs: string[];
  data_gaps: string[];
  blocked_by: string[];
};

export type DailyAnalysisModelAnalysis = {
  summary: string;
  generated_at: string;
  analyzer: string;
  attributions: DailyAnalysisModelAttribution[];
  action_items?: DailyAnalysisActionItem[];
  questions_for_next_collection: string[];
};

export type DailyAnalysisPayload = {
  status: DailyAnalysisStatus;
  analysis_date: string;
  generated_at: string;
  scope: {
    operator_id: string | null;
    display_name: string;
    boss_name: string;
  };
  sync_state: Record<string, unknown>;
  volatility_metrics: DailyAnalysisVolatilityMetric[];
  evidence_bundle: DailyAnalysisEvidenceBundle;
  model_analysis: DailyAnalysisModelAnalysis;
  data_quality: DailyAnalysisDataQuality;
  errors: string[];
};

export type LogQualityIssueCounter = {
  key: string;
  label: string;
  count: number;
};

export type LogQualityVersionSummary = {
  plugin_version: string;
  status: HealthStatus;
  raw_event_count: number;
  checked_event_count: number;
  finding_count: number;
  finding_rate: number;
  affected_event_type_count: number;
  latest_window_start: string | null;
  top_issues: LogQualityIssueCounter[];
};

export type LogQualityEventSummary = {
  plugin_version: string;
  event_type: string;
  status: HealthStatus;
  raw_event_count: number;
  checked_event_count: number;
  finding_count: number;
  finding_rate: number;
  latest_window_start: string | null;
  top_issues: LogQualityIssueCounter[];
};

export type LogQualityPayload = {
  quality: {
    status: HealthStatus;
    operator_id: string | null;
    plugin_version: string | null;
    source_record_count: number;
    record_count: number;
    latest_window_start: string | null;
    window_minutes: number;
    raw_event_count: number;
    checked_event_count: number;
    finding_count: number;
    finding_rate: number;
    missing_operator_count: number;
    sensitive_leak_signal_count: number;
    version_summaries: LogQualityVersionSummary[];
    event_summaries: LogQualityEventSummary[];
  };
  log_quality_source?: DataSourceInfo | null;
};

export type DailyBasicStatsRecord = {
  metric_name: string;
  active_date: string;
  operator_id: string;
  operator_account_name: string | null;
  boss_account_name: string | null;
  boss_account_matched: string | null;
  first_active_minute: string | null;
  last_active_minute: string | null;
  active_minutes: number;
  active_seconds: number;
  observed_minutes: number;
  session_count: number;
  touched_job_count: number;
  plugin_started: number;
  boss_page_entered: number;
  boss_page_left: number;
  page_changed: number;
  plugin_exception: number;
  job_context_detected: number;
  job_context_changed: number;
  filter_panel_opened: number;
  filter_applied: number;
  card_exposed: number;
  detail_opened: number;
  detail_closed: number;
  greeting_clicked: number;
  greeting_succeeded: number;
  greeting_failed: number;
  chat_opened: number;
  snapshot_captured: number;
  wechat_captured: number;
  capture_failed: number;
  card_unique_candidates: number;
  detail_unique_candidates: number;
  greeting_unique_candidates: number;
  chat_unique_candidates: number;
  wechat_unique_candidates: number;
  visible_message_count: number;
  may_be_incomplete_count: number;
  first_round_candidate_initiated_count: number;
  first_round_boss_replied_count: number;
  first_round_boss_reply_elapsed_median_ms: number;
  first_round_boss_reply_elapsed_avg_ms: number;
  chat_conversation_count: number;
  boss_ended_conversation_count: number;
  boss_reply_count: number;
  boss_reply_elapsed_median_ms: number;
  boss_reply_elapsed_avg_ms: number;
  detail_duration_ms: number;
  greeting_result_elapsed_ms: number;
  total_events: number;
  source_row_count: number;
  recorded_at: string | null;
  has_values: boolean;
  value_status: string;
};

export type HistoryPayload = {
  history: {
    status: "ok" | "partial" | "missing_values" | "empty";
    operator_id: string | null;
    active_date: string | null;
    source_record_count: number;
    record_count: number;
    latest_active_date: string | null;
    latest_recorded_at: string | null;
    records: DailyBasicStatsRecord[];
  };
  daily_basic_summary_source?: DataSourceInfo | null;
};

export type OperatorsPayload = {
  operators: OperatorProfile[];
};

export type OperatorPayload = {
  operator: {
    operator_id: string;
    plugin_version: string | null;
    plugin_version_observed_at: string | null;
    minute_points?: OperatorMinutePoint[];
    daily_active_duration?: DailyActiveDuration | null;
    funnel: {
      card_exposed: number;
      detail_opened: number;
      greeting_clicked: number;
      greeting_succeeded: number;
      greeting_failed: number;
      chat_opened: number;
      chat_snapshots: number;
      wechat_captured: number;
    };
    chat: {
      chat_opened: number;
      snapshot_captured: number;
      wechat_captured: number;
      capture_failed: number;
      visible_message_count: number;
      may_be_incomplete_count: number;
    };
    job_ids: string[];
  };
};

export type OperatorMinutePoint = {
  minute: string;
  card_exposed: number;
  detail_opened: number;
  greeting_clicked: number;
  greeting_succeeded: number;
  chat_opened: number;
  chat_snapshots: number;
  wechat_captured: number;
  capture_failed: number;
  event_count: number;
};
