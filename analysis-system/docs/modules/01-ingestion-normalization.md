# 输入消费与标准化

## 职责

本模块把外部输入转换成分析系统内部事件对象。它只处理输入协议、字段解析、兼容校验和消费确认，不做聚合判断。

代码归属：

- `src/boss_analysis/consumer/`
- `src/boss_analysis/domain/`
- `tests/` 中的 normalizer 和 consumer 测试

## 输入来源

第一版主输入是 CLS Kafka 协议消费到的 JSON 日志。补数或排障时优先使用离线样本；SearchLog 只能作为本地开发验证工具，不能接入正式输入链路。

核心字段来自日志规范：

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
- `page_title`
- `job_id`
- `job_status`
- `source_tab_id`
- `source_window_id`
- `source_tab_url`
- `payload_json`
- `context_json`

## 内部事件对象

Normalizer 应输出一个结构化结果，至少包含：

- `raw`: 原始 CLS 字段字典。
- `event_id`: 幂等主键。
- `event_type`: 原始事件类型字符串。
- `occurred_at`: 解析后的事件发生时间；失败时保留原文并记录错误。
- `received_at`: 分析系统接收时间。
- `payload`: `payload_json` 解析结果；失败时为 `None`。
- `context`: `context_json` 解析结果；失败时为 `None`。
- `parse_status`: `parsed` / `partial` / `failed`。
- `parse_errors`: 字段级错误列表。

## 兼容策略

- 未知 `event_type` 不算解析失败。
- 缺少非关键字段时标记 `partial`，仍然进入原始事件表。
- `payload_json` 或 `context_json` 解析失败时，不丢弃整条事件。
- 时间字段优先解析 ISO 8601；解析失败时保留原始字符串并写入错误表。
- `boss_account_matched` 需要兼容布尔值、字符串布尔值和缺省值。

## 消费确认

- 只有原始事件写入成功后才提交 Kafka offset。
- 事实投影失败不能阻塞原始事件保存，但要记录可重放错误。
- 重复 `event_id` 应视为幂等成功，避免 consumer 重启后重复写入。

## 测试要求

必须覆盖：

- 完整合法事件。
- 未知事件类型。
- 缺少 `event_id`。
- 非法 `payload_json` / `context_json`。
- 乱序时间和迟到事件。
- 字符串布尔值兼容。

测试使用离线样本，不依赖真实 CLS、Chrome 或插件运行时。
