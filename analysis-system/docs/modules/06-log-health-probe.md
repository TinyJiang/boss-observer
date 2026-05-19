# 日志健康度探测

## 职责

本模块用于判断招聘事实日志的数量和质量是否正常，并把异常转成可解释、可追踪、可告警的健康信号。

代码归属：

- `src/boss_analysis/workers/` 中的 `log-health-probe-worker`
- `src/boss_analysis/domain/` 中的健康规则、快照和结果模型
- `src/boss_analysis/storage/` 中的健康快照、规则结果和事件表 repository
- `src/boss_analysis/api/` 中的数据健康查询接口
- `tests/` 中的健康规则、窗口聚合和 API 测试

本模块只评价日志链路可信度，不评价候选人质量、招聘专员绩效或话术质量。

## 目标

核心问题：

- 日志是否还在持续到达。
- 日志数量是否出现异常归零、断崖下降或突增。
- 关键事件类型是否缺失或比例异常。
- 原始事件、分钟汇总、日级汇总之间是否新鲜且可对齐。
- 事件字段、JSON 结构、操作员归属、事件序列是否满足日志契约。
- 单条 card、detail、greeting、chat 日志的关键字段是否完整，是否能和前后链路保守关联。
- 某个插件版本是否引入字段缺失、候选人身份降级或链路关联失败。
- 异常是否能定位到时间窗口、操作员、事件类型、来源模块或汇总任务。

第一版输出：

- 全局健康状态：`ok` / `warning` / `critical` / `unknown`。
- 按操作员、事件类型、汇总任务和数据源拆分的健康结果。
- 每条规则的当前状态、证据、阈值、最近触发时间和恢复时间。
- 数据质量页可展示的异常清单和排查入口。

## 不做什么

- 不在生产 API、worker、定时任务或同步任务中调用 CLS Search/SearchLog。
- 不从 Chrome 插件 debug 页、popup Profile 或 Chrome storage 读取生产状态。
- 不读取或展示聊天正文、联系方式、完整简历正文。
- 不把“某人今天日志少”直接解释成偷懒、离线或绩效差。
- 不把 BOSS DOM 规则、插件内部 helper 或前台临时字段复制进分析系统。
- 不向插件下发采集策略或业务判断。

## 输入来源

生产环境只允许使用已批准的数据链路。

| 来源 | 用途 | 说明 |
| --- | --- | --- |
| `raw_events` | 原始事件数量、最新事件、字段缺失、事件类型分布 | 来自 Kafka consumer 或补数落库，不从 SearchLog 读取 |
| `event_parse_errors` | 解析失败率、失败字段、失败阶段 | 不保存完整敏感 payload，只保存截断 preview |
| 投影错误表 | 事实投影失败率、事件序列异常 | 例如详情关闭无打开、打招呼结果无法关联点击 |
| 单日志质量检查结果 | 事件关键字段、候选人身份、链路关联、消息结构质量 | 从已入库 `raw_events` 和事实投影结果派生 |
| `minute_summary_records` | 分钟级数量、关键事件趋势、缺 operator 异常 | 只同步 CLS 定时 SQL 产物或批准的下游汇总 |
| `daily_operator_active_duration` | 日级活跃分钟快照新鲜度和合理性 | 检查日级快照是否延迟或超过理论边界 |
| 运行状态表 | consumer、summary-sync、probe-worker 的心跳和延迟 | 不含业务正文 |
| `boss_10min_log_quality` | 上游日志主题的 10 分钟质量预聚合 | 推荐由 CLS 定时 SQL 写入目标汇总主题，再由 analysis-system 同步 |

开发排障可以临时使用 CLS SearchLog 做只读验证，但必须在工作日志中标注范围，不能保存为生产配置，也不能接入本模块正式实现。

## 推荐新增汇总

为了在不扫描 raw 日志的情况下观察上游日志质量，建议新增一个 CLS 定时 SQL 任务。质量报告第一版使用 10 分钟粒度，不做分钟级明细。

- 任务名：`boss_10min_log_quality`
- 源日志主题：插件原始事实日志主题
- 目标主题：优先写入独立 `boss_health_10min_prod`；也可临时写入 `boss_summary_minute_prod`，但必须用 `metric_name` 区分
- 调度周期：10 分钟
- 查询窗口：建议 `@m-12m,@m-2m` 或按真实索引延迟配置，覆盖最近一个完整 10 分钟窗口并避开刚写入日志尚未可查询导致的误报
- 生产读取方式：`summary-sync-worker` 同步目标主题，或由批准的非 Search 链路投递到数据库

目标字段建议：

