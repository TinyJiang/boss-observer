# CLS 定时 SQL 任务清单

本文件汇总当前 analysis-system 需要在腾讯云 CLS 层配置的定时 SQL 任务。用户可按本文件在 CLS 控制台创建任务。

## 总览

| 顺序 | 任务名 | 源主题 | 目标主题建议 | 周期 | SQL 时间窗口 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `boss_minute_operator_funnel` | 原始事实日志主题，例如 `boss` | `boss_summary_minute_prod` | 1 分钟 | `@m-3m,@m-1m` | 操作员分钟漏斗 |
| 2 | `boss_minute_chat` | 原始事实日志主题，例如 `boss` | `boss_summary_minute_prod` | 1 分钟 | `@m-3m,@m-1m` | 聊天分钟质量和数量 |
| 3 | `boss_daily_operator_active_duration` | `boss_summary_minute_prod` | `boss_summary_daily_prod` | 5 分钟 | `@d,@m-1m` | 当日活跃分钟快照 |
| 4 | `boss_10min_log_quality` | 原始事实日志主题，例如 `boss` | `boss_health_10min_prod` | 10 分钟 | `@m-12m,@m-2m` | 10 分钟日志质量报告 |
| 5 | `boss_daily_operator_basic_stats` | 原始事实日志主题，例如 `boss` | `boss_summary_daily_basic_prod` | 按需，建议 5 分钟或日终 | `@d,@m-1m` 或 `@d-1d,@d` | 操作员日级基础统计 |
| 6 | `boss_daily_operator_chat_reply_stats` | 原始事实日志主题，例如 `boss` | `boss_summary_daily_basic_prod` | 跟随任务 5 | `@d,@m-1m` 或 `@d-1d,@d` | 操作员日级聊天回复分析 |

说明：

- SQL 语句复制到 CLS 控制台时不要带末尾分号。
- 生产 API、worker 和调度任务不得用 CLS Search/SearchLog 作为数据源；这些任务的输出应通过目标日志主题、指标主题、Kafka/投递链路或后续同步入库消费。
- 定时 SQL 是追加写，不做 upsert。analysis-system 读取日级和质量快照时，需要按稳定键取最新结果。
- 源主题和目标主题都要配置索引；索引变更只对新写入日志生效，历史数据可能需要重跑任务或接受缺口。
- 分钟汇总不按职位拆行；同一操作员同一分钟内如果操作多个职位，计数字段统计整分钟，`job_id/job_name` 使用该分钟内 `__TIMESTAMP__` 最大的事件上下文。

## Topic 配置

建议使用 1 个原始事实 topic 和 4 个汇总/健康目标 topic。

| Topic 名称 | 类型 | 来源/写入方 | 读取方 | 建议保留周期 | 本地环境变量 |
| --- | --- | --- | --- | --- | --- |
| `boss` | 原始事实日志 topic | Chrome 插件上传链路 | CLS 定时 SQL、后续 Kafka consumer | 按业务审计要求，建议 30 到 90 天起 | `CLS_KAFKA_TOPIC` 指 Kafka 消费 topic；本地排障不要把它配置成 SearchLog 生产源 |
| `boss_summary_minute_prod` | 分钟汇总日志 topic | `boss_minute_operator_funnel`、`boss_minute_chat` | summary-reader、日级定时 SQL、summary-sync | 建议 30 到 90 天 | `CLS_SUMMARY_TOPIC_ID` |
| `boss_summary_daily_prod` | 日级汇总日志 topic | `boss_daily_operator_active_duration` | daily summary reader、summary-sync | 建议 180 到 365 天 | `CLS_DAILY_SUMMARY_TOPIC_ID` |
| `boss_summary_daily_basic_prod` | 日级基础统计指标 topic | `boss_daily_operator_basic_stats` | 后续 daily basic summary reader、summary-sync | 建议 180 到 365 天 | `CLS_DAILY_BASIC_SUMMARY_TOPIC_ID` |
| `boss_health_10min_prod` | 10 分钟健康/质量日志 topic | `boss_10min_log_quality` | log-health reader、summary-sync | 建议 30 到 180 天 | `CLS_LOG_QUALITY_TOPIC_ID` |

创建顺序：

