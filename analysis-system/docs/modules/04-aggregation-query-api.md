# 聚合、查询与 API

## 职责

本模块基于 CLS 汇总结果和本地事实表生成查询结果、报表导出和少量补充指标。生产分钟级统计优先读取 CLS 定时 SQL 产物；本模块不直接消费 CLS 原始日志，也不绕过事实表读取插件内部状态。

代码归属：

- `src/boss_analysis/workers/`
- `src/boss_analysis/api/`
- `src/boss_analysis/storage/`
- `tests/` 中的 aggregate 和 API 测试

## 聚合边界

分钟级统计的主实现放在 CLS 平台侧。

原因：

- 分钟级趋势、漏斗、回复率和微信获取率需要接近原始日志源做持续预聚合。
- 长周期查询不适合在本地 API 或后台任务中反复扫描原始事件。
- CLS 定时 SQL 支持分钟级调度和分钟级时间窗口，结果可以写入目标日志主题或指标主题。

本模块负责：

- 读取 CLS 分钟级汇总日志主题或指标主题。
- 必要时把汇总结果同步到 PostgreSQL 缓存，服务权限过滤、跨维度组合和低延迟查询。
- 对 CLS 汇总结果做日级、小时级或页面查询范围内的二次 rollup。
- 对口径尚未稳定或 CLS SQL 暂不适合表达的探索性指标做小范围补充。

本模块不负责：

- 在本地长期重复扫描 `raw_events` 重建分钟级指标数仓。
- 在 API 请求链路中直接扫描大量原始日志做趋势和漏斗统计。
- 把本地开发样本聚合结果当作生产权威口径。

## 推荐 CLS 分钟汇总粒度

第一版建议由 CLS 定时 SQL 生成以下分钟粒度或可 rollup 的汇总：

- 分钟时间桶
- 操作员 `operator_id`
- BOSS 账号匹配状态
- 职位 `job_id`
- 页面类型 `page_type`
- 候选人分析键
- 事件类型 `event_type`

常见指标：

- 活跃操作员数、最后活跃事件时间。
- 页面会话数、停留时长。
- 候选人卡片曝光数。
- 详情打开数和详情停留时长。
- 打招呼点击、成功、失败数量。
- 聊天打开、快照采集、微信采集和补采失败数量。
- 候选人回复、招聘方回复、首响时长和跟进时长的分布桶。
- 解析失败、未知事件类型、迟到事件数量。

## 第一批已接入汇总

用户已先在 CLS 配置两个核心定时 SQL 任务，均写入 `boss_summary_minute_prod`：

| 任务 | 关键字段 | 本地用途 |
| --- | --- | --- |
| `boss_minute_operator_funnel` | `minute`、`operator_id`、`job_id`、`card_exposed`、`detail_opened`、`greeting_clicked`、`greeting_succeeded`、`greeting_failed`、`chat_opened`、`chat_snapshot_captured`、`wechat_captured`、`total_events` | 操作员单人漏斗、大盘最近活动、岗位初步拆分 |
| `boss_minute_chat` | `minute`、`operator_id`、`job_id`、`chat_opened`、`snapshot_captured`、`report_required`、`capture_failed`、`wechat_captured`、`chat_events` | 聊天打开、聊天快照、待补采、失败、微信成功 |

本地读取约定：

- 开发环境通过 `CLS_SUMMARY_TOPIC_ID` 指向 `boss_summary_minute_prod`；也可用 `BOSS_ANALYSIS_SUMMARY_DATA_FILE` 读取离线汇总样本。
- API 的单人漏斗和聊天指标优先使用分钟汇总；某个操作员没有汇总时，回退到当前 raw event/fact 结果。
- 同时存在 `boss_minute_operator_funnel` 和 `boss_minute_chat` 时，漏斗使用前者，聊天明细使用后者，避免重复累计聊天字段。
- 分钟任务使用重叠查询窗口时，目标 topic 会追加写入同一 `metric_name + minute + operator_id + job_id` 的多条快照；查询侧必须先按该稳定键取最新一条，再做单人漏斗和分钟趋势 rollup，避免 7 个打招呼显示成 14。
- `operator_id = '<missing>'` 或空值必须保留为数据健康异常，不归并到真实操作员。
- 源主题 `boss` 中 `operator_id` 应按 `text` 类型开启 SQL 分析；如果误建为 `long`，即使原始日志里有字符串值，定时 SQL 也会产出 missing。

## 查询 API

API 应围绕事实和聚合提供最小稳定接口：

