# CLS 定时 SQL 任务清单

本文件汇总当前 analysis-system 需要在腾讯云 CLS 层配置的定时 SQL 任务。用户可按本文件在 CLS 控制台创建任务。

## 总览

| 顺序 | 任务名 | 源主题 | 目标主题建议 | 周期 | SQL 时间窗口 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `boss_minute_operator_funnel` | 原始事实日志主题，例如 `boss` | `boss_summary_minute_prod` | 1 分钟 | `@m-3m,@m-1m` | 操作员分钟漏斗 |
| 2 | `boss_minute_chat` | 原始事实日志主题，例如 `boss` | `boss_summary_minute_prod` | 1 分钟 | `@m-3m,@m-1m` | 聊天分钟质量和数量 |
| 3 | `boss_daily_operator_active_duration` | `boss_summary_minute_prod` | `boss_summary_daily_prod` | 5 分钟 | `@d,@m-1m` | 当日活跃分钟快照 |
| 4 | `boss_10min_log_quality` | 原始事实日志主题，例如 `boss` | `boss_health_10min_prod` | 10 分钟 | `@m-12m,@m-2m` | 10 分钟日志质量报告 |

说明：

- SQL 语句复制到 CLS 控制台时不要带末尾分号。
- 生产 API、worker 和调度任务不得用 CLS Search/SearchLog 作为数据源；这些任务的输出应通过目标日志主题、指标主题、Kafka/投递链路或后续同步入库消费。
- 定时 SQL 是追加写，不做 upsert。analysis-system 读取日级和质量快照时，需要按稳定键取最新结果。
- 源主题和目标主题都要配置索引；索引变更只对新写入日志生效，历史数据可能需要重跑任务或接受缺口。

## Topic 配置

建议使用 1 个原始事实 topic 和 3 个汇总/健康目标 topic。

| Topic 名称 | 类型 | 来源/写入方 | 读取方 | 建议保留周期 | 本地环境变量 |
| --- | --- | --- | --- | --- | --- |
| `boss` | 原始事实日志 topic | Chrome 插件上传链路 | CLS 定时 SQL、后续 Kafka consumer | 按业务审计要求，建议 30 到 90 天起 | `CLS_KAFKA_TOPIC` 指 Kafka 消费 topic；本地排障不要把它配置成 SearchLog 生产源 |
| `boss_summary_minute_prod` | 分钟汇总日志 topic | `boss_minute_operator_funnel`、`boss_minute_chat` | summary-reader、日级定时 SQL、summary-sync | 建议 30 到 90 天 | `CLS_SUMMARY_TOPIC_ID` |
| `boss_summary_daily_prod` | 日级汇总日志 topic | `boss_daily_operator_active_duration` | daily summary reader、summary-sync | 建议 180 到 365 天 | `CLS_DAILY_SUMMARY_TOPIC_ID` |
| `boss_health_10min_prod` | 10 分钟健康/质量日志 topic | `boss_10min_log_quality` | 后续 log-health reader、summary-sync | 建议 30 到 180 天 | 后续建议新增 `CLS_LOG_QUALITY_TOPIC_ID`；当前代码尚未接入 |

创建顺序：

1. 确认原始事实 topic `boss` 已存在，并修正字段索引。
2. 创建或确认 `boss_summary_minute_prod`，配置目标字段索引。
3. 创建或确认 `boss_summary_daily_prod`，配置目标字段索引。
4. 创建或确认 `boss_health_10min_prod`，配置目标字段索引。
5. 先创建分钟任务，再创建日级任务；质量任务可独立创建。

### 原始事实 Topic：`boss`

用途：

- 保存插件上传的事实事件。
- 作为 `boss_minute_operator_funnel`、`boss_minute_chat`、`boss_10min_log_quality` 的源主题。

建议字段索引：