1. 确认原始事实 topic `boss` 已存在，并修正字段索引。
2. 创建或确认 `boss_summary_minute_prod`，配置目标字段索引。
3. 创建或确认 `boss_summary_daily_prod`，配置目标字段索引。
4. 创建或确认 `boss_summary_daily_basic_prod`，配置目标字段索引。
5. 创建或确认 `boss_health_10min_prod`，配置目标字段索引。
6. 先创建分钟任务，再创建日级任务；质量任务可独立创建。

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
| `job_name` | text | 是 | 岗位展示名称，推荐规范化字段名 |
| `jobName` | text | 是 | 兼容插件 camelCase 上报字段 |
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
| `plugin_version` | text | 是 |
| `job_id` | text | 是 |
| `job_name` | text | 是 |
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

### 日级基础统计 Topic：`boss_summary_daily_basic_prod`

用途：

- 承载 `boss_daily_operator_basic_stats` 输出。
- 供 analysis-system《历史数据》页面和 `/api/history` 读取 raw CLS 直接计算的操作员日级基础统计；该页面不从分钟汇总累加 fallback。
- 当前本地实现按 CLS 指标 topic 读取，使用 `QueryRangeMetric` 一次性查询 `metric_name="boss_daily_operator_basic_stats"` 的指标样本，并按 `active_date + operator_id` 组装历史记录。若后续把任务改写到普通日志 topic，可设置 `CLS_DAILY_BASIC_SUMMARY_SOURCE=log` 切换到 `SearchLog` 读取。

本地配置：

```bash
CLS_DAILY_BASIC_SUMMARY_TOPIC_ID=<boss_summary_daily_basic_prod 的 TopicId>
CLS_DAILY_BASIC_SUMMARY_SOURCE=metric
CLS_DAILY_BASIC_SUMMARY_QUERY=*
CLS_DAILY_BASIC_SUMMARY_WINDOW_MINUTES=today
```

当前代码已接入日级基础统计 parser、CLS 指标 topic reader、`/api/history` 和前端《历史数据》页面。真实 summary 模式下，历史接口会按筛选日期即时查询该日级基础统计指标 topic；实时大盘刷新不会预取该 topic，避免影响当日实时链路。

对话分析字段：

| 字段 | 类型建议 | 说明 |
| --- | --- | --- |
| `first_round_candidate_initiated_count` | long | 第一轮由候选人先说话的会话数，作为首轮 BOSS 回复率分母 |
| `first_round_boss_replied_count` | long | 第一轮候选人先说话后，BOSS 在下一轮回复的会话数 |
| `first_round_boss_reply_elapsed_median_ms` | long | 首轮 BOSS 回复间隔中位数，单位毫秒 |
| `first_round_boss_reply_elapsed_avg_ms` | long | 首轮 BOSS 回复间隔平均值，单位毫秒 |
| `chat_conversation_count` | long | 当日可解析出消息轮次的聊天会话数 |
| `boss_ended_conversation_count` | long | 最后一轮发言人为 BOSS 的会话数，作为 BOSS 结束率分子 |
| `boss_reply_count` | long | 全部候选人发言轮次后 BOSS 下一轮回复的次数 |
| `boss_reply_elapsed_median_ms` | long | 全轮 BOSS 回复间隔中位数，单位毫秒 |
| `boss_reply_elapsed_avg_ms` | long | 全轮 BOSS 回复间隔平均值，单位毫秒 |

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
CLS_LOG_QUALITY_TOPIC_ID=<boss_health_10min_prod 的 TopicId>
CLS_LOG_QUALITY_QUERY=*
CLS_LOG_QUALITY_WINDOW_MINUTES=today
```

## 通用索引要求

原始事实日志主题建议开启以下键值索引和统计分析：

- 字符串：`event_id`、`event_type`、`occurred_at`、`plugin_version`、`operator_id`、`operator_account_name`、`boss_account_name`、`session_id`、`page_type`、`job_id`、`job_name`、`jobName`、`payload_json`、`context_json`
- 布尔或字符串：`boss_account_matched`

特别注意：

- `operator_id`、`job_id`、`job_name`、`jobName`、`plugin_version` 必须按字符串类型配置。`operator_id` 如果被配置成 long，会导致字符串账号聚合成 `<missing>`。
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
- `plugin_version`
- `job_id`
- `job_name`
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
  max_by(plugin_version, event_at) as plugin_version,
  max_by(job_id, event_at) as job_id,
  max_by(job_name, event_at) as job_name,
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
    __TIMESTAMP__ as event_at,
    case when operator_id is null or operator_id = '' then '<missing>' else cast(operator_id as varchar) end as operator_id,
    case when plugin_version is null or plugin_version = '' then '<missing>' else cast(plugin_version as varchar) end as plugin_version,
    case when job_id is null or job_id = '' then '<missing>' else cast(job_id as varchar) end as job_id,
    coalesce(
      nullif(try(json_extract_scalar(context_json, '$.jobContext.jobName')), ''),
      ''
    ) as job_name,
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
group by minute, operator_id
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
- `plugin_version`
- `job_id`
- `job_name`
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
  max_by(plugin_version, event_at) as plugin_version,
  max_by(job_id, event_at) as job_id,
  max_by(job_name, event_at) as job_name,
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
    __TIMESTAMP__ as event_at,
    case when operator_id is null or operator_id = '' then '<missing>' else cast(operator_id as varchar) end as operator_id,
    case when plugin_version is null or plugin_version = '' then '<missing>' else cast(plugin_version as varchar) end as plugin_version,
    case when job_id is null or job_id = '' then '<missing>' else cast(job_id as varchar) end as job_id,
    coalesce(
      nullif(try(json_extract_scalar(context_json, '$.jobContext.jobName')), ''),
      ''
    ) as job_name,
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
group by minute, operator_id
limit 10000
```