| 字段 | 含义 |
| --- | --- |
| `metric_name` | 固定为 `boss_10min_log_quality` |
| `window_start` | 10 分钟窗口开始时间，使用 CLS `histogram(__TIMESTAMP__, interval 10 minute)` 生成 |
| `window_minutes` | 固定为 `10` |
| `operator_id` | 操作员 ID；缺失统一保留为 `<missing>` 或空维度异常 |
| `event_type` | 事件类型；可选维度，高基数过高时可只保留事件族 |
| `event_family` | 事件族，例如 `page_session`、`candidate_list`、`candidate_detail`、`candidate_greeting`、`candidate_chat`、`queue`、`upload` |
| `page_type` | 页面类型；可选维度 |
| `job_id` | 岗位 ID；可选维度 |
| `plugin_version` | 插件版本 |
| `raw_event_count` | 该维度下原始事件数 |
| `checked_event_count` | 参与单日志质量检查的事件数 |
| `missing_event_id_count` | 缺少事件 ID 的行数 |
| `missing_operator_count` | 缺少或无效操作员的行数 |
| `missing_plugin_version_count` | 缺少插件版本的行数 |
| `missing_session_count` | 缺少 session 的行数 |
| `missing_context_count` | 缺少关键 context 字段的行数 |
| `payload_missing_count` | payload 为空或不可用的行数 |
| `key_field_missing_count` | 关键字段缺失行数 |
| `candidate_identity_missing_count` | 候选人身份字段缺失行数 |
| `candidate_identity_low_confidence_count` | 候选人身份低置信行数 |
| `link_hint_missing_count` | 本应携带前序关联线索但缺失的行数 |
| `message_quality_issue_count` | 聊天消息结构质量异常行数 |
| `boss_account_unmatched_count` | `boss_account_matched` 为 false 的行数 |
| `plugin_exception_count` | 插件异常事件数 |
| `chat_capture_failed_count` | 聊天采集失败事件数 |
| `upload_failed_count` | 上传失败事件数；当前事件流未主动上报时为 0 或缺省 |
| `queue_write_failed_count` | 本地队列写入失败事件数；当前事件流未主动上报时为 0 或缺省 |
| `latest_occurred_at` | 该 10 分钟窗口内最新事件发生时间；第一版 SQL 可暂不输出，由 analysis-system 侧补算 |
| `source_row_count` | 参与汇总的源日志行数 |

如果 CLS SQL 无法稳定计算某些字段，允许第一版先在 `summary-sync-worker` 或 PostgreSQL 缓存表中补算，但补算来源必须是已入库 raw events 或已同步汇总，不得调用 SearchLog。

### CLS 定时 SQL

以下 SQL 是第一版 10 分钟日志质量汇总。它只检查字段存在性、候选人身份线索、链路关联线索和聊天 message 结构；它不做跨行 join，因此 `detail_card_link_hint_missing_count`、`greeting_source_link_hint_missing_count` 等字段只表示日志缺少可用于后续回连的线索。真正“是否找到 card 曝光”由 analysis-system 后续基于 `raw_events` / facts 精确检查。

推荐任务配置：

- 调度周期：10 分钟。
- 查询窗口：`@m-12m,@m-2m`。
- 输出时间戳：使用 CLS 默认时间戳即可。
- 目标主题索引：至少给 `metric_name`、`window_start`、`window_minutes`、`plugin_version`、`event_type`、`operator_id`、`page_type`、`job_id`、各计数字段开启键值索引和统计分析。

可直接贴入 CLS 定时 SQL 的执行语句如下，不需要末尾分号：

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

说明：

- `histogram(__TIMESTAMP__, interval 10 minute)` 使用 CLS 日志时间生成 10 分钟窗口。若后续确认 `occurred_at` 索引更可靠，可以在数据加工或入库时把业务发生时间写入 CLS 自定义时间戳后再使用该字段。
- SQL 只读取 `payload_json` 中的字段存在性，不输出 payload 原文。
- `sensitive_leak_signal_count` 是粗粒度信号，主要用于发现非聊天事件中意外出现联系方式；命中后仍需 analysis-system 在脱敏边界内二次确认。
- `payload_json` 字段提取使用 `try(json_extract_scalar(...))` 和 `try_cast(...)`，避免少量异常值让整次任务失败；解析失败率的权威统计仍由 analysis-system 的 normalizer/error 表负责。

## 健康维度

### 数量健康

数量健康回答“日志量是否符合预期”。它不直接判断人是否工作，只判断数据流是否可用。

第一版指标：

| 指标 | 粒度 | 异常示例 |
| --- | --- | --- |
| `latest_event_lag_seconds` | 全局、操作员、事件族 | 工作时间全局最近事件超过阈值 |
| `raw_event_count` | 分钟、5 分钟、小时、日 | 总量突然为 0 或低于基线 |
| `event_family_count` | 事件族、操作员 | 详情/聊天/打招呼某一族长时间消失 |
| `active_operator_count` | 分钟、15 分钟、日 | 配置了期望监控的时段内全局无人活跃 |
| `operator_event_count` | 操作员、窗口 | 某操作员已出现活动后突然长时间无后续事件 |
| `summary_record_count` | 汇总任务、分钟 | 上游 raw 有活动但汇总记录停止刷新 |
| `daily_snapshot_count` | 日级任务、日期 | 日级快照当天没有产出或长时间未更新 |
| `volume_drop_ratio` | 全局、事件族、操作员 | 当前窗口低于同类时间基线很多 |
| `volume_spike_ratio` | 全局、事件族、操作员 | 当前窗口高于基线很多，可能重复上报或循环采集 |
| `missing_minute_count` | 汇总任务、操作员 | 连续分钟桶缺失 |

