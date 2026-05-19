# 存储与重放

## 职责

本模块负责保存原始事件、记录解析或投影错误，并提供可重放入口。它不负责从 CLS 拉取数据，也不负责业务指标解释。

代码归属：

- `src/boss_analysis/storage/`
- `src/boss_analysis/domain/` 中的 repository 协议或数据结构
- `tests/` 中的 repository、幂等和重放测试

## 原始事件表

`raw_events` 是事实源头，一条插件事件一行。

建议字段：

- `event_id` 主键
- `event_type`
- `occurred_at`
- `received_at`
- `plugin_version`
- `operator_id`
- `operator_account_name`
- `boss_account_name`
- `boss_account_matched`
- `session_id`
- `page_type`
- `page_url`
- `page_title`
- `job_id`
- `job_status`
- `source_tab_id`
- `source_window_id`
- `source_tab_url`
- `payload_json`
- `context_json`
- `raw_cls_json`
- `parse_status`
- `parse_error`
- `created_at`

规则：

- `payload_json`、`context_json` 和 `raw_cls_json` 保存原文。
- 解析后的 JSON 可以进入 JSONB 辅助列，但不能替代原文。
- 写入以 `event_id` 幂等；重复事件不覆盖原始发生时间。

## 错误表

`event_parse_errors` 记录一次解析或投影失败。

建议字段：

- `id`
- `event_id`
- `event_type`
- `error_stage`
- `error_message`
- `payload_preview`
- `context_preview`
- `occurred_at`
- `created_at`
- `resolved_at`

`error_stage` 示例：

- `normalize`
- `raw_store`
- `fact_project`
- `aggregate`
- `replay`

## 重放入口

重放用于 parser 修复、字段升级、历史聚合重算和补数。

设计要求：

- 可以按时间范围、事件类型、插件版本、解析状态筛选。
- 重放从 `raw_events` 读取，不从插件或 Chrome 状态读取。
- 重放过程必须幂等，重复投影不能制造重复事实。
- 重放任务的范围和结果写入运行日志或任务表，方便审计。

## 事务边界

推荐顺序：

1. normalizer 输出解析结果。
2. repository 幂等写入 `raw_events`。
3. 提交 Kafka offset。
4. fact projector 在同事务或独立重试任务中投影事实。

如果事实投影失败，原始事件仍应保留，并写入错误表等待重放。

## 测试要求

必须覆盖：

- 同一 `event_id` 重复写入。
- JSON 解析失败仍写入原始事件。
- 事实投影失败不删除原始事件。
- 按条件筛选重放。
- 重放后的事实表幂等。