说明：

- `plugin_version` 使用该操作员该分钟内最后一条事件的版本号，只作为展示和排查维度，不参与 `group by`，避免同一分钟多版本时拆分漏斗计数。

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

## 任务 5：`boss_daily_operator_basic_stats`

配置：

- 源主题：原始事实日志主题，例如 `boss`。
- 目标主题：`boss_summary_daily_basic_prod`。
- 调度周期：按需，建议 5 分钟或日终。
- SQL 时间窗口：当天快照用 `@d,@m-1m`；补昨天整天用 `@d-1d,@d`。
- 输出时间戳：CLS 默认。

说明：

- 聊天正文不输出到目标 topic；SQL 只读取 `messages[].direction`、`messages[].messageAt`、`messages[].fingerprint` 和 `messageIndex` 来计算轮次和间隔。
- “首轮 BOSS 回复率”分母是第一轮由候选人先发言的会话数；分子是该候选人首轮之后下一轮为 BOSS 回复的会话数。
- “BOSS 结束率”分母是可解析出消息轮次的会话数；分子是最后一轮发言人为 BOSS 的会话数。
- “全轮 BOSS 回复间隔”按候选人连续发言轮次到下一轮 BOSS 首条回复的时间差统计。
- 2026-05-26 raw CLS 排障确认，当时历史快照中的 `messages[].direction` 全部为 `unknown`，且消息对象没有其它可替代的说话人结构字段；这批历史数据不能可靠回算 BOSS 回复率、BOSS 结束率或回复间隔。任务 6 只有在后续快照写入可映射的 `candidate/geek/recruiter/boss` 方向后才会产生有效方向指标。
- 由于 CLS 单条查询长度限制，聊天回复分析不要合并进基础统计 SQL；使用任务 6 的短 SQL 单独写入同一个日级基础统计指标 topic，并保持 `metric_name = 'boss_daily_operator_basic_stats'`，analysis-system 会按指标字段自动拼回同一条历史记录。

目标字段：

- `metric_name`
- `active_date`
- `operator_id`
- `operator_account_name`
- `boss_account_name`
- `boss_account_matched`
- `first_active_minute`
- `last_active_minute`
- `active_minutes`
- `active_seconds`
- `observed_minutes`
- `session_count`
- `touched_job_count`
- `plugin_started`
- `boss_page_entered`
- `boss_page_left`
- `page_changed`
- `plugin_exception`
- `job_context_detected`
- `job_context_changed`
- `filter_panel_opened`
- `filter_applied`
- `card_exposed`
- `detail_opened`
- `detail_closed`
- `greeting_clicked`
- `greeting_succeeded`
- `greeting_failed`
- `chat_opened`
- `snapshot_captured`
- `wechat_captured`
- `capture_failed`
- `card_unique_candidates`
- `detail_unique_candidates`
- `greeting_unique_candidates`
- `chat_unique_candidates`
- `wechat_unique_candidates`
- `visible_message_count`
- `may_be_incomplete_count`
- `first_round_candidate_initiated_count`
- `first_round_boss_replied_count`
- `first_round_boss_reply_elapsed_median_ms`
- `first_round_boss_reply_elapsed_avg_ms`
- `chat_conversation_count`
- `boss_ended_conversation_count`
- `boss_reply_count`
- `boss_reply_elapsed_median_ms`
- `boss_reply_elapsed_avg_ms`
- `detail_duration_ms`
- `greeting_result_elapsed_ms`
- `total_events`
- `source_row_count`