- 健康检查和版本信息。
- 原始事件查询，默认隐藏敏感正文。
- 候选人链路查询。
- 操作员和岗位日报。
- 操作员列表，第一版可合并本地 `config/operators.local.json` 的展示元数据和 CLS/事实流中的活跃状态。
- 分钟趋势、漏斗指标和历史报表查询，优先基于 CLS 汇总结果。
- 解析错误和消费健康查询。
- 报表导出任务创建与查询。

API 不应暴露：

- 数据库连接串。
- 云 Secret。
- 插件内部 debug/profile 结构。
- 未经授权的聊天正文、联系方式或完整简历正文。

## 汇总读取与刷新策略

第一版采用 CLS 定时 SQL 作为生产刷新机制，本地按需读取或同步：

- 近实时窗口：CLS 以分钟级调度输出汇总，API 展示汇总数据新鲜度和任务延迟。
- 历史修正窗口：通过 CLS 定时 SQL 的时间窗口和延迟执行配置覆盖迟到索引；必要时补跑指定时间范围任务。
- 本地缓存：`summary-sync-worker` 只同步汇总结果，不重新计算原始日志分钟指标。
- 手动重算：优先触发或补建 CLS 定时 SQL 任务；本地重放用于 parser 修复和明细校验。

所有汇总写入或同步必须幂等，可以通过 `metric_name + minute_bucket + dimensions` 覆盖同一窗口结果。直接从 CLS 追加型目标 topic 读取时，如果尚未同步到可 upsert 的缓存表，查询层需要用同一稳定键折叠重复快照；有 `recorded_at` 或 CLS 写入时间时取最新，否则取信号计数更完整的一条。

## 当日活跃时长

`daily_active_duration` 用于回答“某个操作员今天实际有多少分钟产生过招聘操作事实”。它是事实活动时长，不表示 BOSS 官方在线时长，也不直接作为绩效结论。

### 输入来源

只使用分钟级汇总结果，不回查原始日志：

- `boss_minute_operator_funnel`
- `boss_minute_chat`
- 后续新增的分钟级事实汇总也可接入，但必须先定义是否代表操作员活跃。

生产环境应从已同步入库的分钟汇总表、CLS 定时 SQL 下游同步结果或其他已批准的非 Search 生产链路读取。开发验证可以从 `boss_summary_minute_prod` 抽样，但不得把 SearchLog 作为正式链路。

### 口径定义

时间边界：

- 统计日按 `Asia/Shanghai` 自然日切分。
- `active_date = date(minute at time zone Asia/Shanghai)`。
- `minute` 必须先归一到分钟桶，秒和毫秒不参与分组。

有效活跃分钟：

- `operator_id` 为空、`<missing>`、`missing`、`null`、`none` 等缺失值不计入操作员活跃时长，只计入数据健康异常。
- 对同一 `operator_id + active_date + minute`，只要任一已批准分钟汇总行满足 `active_signal > 0`，该分钟计为 1 个活跃分钟。
- 同一分钟内多个 metric、多个 job、多个 candidate 或多个事件类型只计 1 分钟，避免 `boss_minute_operator_funnel` 和 `boss_minute_chat` 重复累计。

`active_signal` 第一版定义：

```text
active_signal =
  card_exposed
  + detail_opened
  + greeting_clicked
  + greeting_succeeded
  + greeting_failed
  + chat_opened
  + chat_snapshot_captured
  + snapshot_captured
  + report_required
  + capture_failed
  + wechat_captured
  + total_events
  + chat_events
```

只要上述任一字段大于 0，即认为该分钟有操作员活动。后续如果新增 `page_dwell` 类分钟汇总，需单独决定是否并入，避免纯页面停留把“操作动作活跃”放大。

输出字段：

| 字段 | 含义 |
| --- | --- |
| `metric_name` | 固定为 `boss_daily_operator_active_duration` |
| `active_date` | `Asia/Shanghai` 自然日 |
| `operator_id` | 操作员 ID |
| `active_minutes` | 当日去重活跃分钟数 |
| `active_seconds` | `active_minutes * 60`，用于前端格式化 |
| `first_active_minute` | 当日第一分钟活跃时间 |
| `last_active_minute` | 当日最后一分钟活跃时间 |
| `source_minute_count` | 参与计算的去重分钟数，正常等于 `active_minutes` |
| `source_row_count` | 参与计算的原始 summary 行数，用于排查重复汇总 |

### 生产逻辑

第一阶段推荐在 analysis-system 的 summary 同步或查询层 rollup；正式数据量增长后，可把该逻辑做成独立日级汇总任务写入日级指标表。

### 腾讯 CLS 定时 SQL