“正常数量”由三层规则共同判断：

1. 绝对规则：例如最近 15 分钟全局 raw 事件为 0，且处于配置的监控时段，则 `critical`。
2. 基线规则：当前窗口与过去 7 到 14 天同星期、同小时的中位数或分位数比较。
3. 上下文规则：只有当操作员被配置为需要监控，或当天已经出现活动后，才对该操作员应用连续缺失规则。

没有配置工作时段时，系统级“全局无日志”只能输出 `unknown` 或 `warning`，不能武断输出 `critical`。

### 质量健康

质量健康回答“日志能否被可靠使用”。第一版指标：

| 指标 | 粒度 | 异常示例 |
| --- | --- | --- |
| `parse_error_rate` | 全局、事件类型、插件版本 | `payload_json` 或时间字段解析失败 |
| `projection_error_rate` | 事件类型、projector | 事实投影失败增加 |
| `unknown_event_type_rate` | 插件版本、事件类型 | 新插件发出未支持事件 |
| `missing_required_field_rate` | 字段、事件类型 | `event_id`、`occurred_at`、`operator_id` 缺失 |
| `missing_operator_rate` | 汇总任务、分钟 | `operator_id` 被索引成错误类型导致 `<missing>` |
| `duplicate_event_id_rate` | 全局、操作员 | 重复上传或重放幂等压力升高 |
| `clock_skew_rate` | 操作员、插件版本 | `occurred_at` 明显晚于或早于接收时间 |
| `late_arrival_rate` | 全局、操作员 | 迟到事件超过汇总修正窗口 |
| `summary_freshness_lag_seconds` | 汇总任务 | 分钟汇总最新 minute 落后 |
| `summary_consistency_delta` | 汇总任务、事件族 | 已入库 raw/fact 与已同步 summary 在可比窗口内差异过大 |
| `sequence_anomaly_count` | 事件链路 | 详情关闭无打开、打招呼结果无点击、聊天快照无打开上下文 |
| `single_event_quality_issue_rate` | 事件类型、插件版本 | 单条日志关键字段、候选人身份或消息结构异常 |
| `sensitive_leak_signal_count` | 事件类型、字段 | 非允许字段出现手机号/微信/完整正文迹象 |

敏感泄露检测只保存计数、字段名、事件类型和少量事件 ID，不能保存命中的原始敏感文本。

### 单日志质量检查

单日志质量检查在 `raw_events` 写入后执行，检查对象是已解析出的内部事件和必要的投影/关联结果。检查结果必须按以下维度聚合：

- `plugin_version`
- `event_type`
- `operator_id`
- `page_type`
- `job_id`
- `quality_rule_id`

检查分两类：

- 硬性契约：缺少后端必须依赖的字段，通常计入 `critical` 或 `warning`。
- 覆盖率信号：页面可能读不到但希望持续观察的字段，只计入覆盖率，不直接报严重异常。

硬性契约不要要求插件采集敏感正文。覆盖率信号也不能把没有采集完整简历、聊天历史或联系方式视为异常。

#### 通用检查

所有正式事件都检查：

| 检查项 | 等级 | 说明 |
| --- | --- | --- |
| `event.id` / `event_id` 存在且可做幂等键 | `critical` | 缺失时不能进入正常 raw event 主表 |
| `type` / `event_type` 存在 | `critical` | 未知类型保留，但缺类型是结构错误 |
| `occurredAt` / `occurred_at` 可解析 | `critical` | 解析失败进入错误表 |
| `pluginVersion` / `plugin_version` 存在 | `warning` | 缺失时无法按版本归因 |
| `operator.operatorId` / `operator_id` 存在且非 `<missing>` | `critical` | 不归并到真实操作员 |
| `context.sessionId`、`context.pageType`、`context.pageUrl` 可解析 | `warning` | 影响会话、页面和链路定位 |
| `payload_json`、`context_json` 可解析 | `critical` / `warning` | payload 失败通常影响事件语义，context 失败影响维度 |
| `boss_account_matched` 为 false | `critical` | 表示操作员门禁未匹配，不应归属真实业务行为 |

通用检查结果保存 `field_path`，例如 `payload.candidate.stableId`，但不保存字段原始敏感值。

#### Card 日志

适用事件：

- `candidate_list.card_exposed`

硬性检查：

| 字段/关系 | 规则 |
| --- | --- |
| `payload.candidate.candidateId` | 必须存在，作为分析侧候选人事实 ID |
| `payload.candidate.stableId` + `stableIdSource` | 至少应同时存在；若来源为 `text_fingerprint`，标记低置信 |
| `payload.candidate.exposureKey` | 必须存在，用于 card -> detail/greeting 关联 |
| `payload.candidate.profile.displayName` | 应存在；缺失会影响人工核对和低置信去重 |
| `payload.listUrl` + `payload.listPageType` | 应存在，用于列表来源和筛选链路 |
| `context.sessionId` + `operator_id` | 必须存在，用于同会话曝光去重 |