任务 5 基础统计 SQL 保留当前生产版本；不要把任务 6 的聊天回复分析 CTE 合并进这条 SQL。

## 任务 6：`boss_daily_operator_chat_reply_stats`

配置：

- 源主题：原始事实日志主题，例如 `boss`。
- 目标主题：`boss_summary_daily_basic_prod`，与任务 5 相同。
- 调度周期：跟随任务 5。
- SQL 时间窗口：当天快照用 `@d,@m-1m`；补昨天整天用 `@d-1d,@d`。
- 输出时间戳：CLS 默认。
- 输出 `metric_name` 固定为 `boss_daily_operator_basic_stats`，用于让 analysis-system 的日级基础统计 reader 把这些字段拼到同一条历史记录中。
- 该 SQL 长度低于 CLS `12000` 字符限制，且不使用 `with` CTE；不要再拼回任务 5。

SQL：

```sql
* |
select
  'boss_daily_operator_basic_stats' metric_name,
  substr(cast(d as varchar), 1, 10) active_date,
  op operator_id,
  count(distinct case when fd = 'c' then ck end) first_round_candidate_initiated_count,
  sum(case when first_reply_ms is not null then 1 else 0 end) first_round_boss_replied_count,
  coalesce(cast(approx_percentile(first_reply_ms, 0.5) as bigint), 0) first_round_boss_reply_elapsed_median_ms,
  coalesce(cast(avg(first_reply_ms) as bigint), 0) first_round_boss_reply_elapsed_avg_ms,
  count(distinct ck) chat_conversation_count,
  count(distinct case when ld = 'b' then ck end) boss_ended_conversation_count,
  sum(case when reply_ms is not null then 1 else 0 end) boss_reply_count,
  coalesce(cast(approx_percentile(reply_ms, 0.5) as bigint), 0) boss_reply_elapsed_median_ms,
  coalesce(cast(avg(reply_ms) as bigint), 0) boss_reply_elapsed_avg_ms
from (
  select
    *,
    case
      when dir = 'c' and nd = 'b' and nfm >= lm
      then date_diff('millisecond', lm, nfm)
    end reply_ms,
    case
      when ti = 1 and dir = 'c' and nd = 'b' and nfm >= lm
      then date_diff('millisecond', lm, nfm)
    end first_reply_ms
  from (
    select
      *,
      first_value(dir) over (
        partition by d, op, ck
        order by ti
        rows between unbounded preceding and unbounded following
      ) fd,
      last_value(dir) over (
        partition by d, op, ck
        order by ti
        rows between unbounded preceding and unbounded following
      ) ld,
      lead(dir) over (partition by d, op, ck order by ti) nd,
      lead(fm) over (partition by d, op, ck order by ti) nfm
    from (
      select
        d, op, ck, ti, dir,
        min(mt) fm,
        max(mt) lm
    from (
      select
        *,
        sum(case when pd is null or pd <> dir then 1 else 0 end) over (
          partition by d, op, ck
          order by mt, mi, k
          rows between unbounded preceding and current row
        ) ti
      from (
        select
          *,
          lag(dir) over (
            partition by d, op, ck
            order by mt, mi, k
          ) pd
        from (
          select d, op, ck, coalesce(mi, 0) mi, mt, dir, k
          from (
            select
              *,
              row_number() over (
                partition by d, op, ck, k
                order by et desc, mi desc
              ) rn
            from (
              select
                d, op, ck, et,
                try_cast(nullif(try(json_extract_scalar(m, '$.messageIndex')), '') as bigint) mi,
                try(from_iso8601_timestamp(try(json_extract_scalar(m, '$.messageAt')))) mt,
                case
                  when lower(coalesce(try(json_extract_scalar(m, '$.direction')), '')) in ('candidate', 'geek') then 'c'
                  when lower(coalesce(try(json_extract_scalar(m, '$.direction')), '')) in ('recruiter', 'boss') then 'b'
                  else ''
                end dir,
                coalesce(
                  nullif(try(json_extract_scalar(m, '$.fingerprint')), ''),
                  concat(coalesce(try(json_extract_scalar(m, '$.messageIndex')), ''), ':', coalesce(try(json_extract_scalar(m, '$.messageAt')), ''), ':', coalesce(try(json_extract_scalar(m, '$.direction')), ''))
                ) k
              from (
                select
                  histogram(__TIMESTAMP__, interval 1 day) d,
                  case when operator_id is null or operator_id = '' then '<missing>' else cast(operator_id as varchar) end op,
                  __TIMESTAMP__ et,
                  coalesce(
                    nullif(try(json_extract_scalar(payload_json, '$.chat.conversationKey')), ''),
                    nullif(try(json_extract_scalar(payload_json, '$.candidate.candidateId')), ''),
                    nullif(try(json_extract_scalar(payload_json, '$.candidate.stableId')), ''),
                    nullif(try(json_extract_scalar(payload_json, '$.candidate.exposureKey')), '')
                  ) ck,
                  json_extract(cast(coalesce(payload_json, '') as varchar), '$.chat.messages') ms
                where event_type = 'candidate_chat.snapshot_captured'
              ) s
              cross join unnest(cast(ms as array(json))) as u(m)
              where d is not null
                and ck is not null
                and ms is not null
                and lower(op) not in ('', '<missing>', 'missing', '__missing__', 'null', 'none')
            )
            where mt is not null
              and dir in ('c', 'b')
              and k is not null
          )
          where rn = 1
        )
      )
    )
    group by d, op, ck, ti, dir
  )
)
)
group by d, op
limit 10000
```