| 字段 | 类型建议 | 是否统计分析 | 说明 |
| --- | --- | --- | --- |
| `event_id` | text | 否 | 幂等和排查 |
| `event_type` | text | 是 | 所有定时 SQL 的核心分组/过滤字段 |
| `occurred_at` | text | 否 | 业务发生时间，后续可作为校验字段 |
| `plugin_version` | text | 是 | 按插件版本看质量 |
| `operator_id` | text | 是 | 必须是 text，不能是 long |
| `operator_account_name` | text | 是 | 人工核对 |
| `boss_account_name` | text | 是 | 门禁核对 |
| `boss_account_matched` | text 或 bool | 是 | 账号匹配健康 |
| `session_id` | text | 是 | 单日志质量和链路定位 |
| `page_type` | text | 是 | 页面维度 |
| `job_id` | text | 是 | 岗位维度 |
| `payload_json` | text | 否 | `json_extract_scalar` 字段检查 |
| `context_json` | text | 否 | 备用上下文排查 |

### 分钟汇总 Topic：`boss_summary_minute_prod`

用途：

- 承载 `boss_minute_operator_funnel` 和 `boss_minute_chat` 输出。
- 作为 analysis-system 当前单人漏斗、聊天指标、活跃状态和日级活跃时长的主要汇总来源。
- 作为 `boss_daily_operator_active_duration` 的源主题。

建议字段索引：

| 字段 | 类型建议 | 是否统计分析 |
| --- | --- | --- |
| `metric_name` | text | 是 |
| `minute` | text | 是 |
| `operator_id` | text | 是 |
| `job_id` | text | 是 |
| `card_exposed` | long | 是 |
| `detail_opened` | long | 是 |
| `greeting_clicked` | long | 是 |
| `greeting_succeeded` | long | 是 |
| `greeting_failed` | long | 是 |
| `chat_opened` | long | 是 |
| `chat_snapshot_captured` | long | 是 |
| `snapshot_captured` | long | 是 |
| `report_required` | long | 是 |
| `capture_failed` | long | 是 |
| `wechat_captured` | long | 是 |
| `visible_message_count` | long | 是 |
| `may_be_incomplete_count` | long | 是 |
| `total_events` | long | 是 |
| `chat_events` | long | 是 |
| `source_row_count` | long | 是 |

本地配置：

```bash
CLS_SUMMARY_TOPIC_ID=<boss_summary_minute_prod 的 TopicId>
CLS_SUMMARY_QUERY=*
CLS_SUMMARY_WINDOW_MINUTES=today
```

### 日级汇总 Topic：`boss_summary_daily_prod`

用途：

- 承载 `boss_daily_operator_active_duration` 输出。
- 供 analysis-system 读取当天操作员活跃分钟快照。

建议字段索引：

| 字段 | 类型建议 | 是否统计分析 |
| --- | --- | --- |
| `metric_name` | text | 是 |
| `active_date` | text | 是 |
| `operator_id` | text | 是 |
| `active_minutes` | long | 是 |
| `active_seconds` | long | 是 |
| `first_active_minute` | text | 是 |
| `last_active_minute` | text | 是 |
| `source_minute_count` | long | 是 |
| `source_row_count` | long | 是 |

本地配置：

```bash
CLS_DAILY_SUMMARY_TOPIC_ID=<boss_summary_daily_prod 的 TopicId>
CLS_DAILY_SUMMARY_QUERY=*
CLS_DAILY_SUMMARY_WINDOW_MINUTES=today
```

### 10 分钟健康 Topic：`boss_health_10min_prod`

用途：

- 承载 `boss_10min_log_quality` 输出。
- 供后续日志健康页读取 10 分钟质量报告。

建议字段索引：