覆盖率检查：

| 字段 | 用途 |
| --- | --- |
| `payload.candidate.detailUrl` | 详情链路回连辅助 |
| `payload.exposure.cardIndex` | 曝光位置分析 |
| `payload.candidate.profile.age`、`experience`、`education` | 候选人快照完整性 |
| `payload.candidate.profile.expectedLocation`、`expectedPosition`、`activeStatus`、`jobSeekingStatus` | 后续筛选和候选人分布分析 |
| `context.jobContext.jobId` 或根部 `job_id` | 岗位维度分析 |

输出示例指标：

- `card_required_field_missing_count`
- `card_profile_core_missing_count`
- `card_identity_low_confidence_count`
- `card_job_context_missing_count`

#### Detail 日志

适用事件：

- `candidate_detail.opened`
- `candidate_detail.closed`

`candidate_detail.opened` 硬性检查：

| 字段/关系 | 规则 |
| --- | --- |
| `payload.detailUrl` 或 `payload.detectedBy` | 至少应有一个详情识别线索 |
| `payload.candidate.candidateId` | 应存在；缺失时尝试用 stableId 低置信定位 |
| `payload.candidate.stableId` + `stableIdSource` | 应存在，用于跨 card 回连 |
| `payload.candidate.profile.displayName` | 应存在，用于人工核对和冲突检测 |
| `payload.candidate.exposureKey` 或 `exposedEventId` | 优先存在，用于确认能找到 card 曝光 |

详情到 card 关联检查：

1. 如果有 `exposedEventId`，检查能在同一操作员 raw/fact 中找到对应 `candidate_list.card_exposed`。
2. 如果没有 `exposedEventId` 但有 `exposureKey`，检查同一 `operator_id + exposureKey` 是否存在 card 曝光。
3. 如果只有 `stableId + stableIdSource`，在同一 `operator_id + session_id` 的近 30 分钟窗口内保守匹配 card。
4. 仍找不到时记为 `detail_card_link_missing`，默认 `warning`。如果 `detectedBy` 表明是直接详情页或非列表入口，可以降级为覆盖率问题。

覆盖率检查：

| 字段 | 用途 |
| --- | --- |
| `payload.analysis.module` | 牛人分析模块可见性覆盖 |
| `payload.candidate.detailProfile.sectionKeys` | 详情摘要覆盖 |
| `payload.candidate.detailProfile.sections.jobExpectation` | 求职期望摘要 |
| `payload.candidate.detailProfile.sections.advantage` | 优势摘要 |
| `payload.candidate.detailProfile.sections.workExperience`、`educationExperience` | 履历摘要覆盖 |

`candidate_detail.closed` 检查：

| 字段/关系 | 规则 |
| --- | --- |
| `payload.openedEventId` | 应能找到对应 opened 事件 |
| `payload.durationMs` | 应为非负数，异常值计入质量问题 |
| `payload.reason` | 应存在，便于判断关闭原因 |

#### Greeting 日志

适用事件：

- `candidate_greeting.clicked`
- `candidate_greeting.succeeded`
- `candidate_greeting.failed`

`candidate_greeting.clicked` 硬性检查：

| 字段/关系 | 规则 |
| --- | --- |
| `payload.entry` | 应存在，取值为 `candidate_list`、`candidate_detail`、`chat` 或 `unknown` |
| `payload.candidate.candidateId` 或 `stableId + stableIdSource` | 至少应有一组候选人身份 |
| `payload.candidate.exposureKey` 或 `exposedEventId` | 从列表或详情入口打招呼时应尽量存在 |
| `context.sessionId` + `operator_id` | 必须存在，用于点击结果关联 |

打招呼到前序事件关联检查：

- `entry = candidate_list` 时，优先关联 card 曝光。
- `entry = candidate_detail` 时，优先关联 detail opened，再检查 detail 是否能回连 card。
- `entry = chat` 时，优先关联 chat opened；不强制要求 card。
- 找不到应有关联时记录 `greeting_source_link_missing`。

`candidate_greeting.succeeded` / `candidate_greeting.failed` 检查：

| 字段/关系 | 规则 |
| --- | --- |
| `payload.clickedEventId` | 必须能找到对应 `candidate_greeting.clicked` |
| `payload.elapsedMs` | 应为非负数，过大或缺失计入质量问题 |
| `payload.greeting.status` | 必须与事件类型一致 |
| `payload.greeting.detectedBy` | 应存在，便于排查误判 |
| `payload.candidate` | 应与 clicked 事件候选人身份一致或可解释为空 |

结果事件找不到点击事件时记录 `greeting_result_click_link_missing`，默认 `warning`；如果比例持续升高，升级为 `critical`，因为会破坏打招呼漏斗。

#### Chat 日志