以下是合并版旧稿，超过 CLS `param query must less than 12000` 限制，仅保留作口径参考，不要直接创建任务：

```sql
* |
with base_events as (
  select
    try(from_iso8601_date(substr(coalesce(nullif(cast(occurred_at as varchar), ''), cast(__TIMESTAMP__ as varchar)), 1, 10))) as active_date,
    __TIMESTAMP__ as event_at,
    substr(cast(__TIMESTAMP__ as varchar), 1, 16) as active_minute,
    case when operator_id is null or operator_id = '' then '<missing>' else cast(operator_id as varchar) end as operator_id,
    cast(coalesce(operator_account_name, '') as varchar) as operator_account_name,
    cast(coalesce(boss_account_name, '') as varchar) as boss_account_name,
    cast(coalesce(boss_account_matched, '') as varchar) as boss_account_matched,
    case when session_id is null or session_id = '' then '<missing>' else cast(session_id as varchar) end as session_id,
    case when job_id is null or job_id = '' then '<missing>' else cast(job_id as varchar) end as job_id,
    cast(event_type as varchar) as event_type,
    cast(coalesce(payload_json, '') as varchar) as payload_text,
    coalesce(
      nullif(try(json_extract_scalar(payload_json, '$.candidate.candidateId')), ''),
      nullif(try(json_extract_scalar(payload_json, '$.candidate.stableId')), ''),
      nullif(try(json_extract_scalar(payload_json, '$.candidate.exposureKey')), '')
    ) as candidate_key,
    coalesce(try_cast(nullif(try(json_extract_scalar(payload_json, '$.chat.messageCount')), '') as bigint), 0) as chat_message_count,
    coalesce(try(json_extract_scalar(payload_json, '$.chat.mayBeIncomplete')), '') as may_be_incomplete,
    coalesce(
      try_cast(nullif(try(json_extract_scalar(payload_json, '$.durationMs')), '') as bigint),
      try_cast(nullif(try(json_extract_scalar(payload_json, '$.detail.durationMs')), '') as bigint),
      0
    ) as detail_duration_ms,
    coalesce(
      try_cast(nullif(try(json_extract_scalar(payload_json, '$.elapsedMs')), '') as bigint),
      try_cast(nullif(try(json_extract_scalar(payload_json, '$.greeting.elapsedMs')), '') as bigint),
      0
    ) as greeting_result_elapsed_ms
  where event_type in (
    'page_session.plugin_started',
    'page_session.boss_page_entered',
    'page_session.boss_page_left',
    'page_session.page_changed',
    'page_session.plugin_exception',
    'job_context.detected',
    'job_context.changed',
    'candidate_filter.panel_opened',
    'candidate_filter.applied',
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
),
daily_base as (
  select
    'boss_daily_operator_basic_stats' as metric_name,
    cast(active_date as varchar) as active_date,
    operator_id,
    max_by(operator_account_name, event_at) as operator_account_name,
    max_by(boss_account_name, event_at) as boss_account_name,
    max_by(boss_account_matched, event_at) as boss_account_matched,
    cast(min(event_at) as varchar) as first_active_minute,
    cast(max(event_at) as varchar) as last_active_minute,
    count(distinct active_minute) as active_minutes,
    count(distinct active_minute) * 60 as active_seconds,
    count(distinct active_minute) as observed_minutes,
    count(distinct session_id) as session_count,
    count(distinct job_id) as touched_job_count,
    sum(case when event_type = 'page_session.plugin_started' then 1 else 0 end) as plugin_started,
    sum(case when event_type = 'page_session.boss_page_entered' then 1 else 0 end) as boss_page_entered,
    sum(case when event_type = 'page_session.boss_page_left' then 1 else 0 end) as boss_page_left,
    sum(case when event_type = 'page_session.page_changed' then 1 else 0 end) as page_changed,
    sum(case when event_type = 'page_session.plugin_exception' then 1 else 0 end) as plugin_exception,
    sum(case when event_type = 'job_context.detected' then 1 else 0 end) as job_context_detected,
    sum(case when event_type = 'job_context.changed' then 1 else 0 end) as job_context_changed,
    sum(case when event_type = 'candidate_filter.panel_opened' then 1 else 0 end) as filter_panel_opened,
    sum(case when event_type = 'candidate_filter.applied' then 1 else 0 end) as filter_applied,
    sum(case when event_type = 'candidate_list.card_exposed' then 1 else 0 end) as card_exposed,
    sum(case when event_type = 'candidate_detail.opened' then 1 else 0 end) as detail_opened,
    sum(case when event_type = 'candidate_detail.closed' then 1 else 0 end) as detail_closed,
    sum(case when event_type = 'candidate_greeting.clicked' then 1 else 0 end) as greeting_clicked,
    sum(case when event_type = 'candidate_greeting.succeeded' then 1 else 0 end) as greeting_succeeded,
    sum(case when event_type = 'candidate_greeting.failed' then 1 else 0 end) as greeting_failed,
    sum(case when event_type = 'candidate_chat.opened' then 1 else 0 end) as chat_opened,
    sum(case when event_type = 'candidate_chat.snapshot_captured' then 1 else 0 end) as snapshot_captured,
    sum(case when event_type = 'candidate_chat.wechat_captured' then 1 else 0 end) as wechat_captured,
    sum(case when event_type = 'candidate_chat.capture_failed' then 1 else 0 end) as capture_failed,
    count(distinct case when event_type = 'candidate_list.card_exposed' then candidate_key end) as card_unique_candidates,
    count(distinct case when event_type = 'candidate_detail.opened' then candidate_key end) as detail_unique_candidates,
    count(distinct case when event_type = 'candidate_greeting.clicked' then candidate_key end) as greeting_unique_candidates,
    count(distinct case when event_type = 'candidate_chat.opened' then candidate_key end) as chat_unique_candidates,
    count(distinct case when event_type = 'candidate_chat.wechat_captured' then candidate_key end) as wechat_unique_candidates,
    sum(case when event_type = 'candidate_chat.snapshot_captured' then chat_message_count else 0 end) as visible_message_count,
    sum(case when event_type = 'candidate_chat.snapshot_captured' and lower(may_be_incomplete) = 'true' then 1 else 0 end) as may_be_incomplete_count,
    sum(case when event_type = 'candidate_detail.closed' then detail_duration_ms else 0 end) as detail_duration_ms,
    sum(case when event_type in ('candidate_greeting.succeeded', 'candidate_greeting.failed') then greeting_result_elapsed_ms else 0 end) as greeting_result_elapsed_ms,
    count(*) as total_events,
    count(*) as source_row_count
  from base_events
  where active_date is not null
    and lower(operator_id) not in ('', '<missing>', 'missing', '__missing__', 'null', 'none')
  group by active_date, operator_id
),
snapshot_rows as (
  select
    active_date,
    event_at,
    operator_id,
    coalesce(
      nullif(try(json_extract_scalar(payload_text, '$.chat.conversationKey')), ''),
      candidate_key
    ) as conversation_key,
    json_extract(payload_text, '$.chat.messages') as messages_json
  from base_events
  where active_date is not null
    and event_type = 'candidate_chat.snapshot_captured'
    and lower(operator_id) not in ('', '<missing>', 'missing', '__missing__', 'null', 'none')
    and json_extract(payload_text, '$.chat.messages') is not null
),
messages_raw as (
  select
    active_date,
    operator_id,
    conversation_key,
    event_at as snapshot_event_at,
    cast(message_ordinal as bigint) as message_ordinal,
    try_cast(nullif(try(json_extract_scalar(message_json, '$.messageIndex')), '') as bigint) as message_index,
    try(from_iso8601_timestamp(try(json_extract_scalar(message_json, '$.messageAt')))) as message_at,
    case
      when lower(coalesce(try(json_extract_scalar(message_json, '$.direction')), '')) in ('candidate', 'geek') then 'candidate'
      when lower(coalesce(try(json_extract_scalar(message_json, '$.direction')), '')) in ('recruiter', 'boss') then 'recruiter'
      else ''
    end as direction,
    coalesce(
      nullif(try(json_extract_scalar(message_json, '$.fingerprint')), ''),
      concat(
        cast(coalesce(try_cast(nullif(try(json_extract_scalar(message_json, '$.messageIndex')), '') as bigint), message_ordinal) as varchar),
        ':',
        coalesce(try(json_extract_scalar(message_json, '$.messageAt')), ''),
        ':',
        coalesce(try(json_extract_scalar(message_json, '$.direction')), '')
      )
    ) as message_key
  from snapshot_rows
  cross join unnest(cast(messages_json as array(json))) with ordinality as u(message_json, message_ordinal)
  where conversation_key is not null
),
messages_deduped as (
  select
    active_date,
    operator_id,
    conversation_key,
    coalesce(message_index, message_ordinal) as message_index,
    message_at,
    direction,
    message_key
  from (
    select
      *,
      row_number() over (
        partition by active_date, operator_id, conversation_key, message_key
        order by snapshot_event_at desc, message_ordinal desc
      ) as duplicate_rank
    from messages_raw
    where message_at is not null
      and direction in ('candidate', 'recruiter')
      and message_key is not null
  )
  where duplicate_rank = 1
),
ordered_messages as (
  select
    *,
    lag(direction) over (
      partition by active_date, operator_id, conversation_key
      order by message_at, message_index, message_key
    ) as previous_direction
  from messages_deduped
),
turn_marked_messages as (
  select
    *,
    sum(case when previous_direction is null or previous_direction <> direction then 1 else 0 end) over (
      partition by active_date, operator_id, conversation_key
      order by message_at, message_index, message_key
      rows between unbounded preceding and current row
    ) as turn_index
  from ordered_messages
),
turns as (
  select
    active_date,
    operator_id,
    conversation_key,
    turn_index,
    direction,
    min(message_at) as first_message_at,
    max(message_at) as last_message_at
  from turn_marked_messages
  group by active_date, operator_id, conversation_key, turn_index, direction
),
conversation_stats as (
  select
    active_date,
    operator_id,
    conversation_key,
    min_by(direction, turn_index) as first_turn_direction,
    max_by(direction, turn_index) as last_turn_direction,
    count(*) as turn_count
  from turns
  group by active_date, operator_id, conversation_key
),
candidate_turn_replies as (
  select
    c.active_date,
    c.operator_id,
    c.conversation_key,
    c.turn_index,
    date_diff('millisecond', c.last_message_at, r.first_message_at) as boss_reply_elapsed_ms
  from turns c
  join turns r
    on c.active_date = r.active_date
    and c.operator_id = r.operator_id
    and c.conversation_key = r.conversation_key
    and r.turn_index = c.turn_index + 1
    and r.direction = 'recruiter'
  where c.direction = 'candidate'
    and r.first_message_at >= c.last_message_at
),
daily_conversations as (
  select
    active_date,
    operator_id,
    count(*) as chat_conversation_count,
    sum(case when last_turn_direction = 'recruiter' then 1 else 0 end) as boss_ended_conversation_count
  from conversation_stats
  group by active_date, operator_id
),
daily_first_rounds as (
  select
    cs.active_date,
    cs.operator_id,
    count(*) as first_round_candidate_initiated_count,
    count(fr.boss_reply_elapsed_ms) as first_round_boss_replied_count,
    coalesce(cast(approx_percentile(fr.boss_reply_elapsed_ms, 0.5) as bigint), 0) as first_round_boss_reply_elapsed_median_ms,
    coalesce(cast(avg(fr.boss_reply_elapsed_ms) as bigint), 0) as first_round_boss_reply_elapsed_avg_ms
  from conversation_stats cs
  left join candidate_turn_replies fr
    on cs.active_date = fr.active_date
    and cs.operator_id = fr.operator_id
    and cs.conversation_key = fr.conversation_key
    and fr.turn_index = 1
  where cs.first_turn_direction = 'candidate'
  group by cs.active_date, cs.operator_id
),
daily_boss_replies as (
  select
    active_date,
    operator_id,
    count(*) as boss_reply_count,
    coalesce(cast(approx_percentile(boss_reply_elapsed_ms, 0.5) as bigint), 0) as boss_reply_elapsed_median_ms,
    coalesce(cast(avg(boss_reply_elapsed_ms) as bigint), 0) as boss_reply_elapsed_avg_ms
  from candidate_turn_replies
  group by active_date, operator_id
)
select
  b.metric_name,
  b.active_date,
  b.operator_id,
  b.operator_account_name,
  b.boss_account_name,
  b.boss_account_matched,
  b.first_active_minute,
  b.last_active_minute,
  b.active_minutes,
  b.active_seconds,
  b.observed_minutes,
  b.session_count,
  b.touched_job_count,
  b.plugin_started,
  b.boss_page_entered,
  b.boss_page_left,
  b.page_changed,
  b.plugin_exception,
  b.job_context_detected,
  b.job_context_changed,
  b.filter_panel_opened,
  b.filter_applied,
  b.card_exposed,
  b.detail_opened,
  b.detail_closed,
  b.greeting_clicked,
  b.greeting_succeeded,
  b.greeting_failed,
  b.chat_opened,
  b.snapshot_captured,
  b.wechat_captured,
  b.capture_failed,
  b.card_unique_candidates,
  b.detail_unique_candidates,
  b.greeting_unique_candidates,
  b.chat_unique_candidates,
  b.wechat_unique_candidates,
  b.visible_message_count,
  b.may_be_incomplete_count,
  coalesce(f.first_round_candidate_initiated_count, 0) as first_round_candidate_initiated_count,
  coalesce(f.first_round_boss_replied_count, 0) as first_round_boss_replied_count,
  coalesce(f.first_round_boss_reply_elapsed_median_ms, 0) as first_round_boss_reply_elapsed_median_ms,
  coalesce(f.first_round_boss_reply_elapsed_avg_ms, 0) as first_round_boss_reply_elapsed_avg_ms,
  coalesce(c.chat_conversation_count, 0) as chat_conversation_count,
  coalesce(c.boss_ended_conversation_count, 0) as boss_ended_conversation_count,
  coalesce(r.boss_reply_count, 0) as boss_reply_count,
  coalesce(r.boss_reply_elapsed_median_ms, 0) as boss_reply_elapsed_median_ms,
  coalesce(r.boss_reply_elapsed_avg_ms, 0) as boss_reply_elapsed_avg_ms,
  b.detail_duration_ms,
  b.greeting_result_elapsed_ms,
  b.total_events,
  b.source_row_count
from daily_base b
left join daily_first_rounds f
  on b.active_date = cast(f.active_date as varchar)
  and b.operator_id = f.operator_id
left join daily_conversations c
  on b.active_date = cast(c.active_date as varchar)
  and b.operator_id = c.operator_id
left join daily_boss_replies r
  on b.active_date = cast(r.active_date as varchar)
  and b.operator_id = r.operator_id
limit 10000
```

