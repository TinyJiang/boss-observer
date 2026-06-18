# 日常分析输入素材升级设计

## 背景

日常分析离线入口当前只把分析当天的 BOSS 官方结果写入 `model_input_packet`。这会导致大模型只能看到单日结果，缺少两个关键事实层：

- 前 14 天效果数据：用于判断当天结果相对近期基线的变化。
- 操作概览和操作明细：用于判断当天动作链路发生了什么，而不是只看最终结果。

本设计升级输入素材，不改变既定边界：本地系统只采集、清洗和组织事实，不生成归因、优先级、置信度或行动建议。模型输出仍由大模型负责。

## 已确认决策

- 采用一次性接全方案：前 14 天效果数据、操作概览聚合、事件级操作明细都要进入模型输入素材。
- 前 14 天窗口不包含分析当天。例如分析 `2026-06-16`，历史窗口为 `2026-06-02` 到 `2026-06-15`。
- 所有素材都必须先按本地操作员配置白名单过滤。配置外人员不进入历史、概览、明细或模型 action。
- 真实大模型调用尚未接入前，离线结果仍保持 `status=analyzing` 和 `sync_state.model_state=model_output_required`。

## 数据来源

### 当天官方结果

来源保持不变：

- 操作员日结果：飞书 `daily_operator_result`，或 `--source-file` 回放文件。
- 岗位日结果：飞书 `daily_operator_job_result`，或 `--source-file` 回放文件。

当天官方结果仍是当天效果事实，不作为本地分析结论。

### 前 14 天效果数据

来源优先使用已存在的日级基础统计结构：

- 指标名：`boss_daily_operator_basic_stats`
- 本地 reader：`iter_daily_basic_summaries_from_file()`、`iter_daily_basic_summaries_from_metric_topic()`、`iter_daily_basic_summaries_from_search()`。
- 生产默认不得调用 CLS Search/SearchLog。正式部署应使用已批准的同步结果、文件、数据库或指标 topic 读取路径。

第一版离线入口应支持文件输入，避免把生产生成链路绑定到 SearchLog：

```bash
./generate-daily-analysis.sh 2026-06-16 \
  --daily-basic-source-file /path/to/daily-basic-stats.json
```

历史效果字段按操作员和日期组织，至少包含：

- `active_date`
- `operator_id`
- `display_name`
- `active_minutes`
- `exposure_count`
- `detail_open_count`
- `greeting_count`
- `chat_open_count`
- `chat_reply_count`
- `resume_signal_count`
- `contact_signal_count`
- `total_event_count`
- `source_record_count`
- `recorded_at`

如果某些字段在当前 `DailyBasicStatsRecord` 中不存在，生成器必须只写已有事实，并在 `data_quality.missing_fields` 中记录缺失字段，不得用 0 伪装为真实值。

### 操作概览数据

操作概览是 14 天窗口内按人/天聚合的操作事实概览，目标是给模型理解动作密度和动作结构。它不替代操作明细。

第一版可以从两类来源生成：

- 日级基础统计中的非敏感操作指标。
- 已批准的操作概览同步文件。

离线入口应支持显式文件输入：

```bash
./generate-daily-analysis.sh 2026-06-16 \
  --operation-overview-source-file /path/to/operation-overview.json
```

字段按操作员和日期组织，至少包含：

- `active_date`
- `operator_id`
- `detail_open_count`
- `greeting_count`
- `chat_open_count`
- `chat_reply_count`
- `job_operation_count`
- `active_minutes`
- `source_event_count`
- `source_state`

### 操作明细数据

操作明细用于记录关键事件，不包含敏感正文。离线入口应支持显式文件输入：

```bash
./generate-daily-analysis.sh 2026-06-16 \
  --operation-details-source-file /path/to/operation-details.json
```

允许进入模型输入的明细类型：

