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
