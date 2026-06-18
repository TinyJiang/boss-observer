# 边界说明

分析系统和 Chrome 插件之间只通过日志规范交流。

## 上游输入

唯一生产输入是 CLS 日志主题中的事件。事件字段和 payload 结构以根项目日志规范为准：

- `../../docs/modules/12-log-specification.md`

分析系统消费的是 CLS 扁平字段：

- `event_id`
- `event_type`
- `occurred_at`
- `plugin_version`
- `operator_id`
- `operator_account_name`
- `boss_account_name`
- `boss_account_matched`
- `session_id`
- `page_type`
- `page_url`
- `job_id`
- `job_name`
- `jobName`
- `payload_json`
- `context_json`

分钟级统计的生产输入是 CLS 定时 SQL 写入的汇总主题或指标主题。第一阶段只消费 `boss_summary_minute_prod` 中由以下任务输出的事实汇总：

- `boss_minute_operator_funnel`
- `boss_minute_chat`

这些汇总仍然来自原始日志事实，不允许写入候选人质量、员工绩效或话术评价等分析结论。

### 官方结果同步入口

`boss_analysis.ops.sync_official_results` 是一个明确授权的独立一次性同步入口，用于把 BOSS 官方后台按天结果数据写入飞书多维表格。它不替代 CLS 事实日志链路，也不向插件下发采集策略。

边界约束：

- 只通过 BOSS 后台 JSON API 读取官方结果，不依赖插件 DOM、debug 页、Chrome storage 或 content script helper。
- 只通过 Feishu OpenAPI 读写目标多维表格，不操作飞书 UI。
- 不实现定时器、cron、常驻 worker 或后台调度。
- 不在本地代码中做波动归因、贡献度或置信度排序。
- cookie、session、tenant token、app secret 等凭据只能来自环境变量或外部凭据注入，不写入代码、日志或测试快照。

### 日常分析离线入口

`boss_analysis.ops.generate_daily_analysis` 是日常分析离线结果的唯一手动生成入口。它只能读取已同步的官方结果和已批准的事实汇总，生成证据包与大模型输入包。

边界约束：

- 本地只做事实清洗、字段映射、证据 ID 生成、数据质量标记和模型输入包整理。
- `summary`、`rank`、`cause`、`confidence`、`reasoning`、`recommended_actions` 必须来自大模型输出。
- 没有大模型输出时，结果必须保持 `model_state=model_output_required`，不能用本地规则兜底为 ready 分析。
- 大模型策略文档是 `docs/modules/09-daily-analysis-llm-strategy.md`。

## 禁止耦合

分析系统不得依赖：

- Chrome extension 源码。
- content script 的 DOM 选择器。
- background service worker 的内部状态。
- popup 的生产统计结构。
- debug/profile 的临时诊断字段。
- 插件测试 fixture 中未进入日志规范的字段。

## 契约变更流程

1. 在 `../../docs/modules/12-log-specification.md` 定义字段或事件语义。
2. 插件按新契约生产事件。
3. 分析系统按 `plugin_version` 兼容解析。
4. 如需历史重算，从 `raw_events` 重放。

## 数据所有权

- 插件拥有采集事实的生成逻辑。
- CLS 拥有原始日志保存和实时消费入口。
- 分析系统拥有解析、关联、聚合、查询和报表。
- 本地 `config/operators.local.json` 只维护展示用操作员元数据，不作为事实事件来源；生产阶段应迁移到数据库或后台管理能力。
- 分析结论不得回写为插件事实字段。