## 配置后检查

1. 先确认目标主题有新日志写入。
2. 在目标主题检索 `metric_name:"boss_minute_operator_funnel"`、`metric_name:"boss_minute_chat"`、`metric_name:"boss_daily_operator_active_duration"`、`metric_name:"boss_10min_log_quality"`、`metric_name:"boss_daily_operator_basic_stats"`。
3. 检查 `operator_id` 是否仍出现 `<missing>`。如果 raw 主题实际有 `operator_id`，而汇总结果是 `<missing>`，优先检查源主题索引类型。
4. 检查 `source_row_count` 是否大于等于各计数字段之和的合理范围。
5. `boss_daily_operator_active_duration` 的 `active_minutes` 不应超过 1440。
6. `boss_10min_log_quality` 的质量字段只代表 CLS 层字段/线索覆盖，不代表跨事件精确回连已经完成。
7. `boss_daily_operator_basic_stats` 的回复间隔字段只在聊天快照包含可解析 `messageAt` 和 `direction` 时有值；`first_round_candidate_initiated_count = 0` 时首轮回复率应展示为暂无。

## 参考链接

- CLS 定时 SQL 创建任务：https://cloud.tencent.com/document/product/614/78891
- CLS 创建定时 SQL API：https://cloud.tencent.com/document/product/614/95138
- CLS 数据处理限制：https://cloud.tencent.com/document/product/614/86622
- CLS 日期和时间函数：https://cloud.tencent.com/document/product/614/58981