CLS 侧可先生成日级快照，供 analysis-system 后续同步或直接读取。推荐配置：

- 任务名：`boss_daily_operator_active_duration`
- 源日志主题：`boss_summary_minute_prod`
- 目标日志主题：优先新建 `boss_summary_daily_prod`；如果临时写回 `boss_summary_minute_prod`，后续读取必须按 `metric_name` 区分。
- 调度周期：`5` 分钟。
- 查询时间窗口：`@d,@m-1m`。每次运行重新扫描当天截至上一分钟的全部分钟汇总，输出“今天到当前为止”的累计快照。
- 输出时间戳：使用 CLS 默认时间戳即可。

可直接贴入 CLS 定时 SQL 的执行语句如下，不需要末尾分号：

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
  where minute is not null
    and operator_id is not null
    and lower(cast(operator_id as varchar)) not in ('', '<missing>', 'missing', '__missing__', 'null', 'none')
  group by active_date, operator_id, minute_bucket
)
where active_signal > 0
  and active_date = current_date
group by active_date, operator_id
limit 10000
```

字段索引要求：

- 源主题需要给 `minute`、`operator_id` 开启键值索引和统计分析。
- 参与 `active_signal` 的计数字段应按 `long` 或可参与数值统计的类型配置。
- `source_row_count` 不是源分钟汇总主题里的输入字段，而是本 SQL 在内层用 `count(*) as source_row_count` 临时生成的排查字段；不要在内层写 `sum(source_row_count)`。
- 目标主题建议索引 `metric_name`、`active_date`、`operator_id`，以及 `active_minutes`、`active_seconds`、`source_minute_count`、`source_row_count`。

CLS 定时 SQL 是追加写，不做 upsert。analysis-system 消费该目标主题时，应按 `metric_name + active_date + operator_id` 取最新一条快照作为当前值。

本地接入配置：

- `CLS_DAILY_SUMMARY_TOPIC_ID`: `boss_daily_operator_active_duration` 输出主题 ID，通常指向 `boss_summary_daily_prod`。
- `CLS_DAILY_SUMMARY_QUERY`: 默认 `*`。本地解析器会按 `metric_name` 或 `active_minutes` 等日级字段过滤，避免目标 topic 未索引 `metric_name` 时读取失败。
- `CLS_DAILY_SUMMARY_WINDOW_MINUTES`: 默认 `today`，按 `APP_TIMEZONE` 从当天 00:00 读取到当前时间，用于读取当天最近快照；调试时可显式填写数字分钟窗口。
- `BOSS_ANALYSIS_DAILY_SUMMARY_DATA_FILE`: 离线文件调试入口，优先于真实 CLS topic。

### PostgreSQL 落库 SQL

以下 SQL 假设分钟汇总已经同步到 PostgreSQL 表 `minute_summary_records`。该表不是 raw event 表，只保存分钟级 summary 结果。

目标表：

```sql
create table if not exists daily_operator_active_duration (
  metric_name text not null,
  active_date date not null,
  operator_id text not null,
  active_minutes integer not null,
  active_seconds integer not null,
  first_active_minute timestamptz,
  last_active_minute timestamptz,
  source_minute_count integer not null,
  source_row_count integer not null,
  calculated_at timestamptz not null default now(),
  primary key (metric_name, active_date, operator_id)
);
```

按单日覆盖写入：

参数：

- `:target_date`: 目标自然日，格式如 `2026-05-18`，按 `Asia/Shanghai` 解释。

```sql
with params as (
  select
    cast(:target_date as date) as active_date,
    cast(:target_date as timestamp) at time zone 'Asia/Shanghai' as day_start,
    (cast(:target_date as timestamp) + interval '1 day') at time zone 'Asia/Shanghai' as day_end
),
valid_minute_activity as (
  select
    p.active_date,
    m.operator_id,
    date_trunc('minute', m.minute) as minute_bucket,
    count(*) as source_row_count,
    sum(
      coalesce(m.card_exposed, 0)
      + coalesce(m.detail_opened, 0)
      + coalesce(m.greeting_clicked, 0)
      + coalesce(m.greeting_succeeded, 0)
      + coalesce(m.greeting_failed, 0)
      + coalesce(m.chat_opened, 0)
      + coalesce(m.chat_snapshot_captured, 0)
      + coalesce(m.snapshot_captured, 0)
      + coalesce(m.report_required, 0)
      + coalesce(m.capture_failed, 0)
      + coalesce(m.wechat_captured, 0)
      + coalesce(m.total_events, 0)
      + coalesce(m.chat_events, 0)
    ) as active_signal
  from minute_summary_records m
  join params p on true
  where m.metric_name in ('boss_minute_operator_funnel', 'boss_minute_chat')
    and m.operator_id is not null
    and lower(m.operator_id) not in ('', '<missing>', 'missing', '__missing__', 'null', 'none')
    and m.minute >= p.day_start
    and m.minute < p.day_end
  group by p.active_date, m.operator_id, date_trunc('minute', m.minute)
),
active_minutes as (
  select
    active_date,
    operator_id,
    minute_bucket,
    source_row_count
  from valid_minute_activity
  where active_signal > 0
),
daily_rollup as (
  select
    'boss_daily_operator_active_duration' as metric_name,
    active_date,
    operator_id,
    count(*)::integer as active_minutes,
    (count(*) * 60)::integer as active_seconds,
    min(minute_bucket) as first_active_minute,
    max(minute_bucket) as last_active_minute,
    count(*)::integer as source_minute_count,
    sum(source_row_count)::integer as source_row_count,
    now() as calculated_at
  from active_minutes
  group by active_date, operator_id
)
insert into daily_operator_active_duration (
  metric_name,
  active_date,
  operator_id,
  active_minutes,
  active_seconds,
  first_active_minute,
  last_active_minute,
  source_minute_count,
  source_row_count,
  calculated_at
)
select
  metric_name,
  active_date,
  operator_id,
  active_minutes,
  active_seconds,
  first_active_minute,
  last_active_minute,
  source_minute_count,
  source_row_count,
  calculated_at