| 字段 | 类型建议 | 是否统计分析 |
| --- | --- | --- |
| `metric_name` | text | 是 |
| `window_start` | text | 是 |
| `window_minutes` | long | 是 |
| `plugin_version` | text | 是 |
| `event_type` | text | 是 |
| `operator_id` | text | 是 |
| `page_type` | text | 是 |
| `job_id` | text | 是 |
| `raw_event_count` | long | 是 |
| `checked_event_count` | long | 是 |
| `missing_event_id_count` | long | 是 |
| `missing_operator_count` | long | 是 |
| `missing_plugin_version_count` | long | 是 |
| `missing_session_count` | long | 是 |
| `missing_context_count` | long | 是 |
| `payload_missing_count` | long | 是 |
| `card_required_field_missing_count` | long | 是 |
| `card_profile_core_missing_count` | long | 是 |
| `card_identity_low_confidence_count` | long | 是 |
| `detail_required_field_missing_count` | long | 是 |
| `detail_card_link_hint_missing_count` | long | 是 |
| `detail_close_opened_link_missing_count` | long | 是 |
| `greeting_required_field_missing_count` | long | 是 |
| `greeting_source_link_hint_missing_count` | long | 是 |
| `greeting_result_click_link_missing_count` | long | 是 |
| `chat_candidate_missing_count` | long | 是 |
| `chat_candidate_low_confidence_count` | long | 是 |
| `chat_conversation_key_missing_count` | long | 是 |
| `chat_message_quality_issue_count` | long | 是 |
| `chat_message_count_missing_count` | long | 是 |
| `chat_message_fingerprint_missing_count` | long | 是 |
| `chat_snapshot_completeness_missing_count` | long | 是 |
| `sensitive_leak_signal_count` | long | 是 |
| `source_row_count` | long | 是 |

本地配置规划：

```bash
# 当前代码尚未接入该配置；后续实现 log-health reader 时使用。
CLS_LOG_QUALITY_TOPIC_ID=<boss_health_10min_prod 的 TopicId>
CLS_LOG_QUALITY_QUERY=*
CLS_LOG_QUALITY_WINDOW_MINUTES=today
```

## 通用索引要求

原始事实日志主题建议开启以下键值索引和统计分析：

- 字符串：`event_id`、`event_type`、`occurred_at`、`plugin_version`、`operator_id`、`operator_account_name`、`boss_account_name`、`session_id`、`page_type`、`job_id`、`payload_json`、`context_json`
- 布尔或字符串：`boss_account_matched`

特别注意：

- `operator_id`、`job_id`、`plugin_version` 必须按字符串类型配置。`operator_id` 如果被配置成 long，会导致字符串账号聚合成 `<missing>`。
- `payload_json` 必须可被 SQL 作为字符串读取；日志质量任务会用 `json_extract_scalar` 检查字段存在性。
- 目标主题至少索引 `metric_name`、时间桶字段、维度字段和所有计数字段。

## 任务 1：`boss_minute_operator_funnel`

配置：

- 源主题：原始事实日志主题，例如 `boss`。
- 目标主题：`boss_summary_minute_prod`。
- 调度周期：1 分钟。
- SQL 时间窗口：`@m-3m,@m-1m`。
- 输出时间戳：CLS 默认。

目标字段：

- `metric_name`
- `minute`
- `operator_id`
- `job_id`
- `card_exposed`
- `detail_opened`
- `greeting_clicked`
- `greeting_succeeded`
- `greeting_failed`
- `chat_opened`
- `chat_snapshot_captured`
- `wechat_captured`
- `total_events`
- `source_row_count`

SQL：

```sql
* | select
  'boss_minute_operator_funnel' as metric_name,
  cast(minute as varchar) as minute,
  operator_id,
  job_id,
  sum(case when event_type = 'candidate_list.card_exposed' then 1 else 0 end) as card_exposed,
  sum(case when event_type = 'candidate_detail.opened' then 1 else 0 end) as detail_opened,
  sum(case when event_type = 'candidate_greeting.clicked' then 1 else 0 end) as greeting_clicked,
  sum(case when event_type = 'candidate_greeting.succeeded' then 1 else 0 end) as greeting_succeeded,
  sum(case when event_type = 'candidate_greeting.failed' then 1 else 0 end) as greeting_failed,
  sum(case when event_type = 'candidate_chat.opened' then 1 else 0 end) as chat_opened,
  sum(case when event_type = 'candidate_chat.snapshot_captured' then 1 else 0 end) as chat_snapshot_captured,
  sum(case when event_type = 'candidate_chat.wechat_captured' then 1 else 0 end) as wechat_captured,
  count(*) as total_events,
  count(*) as source_row_count
from (
  select
    histogram(__TIMESTAMP__, interval 1 minute) as minute,
    case when operator_id is null or operator_id = '' then '<missing>' else cast(operator_id as varchar) end as operator_id,
    case when job_id is null or job_id = '' then '<missing>' else cast(job_id as varchar) end as job_id,
    cast(event_type as varchar) as event_type
  where event_type in (
    'candidate_list.card_exposed',
    'candidate_detail.opened',
    'candidate_greeting.clicked',
    'candidate_greeting.succeeded',
    'candidate_greeting.failed',
    'candidate_chat.opened',
    'candidate_chat.snapshot_captured',
    'candidate_chat.wechat_captured'
  )
)
group by minute, operator_id, job_id
limit 10000
```