适用事件：

- `candidate_chat.opened`
- `candidate_chat.snapshot_captured`
- `candidate_chat.wechat_captured`
- `candidate_chat.capture_failed`

候选人信息检查：

| 字段/关系 | 规则 |
| --- | --- |
| `payload.candidate.candidateId` 或 `stableId + stableIdSource` | 至少应有一组候选人身份 |
| `payload.candidate.identityConfidence` | 缺失时按 `unknown` 记录；`low` 单独统计 |
| `payload.candidate.profile.displayName` | 应存在，缺失计入候选人信息覆盖率问题 |
| `payload.chat.conversationKey` | `candidate_chat.opened` 应存在，用于会话归并 |
| `payload.chatPageUrl` 或根部 `context.pageUrl` | 应存在，用于确认聊天页来源 |

消息信息检查只适用于 `candidate_chat.snapshot_captured`：

| 字段/关系 | 规则 |
| --- | --- |
| `payload.chat.messageCount` | 应存在且等于可见消息数组数量，允许页面只给计数但需标记 |
| `payload.chat.messages` | 有消息时应为数组；空数组不等于失败，但要记录覆盖率 |
| `messages[].messageIndex` | 应为非负数且在快照内稳定 |
| `messages[].messageAt` | 可解析时用于回复时长；缺失或不可解析计入消息时间质量问题 |
| `messages[].direction` | 应为 `candidate`、`recruiter` 或兼容枚举 |
| `messages[].fingerprint` | 应存在，用于去重和水位判断 |
| `payload.chat.lastMessageFingerprint` | 有消息时应存在，用于快照去重 |
| `payload.chat.snapshotCompleteness` | 应存在；当前预期为 `visible_dom` |
| `payload.chat.mayBeIncomplete` | 应存在；缺失时前端不能正确提示完整性 |

`candidate_chat.wechat_captured` 检查：

- `payload.wechat.detectedAtMessageFingerprint` 应能在最近一次 snapshot 的消息指纹中找到；找不到时记录 `wechat_message_link_missing`。
- `payload.wechat.accounts` 只能用于受权限控制的敏感链路，健康检查只保存账号数量，不保存账号原文。

`candidate_chat.capture_failed` 检查：

- 必须有 `payload.chatPageUrl` 或 `context.pageUrl`。
- 应有失败来源或错误阶段字段；如果日志契约当前没有稳定字段，先作为覆盖率待完善项。

聊天质量输出示例：

- `chat_candidate_identity_missing_count`
- `chat_candidate_low_confidence_count`
- `chat_message_array_missing_count`
- `chat_message_time_missing_count`
- `chat_message_direction_invalid_count`
- `chat_message_fingerprint_missing_count`
- `chat_snapshot_completeness_missing_count`

#### 按插件版本查看

所有单日志质量指标必须按 `plugin_version` 分组，至少支持：

- 当前版本与上一版本的字段缺失率对比。
- 某版本内不同事件类型的质量问题排行。
- 某版本的低置信候选人身份占比。
- 某版本的 card -> detail、detail -> greeting、clicked -> result、chat snapshot -> wechat 关联失败率。
- 某版本未知事件类型或新增字段覆盖情况。

当某个版本样本数小于阈值时，状态返回 `unknown`，但仍展示原始计数。

## 规则分层

规则统一输出：

```text
status = ok | warning | critical | unknown
scope = global | operator | event_type | event_family | plugin_version | summary_task | process
```

建议第一版规则：

| 规则 ID | 状态条件 | 默认等级 |
| --- | --- | --- |
| `raw.no_recent_events` | 监控时段内全局最近事件超过 15 分钟 | `critical` |
| `raw.low_volume_vs_baseline` | 当前 15 分钟事件数低于基线 p10 的 50%，且基线样本充足 | `warning` |
| `raw.high_volume_vs_baseline` | 当前 15 分钟事件数高于基线 p90 的 3 倍 | `warning` |
| `raw.missing_operator` | 近 15 分钟缺 operator 比例超过 1% | `critical` |
| `raw.parse_error_rate` | 近 15 分钟解析失败率超过 1% 警告，超过 5% 严重 | `warning` / `critical` |
| `raw.unknown_event_type` | 新增未知事件类型超过 0 且持续 5 分钟 | `warning` |
| `raw.duplicate_event_id` | 重复事件 ID 比例超过 1% | `warning` |
| `raw.clock_skew` | 事件时间未来超过 2 分钟或迟到超过 1 小时比例异常 | `warning` |
| `event.card_required_fields` | card 关键字段缺失率超过阈值，按插件版本分组 | `warning` / `critical` |
| `event.detail_card_link_missing` | detail 无法回连 card 曝光比例超过阈值 | `warning` |
| `event.greeting_source_link_missing` | greeting clicked 无法回连 card/detail/chat 来源比例超过阈值 | `warning` |
| `event.greeting_result_click_link_missing` | greeting result 找不到 clicked 比例超过阈值 | `warning` / `critical` |
| `event.chat_candidate_info_missing` | chat 候选人身份或 conversation key 缺失率超过阈值 | `warning` |
| `event.chat_message_quality` | snapshot 消息数组、方向、时间或 fingerprint 缺失率超过阈值 | `warning` |
| `event.version_quality_regression` | 当前插件版本单日志质量比上一稳定版本明显下降 | `warning` |
| `summary.minute_lag` | 核心分钟汇总最新 minute 落后超过 10 分钟警告，30 分钟严重 | `warning` / `critical` |
| `summary.missing_operator` | 汇总中 `<missing>` operator 行数大于 0 | `critical` |
| `summary.raw_delta` | 已入库 raw/fact 与 summary 在封闭窗口差异超过 5% | `warning` |
| `daily.snapshot_lag` | 日级快照超过 15 分钟未更新 | `warning` |
| `daily.active_minutes_invalid` | 活跃分钟小于 0 或大于 1440 | `critical` |
| `sequence.detail_close_without_open` | 近 1 小时异常率超过配置阈值 | `warning` |
| `sequence.greeting_result_without_click` | 近 1 小时异常率超过配置阈值 | `warning` |
| `process.consumer_heartbeat_missing` | consumer 心跳超过 2 个周期未更新 | `critical` |
| `process.probe_worker_failed` | probe worker 连续失败 | `critical` |

