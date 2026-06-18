# 模块文档索引

本目录记录分析系统子项目的独立模块设计。父项目文档提供日志契约和历史背景，本目录文档用于指导 `analysis-system/` 内的后续实现。

阅读顺序：

1. `../ai-worklog.md`
2. `../overview-design.md`
3. `../boundary.md`
4. 本目录中与任务相关的模块文档
5. 对应源码和测试

模块列表：

- `01-ingestion-normalization.md`: CLS 输入、扁平字段解析、内部事件模型。
- `02-storage-replay.md`: 原始事件、解析错误、幂等写入和重放。
- `03-fact-projection.md`: 候选人、岗位、页面、打招呼、聊天等事实投影。
- `04-aggregation-query-api.md`: 聚合指标、查询 API、导出边界。
- `05-operations-security.md`: 配置、凭据、部署、监控和敏感数据保护。
- `06-log-health-probe.md`: 日志数量、质量、新鲜度、汇总一致性和告警规则。
- `07-cls-scheduled-sql-tasks.md`: CLS 定时 SQL 任务配置清单和可粘贴 SQL。
- `08-official-results-sync.md`: BOSS 官方结果数据采集、幂等同步到飞书多维表格的执行入口。
- `09-daily-analysis-llm-strategy.md`: 日常分析的大模型输入、输出、语言和边界策略。

通用规则：

- 模块文档描述稳定设计和已确认边界，不记录临时实现细节。
- 阶段进展、未完成事项和中断续写入口写入 `../ai-worklog.md`。
- 涉及父项目日志契约变更时，只能在获得用户明确授权后修改父项目文件。