## 任务 2：`boss_minute_chat`

配置：

- 源主题：原始事实日志主题，例如 `boss`。
- 目标主题：`boss_summary_minute_prod`。
- 调度周期：1 分钟。
- SQL 时间窗口：`@m-3m,@m-1m`。
- 输出时间戳：CLS 默认。

目标字段：

- `metric_name`
- `minute`
- `operator_id`
- `job_id`
- `chat_opened`
- `snapshot_captured`
- `report_required`
- `capture_failed`
- `wechat_captured`
- `visible_message_count`
- `may_be_incomplete_count`
- `chat_events`
- `source_row_count`

SQL：

```sql
* | select
  'boss_minute_chat' as metric_name,
  cast(minute as varchar) as minute,
  operator_id,
  job_id,
  sum(case when event_type = 'candidate_chat.opened' then 1 else 0 end) as chat_opened,
  sum(case when event_type = 'candidate_chat.snapshot_captured' then 1 else 0 end) as snapshot_captured,
  sum(case when event_type = 'candidate_chat.report_required' then 1 else 0 end) as report_required,
  sum(case when event_type = 'candidate_chat.capture_failed' then 1 else 0 end) as capture_failed,
  sum(case when event_type = 'candidate_chat.wechat_captured' then 1 else 0 end) as wechat_captured,
  sum(case when event_type = 'candidate_chat.snapshot_captured' then coalesce(try_cast(nullif(message_count, '') as bigint), 0) else 0 end) as visible_message_count,
  sum(case when event_type = 'candidate_chat.snapshot_captured' and lower(may_be_incomplete) = 'true' then 1 else 0 end) as may_be_incomplete_count,
  count(*) as chat_events,
  count(*) as source_row_count
from (
  select
    histogram(__TIMESTAMP__, interval 1 minute) as minute,
    case when operator_id is null or operator_id = '' then '<missing>' else cast(operator_id as varchar) end as operator_id,
    case when job_id is null or job_id = '' then '<missing>' else cast(job_id as varchar) end as job_id,
    cast(event_type as varchar) as event_type,
    coalesce(try(json_extract_scalar(payload_json, '$.chat.messageCount')), '') as message_count,
    coalesce(try(json_extract_scalar(payload_json, '$.chat.mayBeIncomplete')), '') as may_be_incomplete
  where event_type in (
    'candidate_chat.opened',
    'candidate_chat.snapshot_captured',
    'candidate_chat.report_required',
    'candidate_chat.capture_failed',
    'candidate_chat.wechat_captured'
  )
)
group by minute, operator_id, job_id
limit 10000
```

## 任务 3：`boss_daily_operator_active_duration`

配置：

- 源主题：`boss_summary_minute_prod`。
- 目标主题：优先 `boss_summary_daily_prod`。
- 调度周期：5 分钟。
- SQL 时间窗口：`@d,@m-1m`。
- 输出时间戳：CLS 默认。

目标字段：

- `metric_name`
- `active_date`
- `operator_id`
- `active_minutes`
- `active_seconds`
- `first_active_minute`
- `last_active_minute`
- `source_minute_count`
- `source_row_count`

SQL：