默认阈值只作为启动值，必须可配置。上线后应先以观察模式运行 1 到 2 周，再把基线类规则升级为告警规则。

## 基线设计

数量健康不能只用固定阈值，否则工作日、周末、午休和招聘节奏变化都会误报。

基线维度：

- `scope_type`: `global`、`operator`、`event_family`、`operator_event_family`
- `weekday`
- `hour`
- `minute_bucket_group`: 可选，例如每 5 分钟一组
- `plugin_version`: 可选，用于版本灰度期排查

基线字段：

- `sample_count`
- `median_count`
- `p10_count`
- `p90_count`
- `mean_count`
- `stddev_count`
- `zero_window_rate`
- `calculated_at`

基线只用于判断日志量异常，不用于绩效排名。样本不足时规则返回 `unknown`，并给出“基线不足”的原因。

## 数据模型

### `log_health_metric_windows`

保存已经同步或计算出的健康窗口指标。数量类可以继续使用分钟窗口；日志质量第一版使用 10 分钟窗口。

建议字段：

- `metric_name`
- `window_start`
- `window_minutes`
- `scope_type`
- `scope_key`
- `operator_id`
- `event_type`
- `event_family`
- `page_type`
- `plugin_version`
- `raw_event_count`
- `distinct_event_id_count`
- `missing_event_id_count`
- `missing_operator_count`
- `missing_session_count`
- `parse_error_count`
- `projection_error_count`
- `unknown_event_type_count`
- `duplicate_event_id_count`
- `plugin_exception_count`
- `chat_capture_failed_count`
- `summary_record_count`
- `latest_occurred_at`
- `source_row_count`
- `calculated_at`

幂等键：

```text
metric_name + window_start + window_minutes + scope_type + scope_key
```

### `log_event_quality_findings`

保存单条日志级质量检查发现。该表只保存结构化诊断，不保存敏感正文。

建议字段：

- `id`
- `event_id`
- `event_type`
- `plugin_version`
- `operator_id`
- `job_id`
- `page_type`
- `occurred_at`
- `quality_rule_id`
- `severity`
- `field_path`
- `finding_kind`: `missing_required_field` / `missing_expected_field` / `invalid_value` / `low_confidence_identity` / `link_missing` / `message_quality` / `sensitive_leak_signal`
- `link_target_event_type`
- `link_target_event_id`
- `candidate_identity_confidence`
- `message_index`
- `evidence_json`
- `created_at`

幂等键：

```text
event_id + quality_rule_id + field_path + finding_kind
```

`evidence_json` 可以保存：

- 字段路径。
- 枚举值是否有效。
- 是否存在候选人 ID。
- 关联目标类型和关联方式。
- 消息数量、缺失消息索引、缺失字段名。
- 插件版本、页面类型和事件类型。

`evidence_json` 不能保存：

- 聊天正文。
- 微信号、手机号、邮箱或其他联系方式原文。
- 完整简历正文或完整候选人详情文本。

### `log_event_quality_rollups`

保存单日志质量按窗口和维度的聚合结果，供 API 快速查询。

建议字段：

- `minute`
- `window_minutes`
- `plugin_version`
- `event_type`
- `operator_id`
- `quality_rule_id`
- `checked_event_count`
- `finding_count`
- `affected_event_count`
- `finding_rate`
- `severity`
- `sample_event_ids`
- `calculated_at`

幂等键：

```text
minute + window_minutes + plugin_version + event_type + operator_id + quality_rule_id
```

`sample_event_ids` 最多保存少量事件 ID，用于排查入口，不保存 payload。

### `log_health_rule_results`

保存每次探测运行的规则结果。

建议字段：