from daily_rollup
on conflict (metric_name, active_date, operator_id)
do update set
  active_minutes = excluded.active_minutes,
  active_seconds = excluded.active_seconds,
  first_active_minute = excluded.first_active_minute,
  last_active_minute = excluded.last_active_minute,
  source_minute_count = excluded.source_minute_count,
  source_row_count = excluded.source_row_count,
  calculated_at = excluded.calculated_at;
```

查询某天结果：

```sql
select
  'boss_daily_operator_active_duration' as metric_name,
  active_date,
  operator_id,
  active_minutes,
  active_seconds,
  first_active_minute,
  last_active_minute,
  source_minute_count,
  source_row_count,
  calculated_at
from daily_operator_active_duration
where metric_name = 'boss_daily_operator_active_duration'
  and active_date = cast(:target_date as date)
order by active_minutes desc, operator_id asc;
```

幂等键：

```text
metric_name + active_date + operator_id
```

刷新策略：

- 今日数据每分钟或每 5 分钟刷新一次，覆盖写当前自然日同一 `operator_id` 的结果。
- 历史修正窗口至少覆盖最近 1 到 3 天，用于处理迟到 summary 或定时 SQL 延迟。
- 如果某天 summary 数据发生重算，按幂等键覆盖日级结果，不追加。

### 边界和展示

- 前端展示建议格式化为 `X 小时 Y 分钟`，同时保留原始 `active_minutes` 便于排序。
- 最大理论值为一天 1440 分钟；超过该值说明时间桶或时区处理有错误。
- 该指标只表示“有事实事件的分钟数”。如果一个操作员连续浏览页面但没有任何事件上报，中间空白分钟不应补齐。
- `<missing>` operator 的分钟不归属到任何真实操作员；数据质量页应单独展示缺失分钟数，避免低估真实操作员时长时没有提示。

## 操作员配置

第一版本地开发使用 `config/operators.local.json` 维护操作员展示名单，默认路径可通过 `BOSS_ANALYSIS_OPERATOR_CONFIG_FILE` 覆盖。配置字段：

- `operatorId`: 必填，必须与 CLS 中的 `operator_id` 完全一致。
- `displayName`: 页面展示名称；为空时回退到 `operatorId`。
- `accountName`: BOSS 页面账号姓名，用于人工核对。
- `enabled`: 是否在操作员列表展示。
- `role`、`note`: 仅作为展示或交接备注。

dev server 每次生成 dashboard payload 时按文件修改时间热加载配置；配置只影响展示名称和列表入口，不改变原始事件、分钟汇总或归因口径。部署后的正式方案不应依赖本地文件，应迁移到数据库或后台管理页面。

## 测试要求

必须覆盖：

- 同一事实重复聚合不重复计数。
- 迟到事件进入历史修正窗口。
- 未知事件类型进入健康指标。
- API 默认不返回敏感正文。
- 空数据查询返回稳定结构。
- CLS 汇总缺失、延迟或重复同步时，API 返回稳定结构并标明数据新鲜度。