```sql
* | select
  'boss_daily_operator_active_duration' as metric_name,
  cast(active_date as varchar) as active_date,
  operator_id,
  count(*) as active_minutes,
  count(*) * 60 as active_seconds,
  min(minute_bucket) as first_active_minute,
  max(minute_bucket) as last_active_minute,
  count(*) as source_minute_count,
  sum(source_row_count) as source_row_count
from (
  select
    from_iso8601_date(substr(cast(minute as varchar), 1, 10)) as active_date,
    operator_id,
    substr(cast(minute as varchar), 1, 16) as minute_bucket,
    count(*) as source_row_count,
    sum(
      coalesce(card_exposed, 0)
      + coalesce(detail_opened, 0)
      + coalesce(greeting_clicked, 0)
      + coalesce(greeting_succeeded, 0)
      + coalesce(greeting_failed, 0)
      + coalesce(chat_opened, 0)
      + coalesce(chat_snapshot_captured, 0)
      + coalesce(snapshot_captured, 0)
      + coalesce(report_required, 0)
      + coalesce(capture_failed, 0)
      + coalesce(wechat_captured, 0)
      + coalesce(total_events, 0)
      + coalesce(chat_events, 0)
    ) as active_signal
  where metric_name in ('boss_minute_operator_funnel', 'boss_minute_chat')
    and minute is not null
    and operator_id is not null
    and lower(cast(operator_id as varchar)) not in ('', '<missing>', 'missing', '__missing__', 'null', 'none')
  group by active_date, operator_id, minute_bucket
)
where active_signal > 0
  and active_date = current_date
group by active_date, operator_id
limit 10000
```

说明：

- `source_row_count` 是内层 `count(*) as source_row_count` 临时生成的排查字段，不是源主题字段。
- 如果目标主题暂时仍写回 `boss_summary_minute_prod`，analysis-system 读取时必须按 `metric_name` 区分，避免日级记录被当成分钟漏斗。

## 任务 4：`boss_10min_log_quality`

配置：

- 源主题：原始事实日志主题，例如 `boss`。
- 目标主题：优先 `boss_health_10min_prod`。
- 调度周期：10 分钟。
- SQL 时间窗口：`@m-12m,@m-2m`。
- 输出时间戳：CLS 默认。

目标字段：

- `metric_name`
- `window_start`
- `window_minutes`
- `plugin_version`
- `event_type`
- `operator_id`
- `page_type`
- `job_id`
- `raw_event_count`
- `checked_event_count`
- `missing_event_id_count`
- `missing_operator_count`
- `missing_plugin_version_count`
- `missing_session_count`
- `missing_context_count`
- `payload_missing_count`
- `card_required_field_missing_count`
- `card_profile_core_missing_count`
- `card_identity_low_confidence_count`
- `detail_required_field_missing_count`
- `detail_card_link_hint_missing_count`
- `detail_close_opened_link_missing_count`
- `greeting_required_field_missing_count`
- `greeting_source_link_hint_missing_count`
- `greeting_result_click_link_missing_count`
- `chat_candidate_missing_count`
- `chat_candidate_low_confidence_count`
- `chat_conversation_key_missing_count`
- `chat_message_quality_issue_count`
- `chat_message_count_missing_count`
- `chat_message_fingerprint_missing_count`
- `chat_snapshot_completeness_missing_count`
- `sensitive_leak_signal_count`
- `source_row_count`

SQL：