- `id`
- `run_id`
- `rule_id`
- `status`
- `severity`
- `scope_type`
- `scope_key`
- `plugin_version`
- `event_type`
- `operator_id`
- `window_start`
- `window_end`
- `observed_value`
- `expected_value`
- `threshold`
- `evidence_json`
- `reason`
- `calculated_at`

`evidence_json` 只能保存计数、时间范围、字段名、事件类型、汇总任务名和少量事件 ID，不保存敏感正文。

### `log_health_incidents`

保存持续异常的生命周期，避免每分钟生成一条新告警。

建议字段：

- `incident_key`: `rule_id + scope_type + scope_key`
- `status`: `open` / `recovering` / `closed`
- `severity`
- `first_seen_at`
- `last_seen_at`
- `recovered_at`
- `open_run_id`
- `last_run_id`
- `summary`
- `latest_evidence_json`

打开条件：

- `warning` 连续 2 个探测周期。
- `critical` 连续 1 个探测周期。

关闭条件：

- 连续 3 个探测周期恢复为 `ok`。

## 探测流程

```text
health metric source
  -> collect window metrics
  -> evaluate single-event quality rules
  -> normalize scopes
  -> load baselines and thresholds
  -> evaluate quantity rules
  -> evaluate quality rules
  -> persist rule results
  -> update incidents
  -> expose API and UI
```

推荐进程：

- `log-health-probe-worker`: 每 1 分钟运行一次，评估最近 5、15、60 分钟窗口。
- `baseline-worker`: 每天低峰期重算基线。
- `api-server`: 只读健康结果，不在请求链路里做重计算。

第一版可以先把 probe 集成在 API 启动时的内存结果中，但生产阶段应独立 worker 化，避免前端查询触发重计算。

## 当前第一版代码接入

已实现的最小闭环：

- `summary_reader` 可解析 `boss_10min_log_quality`，并支持从 JSON/JSONL 文件读取。
- 本地开发 `summary` 模式可通过 `BOSS_ANALYSIS_LOG_QUALITY_DATA_FILE` 读取质量汇总文件，或通过 `CLS_LOG_QUALITY_TOPIC_ID` 读取健康目标 topic 做开发排障。
- `APP_ENV=production` 下仍禁用 SearchLog；当前 `CLS_LOG_QUALITY_TOPIC_ID` 路径只用于本地开发读取定时 SQL 的目标 topic，不作为生产权威同步实现。
- `AnalysisQueryService.health()` 会把 10 分钟质量汇总聚合进 `HealthSummary`，输出整体质量状态、检查事件数、问题数、问题密度、最新窗口、按插件版本汇总和按事件类型问题排行。
- 当前前端提供独立“数据质量”tab，通过 `operator_id` 和 `plugin_version` 查询 10 分钟质量汇总，展示质量状态、问题数、检查事件数、最新窗口、插件版本质量和事件类型问题排行。
- 本地 dev server 已提供 `GET /api/log-quality?operator_id=...&plugin_version=...`，返回过滤后的质量汇总；生产阶段拆分稳定健康 API 时可迁移到 `/api/health/logs/event-quality`。

当前尚未实现：

- 独立 `log-health-probe-worker`、持久化表、异常生命周期和告警出口。
- 基于 raw/fact 的跨事件精确回连，例如真正确认 detail/greeting 是否能找到 card 曝光。
- 独立 `/api/health/logs/*` 路由；第一版先通过 `/api/dashboard.health` 暴露全局质量总览，并通过 `/api/log-quality` 支持本地数据质量 tab 查询。

## API 设计

第一版实现先复用 `GET /api/dashboard` 中的 `health` 字段，后续再拆成以下稳定健康 API。

### `GET /api/health/logs/overview`

返回当前整体健康。

响应字段：

- `status`
- `generated_at`
- `window_start`
- `window_end`
- `raw_event_count`
- `active_operator_count`
- `latest_event_at`
- `latest_summary_minute`
- `open_incident_count`
- `critical_incident_count`
- `top_rules`

### `GET /api/health/logs/rules`

按规则返回当前状态。

查询参数：

- `status`
- `severity`
- `scope_type`
- `scope_key`
- `window_minutes`

### `GET /api/health/logs/event-quality`

返回单日志级质量检查聚合结果。

查询参数：

- `plugin_version`
- `event_type`
- `operator_id`
- `quality_rule_id`
- `severity`
- `window_minutes`

响应字段：

- `checked_event_count`
- `finding_count`
- `affected_event_count`
- `finding_rate`
- `top_findings`
- `sample_event_ids`

### `GET /api/health/logs/plugin-versions`

返回按插件版本分组的日志质量概览。

响应字段：

- `plugin_version`
- `first_seen_at`
- `last_seen_at`
- `raw_event_count`
- `checked_event_count`
- `required_field_missing_rate`
- `candidate_identity_missing_rate`
- `candidate_identity_low_confidence_rate`
- `link_missing_rate`
- `chat_message_quality_issue_rate`
- `unknown_event_type_count`
- `status`