- `detail_open_events`：时间、操作员、岗位、本地候选人标识、来源事件 ID。
- `greeting_events`：时间、操作员、岗位、结果状态、来源事件 ID。
- `chat_progress_events`：时间、操作员、岗位、结构化状态、来源事件 ID。
- `job_operation_events`：时间、操作员、岗位、操作类型、来源事件 ID。
- `timeline_windows`：时间窗口、操作员、岗位、操作计数和关键事件 ID。

禁止进入模型输入的内容：

- 聊天正文。
- 手机号、微信号等联系方式明文。
- 完整简历正文。
- 完整候选人敏感资料。
- 未脱敏 URL 参数。

## 模型输入结构

`model_input_packet.facts` 增加以下结构：

```json
{
  "official_operator_results": [],
  "official_job_results": [],
  "historical_effects_14d": {
    "source_state": "loaded|partial|not_loaded",
    "window": {
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD",
      "days": 14,
      "includes_target_date": false
    },
    "operator_daily_rows": [],
    "operator_rollups": []
  },
  "operation_overview_14d": {
    "source_state": "loaded|partial|not_loaded",
    "window": {
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD",
      "days": 14,
      "includes_target_date": false
    },
    "operator_daily_rows": [],
    "operator_rollups": []
  },
  "operation_details": {
    "source_state": "loaded|partial|not_loaded",
    "target_date": "YYYY-MM-DD",
    "detail_open_events": [],
    "greeting_events": [],
    "chat_progress_events": [],
    "job_operation_events": [],
    "timeline_windows": [],
    "data_gaps": []
  }
}
```

`operator_rollups` 只做事实汇总，例如 14 天总量、有效天数、日均值、最大值、最小值。不得写入“偏低”“异常”“机会”“问题严重”等分析结论。

## 过滤规则

所有输入素材统一使用操作员配置白名单。

匹配字段：

- `operatorId`
- `displayName`
- `accountName`
- `aliases`

官方结果中的 `BOSS姓名`、`职位发布人`，历史数据中的 `operator_id`、`display_name`，操作数据中的 `operator_id` 或已映射姓名，都必须映射到启用的 `OperatorProfile`。无法映射的数据不得进入模型输入。

## 缺失与质量状态

每类素材都必须表达加载状态：

- `loaded`：数据源存在，且窗口内有可用记录。
- `partial`：数据源存在，但覆盖天数、操作员或字段不完整。
- `not_loaded`：数据源不存在、未配置或读取失败。

`data_quality.missing_fields` 应继续记录缺失项：

- `historical_effects_14d`
- `operation_overview_14d`
- `operation_details`
- 具体字段缺失，例如 `operation_details.chat_progress_events`

读取失败不能静默吞掉。生成结果的 `errors` 应追加非敏感错误说明。

## CLI 设计

保留唯一手动入口：

```bash
./generate-daily-analysis.sh YYYY-MM-DD
```

新增可选参数：

```bash
--daily-basic-source-file PATH
--operation-overview-source-file PATH
--operation-details-source-file PATH
```

后续如接入已批准的数据库或指标 topic，可再增加显式 source 参数。生产默认不得为了补齐素材直接调用 CLS Search/SearchLog。

## 测试要求

必须覆盖：

- 14 天窗口为 `target_date - 14` 到 `target_date - 1`。
- 历史效果数据只保留配置内操作员。
- 操作概览数据只保留配置内操作员。
- 操作明细只保留配置内操作员。
- 操作明细会过滤聊天正文、联系方式和完整简历正文。
- 数据源缺失时 `source_state=not_loaded`，并写入 `data_quality.missing_fields`。
- 数据源覆盖不完整时 `source_state=partial`。
- 生成器不在本地写入模型 action、归因、置信度或人员排名。

## 非目标

- 不在本地实现大模型分析。
- 不在本地生成行动建议或复盘优先级。
- 不修改 Chrome 插件采集逻辑。
- 不采集或输出敏感正文。
- 不把配置外人员通过历史数据或操作数据重新带入模型输入。