```sql
* | select
  'boss_10min_log_quality' as metric_name,
  cast(window_start as varchar) as window_start,
  10 as window_minutes,
  plugin_version,
  event_type,
  operator_id,
  page_type,
  job_id,
  count(*) as raw_event_count,
  count(*) as checked_event_count,
  sum(case when event_id is null or event_id = '' then 1 else 0 end) as missing_event_id_count,
  sum(case when lower(operator_id) in ('', '<missing>', 'missing', '__missing__', 'null', 'none') then 1 else 0 end) as missing_operator_count,
  sum(case when plugin_version = '<missing>' then 1 else 0 end) as missing_plugin_version_count,
  sum(case when session_id = '<missing>' then 1 else 0 end) as missing_session_count,
  sum(case when session_id = '<missing>' or page_type = '<missing>' then 1 else 0 end) as missing_context_count,
  sum(case when payload_text = '' then 1 else 0 end) as payload_missing_count,
  sum(case when event_type = 'candidate_list.card_exposed' and (
    candidate_id = '' or stable_id = '' or stable_id_source = '' or exposure_key = ''
  ) then 1 else 0 end) as card_required_field_missing_count,
  sum(case when event_type = 'candidate_list.card_exposed' and display_name = '' then 1 else 0 end) as card_profile_core_missing_count,
  sum(case when event_type = 'candidate_list.card_exposed' and stable_id_source = 'text_fingerprint' then 1 else 0 end) as card_identity_low_confidence_count,
  sum(case when event_type = 'candidate_detail.opened' and (
    (detail_url = '' and detected_by = '')
    or (candidate_id = '' and (stable_id = '' or stable_id_source = ''))
    or display_name = ''
  ) then 1 else 0 end) as detail_required_field_missing_count,
  sum(case when event_type = 'candidate_detail.opened' and exposure_key = '' and exposed_event_id = '' then 1 else 0 end) as detail_card_link_hint_missing_count,
  sum(case when event_type = 'candidate_detail.closed' and opened_event_id = '' then 1 else 0 end) as detail_close_opened_link_missing_count,
  sum(case when event_type = 'candidate_greeting.clicked' and (
    greeting_entry = ''
    or (candidate_id = '' and (stable_id = '' or stable_id_source = ''))
  ) then 1 else 0 end) as greeting_required_field_missing_count,
  sum(case when event_type = 'candidate_greeting.clicked'
    and greeting_entry in ('candidate_list', 'candidate_detail')
    and exposure_key = ''
    and exposed_event_id = ''
  then 1 else 0 end) as greeting_source_link_hint_missing_count,
  sum(case when event_type in ('candidate_greeting.succeeded', 'candidate_greeting.failed') and clicked_event_id = '' then 1 else 0 end) as greeting_result_click_link_missing_count,
  sum(case when event_type in ('candidate_chat.opened', 'candidate_chat.snapshot_captured', 'candidate_chat.wechat_captured', 'candidate_chat.capture_failed')
    and candidate_id = ''
    and (stable_id = '' or stable_id_source = '')
  then 1 else 0 end) as chat_candidate_missing_count,
  sum(case when event_type in ('candidate_chat.opened', 'candidate_chat.snapshot_captured', 'candidate_chat.wechat_captured', 'candidate_chat.capture_failed')
    and identity_confidence = 'low'
  then 1 else 0 end) as chat_candidate_low_confidence_count,
  sum(case when event_type = 'candidate_chat.opened' and conversation_key = '' then 1 else 0 end) as chat_conversation_key_missing_count,
  sum(case when event_type = 'candidate_chat.snapshot_captured' and (
    chat_message_count = ''
    or (coalesce(try_cast(nullif(chat_message_count, '') as bigint), 0) > 0 and last_message_fingerprint = '')
    or snapshot_completeness = ''
    or may_be_incomplete = ''
    or not regexp_like(payload_text, '"messages"[[:space:]]*:')
    or not regexp_like(payload_text, '"direction"[[:space:]]*:')
    or not regexp_like(payload_text, '"fingerprint"[[:space:]]*:')
  ) then 1 else 0 end) as chat_message_quality_issue_count,
  sum(case when event_type = 'candidate_chat.snapshot_captured' and chat_message_count = '' then 1 else 0 end) as chat_message_count_missing_count,
  sum(case when event_type = 'candidate_chat.snapshot_captured' and (
    coalesce(try_cast(nullif(chat_message_count, '') as bigint), 0) > 0 and last_message_fingerprint = ''
  ) then 1 else 0 end) as chat_message_fingerprint_missing_count,
  sum(case when event_type = 'candidate_chat.snapshot_captured' and (
    snapshot_completeness = '' or may_be_incomplete = ''
  ) then 1 else 0 end) as chat_snapshot_completeness_missing_count,
  sum(case when event_type not in ('candidate_chat.snapshot_captured', 'candidate_chat.wechat_captured') and regexp_like(
    payload_text,
    '(微信|微信号|手机号|电话|联系方式|1[3-9][0-9]{9}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,})'
  ) then 1 else 0 end) as sensitive_leak_signal_count,
  count(*) as source_row_count
from (
  select
    histogram(__TIMESTAMP__, interval 10 minute) as window_start,
    case when plugin_version is null or plugin_version = '' then '<missing>' else cast(plugin_version as varchar) end as plugin_version,
    case when event_type is null or event_type = '' then '<missing>' else cast(event_type as varchar) end as event_type,
    case when operator_id is null or operator_id = '' then '<missing>' else cast(operator_id as varchar) end as operator_id,
    case when page_type is null or page_type = '' then '<missing>' else cast(page_type as varchar) end as page_type,
    case when job_id is null or job_id = '' then '<missing>' else cast(job_id as varchar) end as job_id,
    case when session_id is null or session_id = '' then '<missing>' else cast(session_id as varchar) end as session_id,
    cast(coalesce(event_id, '') as varchar) as event_id,
    cast(coalesce(payload_json, '') as varchar) as payload_text,
    coalesce(try(json_extract_scalar(payload_json, '$.candidate.candidateId')), '') as candidate_id,
    coalesce(try(json_extract_scalar(payload_json, '$.candidate.stableId')), '') as stable_id,
    coalesce(try(json_extract_scalar(payload_json, '$.candidate.stableIdSource')), '') as stable_id_source,
    coalesce(try(json_extract_scalar(payload_json, '$.candidate.identityConfidence')), '') as identity_confidence,
    coalesce(try(json_extract_scalar(payload_json, '$.candidate.exposureKey')), '') as exposure_key,
    coalesce(try(json_extract_scalar(payload_json, '$.candidate.exposedEventId')), '') as exposed_event_id,
    coalesce(try(json_extract_scalar(payload_json, '$.candidate.profile.displayName')), '') as display_name,
    coalesce(try(json_extract_scalar(payload_json, '$.detailUrl')), '') as detail_url,
    coalesce(try(json_extract_scalar(payload_json, '$.detectedBy')), '') as detected_by,
    coalesce(try(json_extract_scalar(payload_json, '$.openedEventId')), '') as opened_event_id,
    coalesce(try(json_extract_scalar(payload_json, '$.entry')), '') as greeting_entry,
    coalesce(try(json_extract_scalar(payload_json, '$.clickedEventId')), '') as clicked_event_id,
    coalesce(try(json_extract_scalar(payload_json, '$.chat.conversationKey')), '') as conversation_key,
    coalesce(try(json_extract_scalar(payload_json, '$.chat.messageCount')), '') as chat_message_count,
    coalesce(try(json_extract_scalar(payload_json, '$.chat.lastMessageFingerprint')), '') as last_message_fingerprint,
    coalesce(try(json_extract_scalar(payload_json, '$.chat.snapshotCompleteness')), '') as snapshot_completeness,
    coalesce(try(json_extract_scalar(payload_json, '$.chat.mayBeIncomplete')), '') as may_be_incomplete
  where event_type in (
    'candidate_list.card_exposed',
    'candidate_detail.opened',
    'candidate_detail.closed',
    'candidate_greeting.clicked',
    'candidate_greeting.succeeded',
    'candidate_greeting.failed',
    'candidate_chat.opened',
    'candidate_chat.snapshot_captured',
    'candidate_chat.wechat_captured',
    'candidate_chat.capture_failed'
  )
)
group by window_start, plugin_version, event_type, operator_id, page_type, job_id
limit 10000
```

## 配置后检查

1. 先确认目标主题有新日志写入。
2. 在目标主题检索 `metric_name:"boss_minute_operator_funnel"`、`metric_name:"boss_minute_chat"`、`metric_name:"boss_daily_operator_active_duration"`、`metric_name:"boss_10min_log_quality"`。
3. 检查 `operator_id` 是否仍出现 `<missing>`。如果 raw 主题实际有 `operator_id`，而汇总结果是 `<missing>`，优先检查源主题索引类型。
4. 检查 `source_row_count` 是否大于等于各计数字段之和的合理范围。
5. `boss_daily_operator_active_duration` 的 `active_minutes` 不应超过 1440。
6. `boss_10min_log_quality` 的质量字段只代表 CLS 层字段/线索覆盖，不代表跨事件精确回连已经完成。

## 参考链接

- CLS 定时 SQL 创建任务：https://cloud.tencent.com/document/product/614/78891
- CLS 创建定时 SQL API：https://cloud.tencent.com/document/product/614/95138
- CLS 数据处理限制：https://cloud.tencent.com/document/product/614/86622
- CLS 日期和时间函数：https://cloud.tencent.com/document/product/614/58981