### `GET /api/health/logs/timeline`

返回健康趋势，用于前端画时间线。

字段：

- `minute`
- `status`
- `raw_event_count`
- `parse_error_count`
- `missing_operator_count`
- `summary_record_count`
- `latest_event_lag_seconds`

### `GET /api/health/logs/operators/{operator_id}`

返回某个操作员维度的日志数量和质量健康。该接口只能说明该操作员相关日志流的完整性，不能输出绩效结论。

### `GET /api/health/logs/incidents`

返回打开和最近关闭的异常事件。

## 前端展示

数据质量页建议分成四块：

- 总览：全局状态、最近事件时间、最新汇总分钟、打开异常数量。
- 数量：事件量趋势、事件族覆盖、操作员活跃日志流、基线对比。
- 质量：解析错误、未知事件、缺 operator、重复 ID、单日志关键字段、候选人身份、链路关联和消息结构异常。
- 插件版本：按 `plugin_version` 对比 card/detail/greeting/chat 的字段完整率、候选人身份置信度和链路关联失败率。
- 链路：consumer、summary-sync、probe-worker、日级快照的心跳和延迟。

展示原则：

- 所有异常都展示“证据”，例如窗口、阈值、实际值、影响范围。
- 对操作员维度只写“该操作员日志流异常/缺失”，不写“该操作员未工作”。
- 对基线不足显示 `unknown`，不要显示绿色正常。
- 对 summary 缺 operator 或 Search 禁用这类硬约束，用醒目的严重状态提示。
- 对单日志质量问题只展示字段路径、事件类型、插件版本和事件 ID，不展示聊天正文、联系方式或完整简历文本。

## 与现有模块关系

- 输入消费与标准化：提供 raw event、parse error 和 received/occurred 时间。
- 存储与重放：提供 raw_events、错误表、重复 ID 和重放状态。
- 事实投影：提供投影错误和序列异常。
- 聚合、查询与 API：提供分钟汇总、日级汇总和查询接口。
- 运行、安全与运维：提供进程心跳、配置、审计和告警出口。

本模块可以读取上述结果，但不改变它们的业务口径。

## 实施顺序

1. 定义 `LogHealthMetricWindow`、`LogHealthRuleResult`、`LogHealthIncident` 领域模型。
2. 扩展当前 `HealthSummary`，先把已有 raw/summary 计数字段映射成健康总览。（第一版已覆盖 raw/summary/daily/10 分钟质量汇总）
3. 定义单日志质量规则注册表，第一批覆盖 card、detail、greeting、chat 和通用字段。
4. 基于已入库 raw_events 和 summary records 实现内存版规则评估，覆盖 `missing_operator`、`parse_error_rate`、`summary_lag`、`daily_snapshot_lag` 和单日志关键字段缺失。
5. 增加持久化表和 `log-health-probe-worker`，让 API 只读最新结果。
6. 新增 `boss_10min_log_quality` 汇总同步，补齐 CLS 层 10 分钟日志质量指标。（第一版已支持本地文件和开发读取目标 topic；生产同步待 worker 化）
7. 实现按 `plugin_version` 的质量 rollup 和版本对比 API。（第一版已在 `/api/dashboard.health` 输出插件版本 rollup）
8. 实现基线 worker 和基线类规则，先观察不告警。
9. 接入前端数据质量页和告警通知。

## 测试要求

必须覆盖：

- 空数据时返回 `unknown`，而不是假装正常。
- 全局最近事件超时触发数量异常。
- 解析失败率和缺 operator 比例超过阈值。
- `<missing>` operator 不能归并到真实操作员。
- summary 最新分钟延迟触发 `summary.minute_lag`。
- 日级活跃分钟超过 1440 触发严重异常。
- raw/fact 与 summary 在封闭窗口内差异超过阈值。
- card 缺 `candidateId`、`stableIdSource`、`exposureKey` 或核心 profile 时生成单日志质量 finding。
- detail opened 缺候选人身份或无法通过 `exposedEventId` / `exposureKey` / 稳定身份回连 card 时生成 finding。
- detail closed 的 `openedEventId` 找不到 opened 事件时生成 finding。
- greeting clicked 缺候选人身份或无法按入口回连 card/detail/chat 时生成 finding。
- greeting succeeded/failed 的 `clickedEventId` 找不到 clicked 事件时生成 finding。
- chat opened 缺候选人身份、低置信身份或缺 `conversationKey` 时生成 finding。
- chat snapshot 的 message 数量、方向、时间、fingerprint 或 completeness 字段异常时生成 finding。
- wechat captured 只保存账号数量和消息 fingerprint 关联状态，不保存账号原文。
- 质量聚合能按 `plugin_version`、`event_type` 和 `quality_rule_id` 分组。
- 基线样本不足时返回 `unknown`。
- 敏感泄露规则不保存命中的原始敏感文本。
- incident 连续触发、恢复和关闭的状态机。

测试使用离线样本和本地 repository fake，不依赖真实 CLS、Chrome 或 BOSS 页面。
