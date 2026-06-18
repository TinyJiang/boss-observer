# 日常分析大模型策略

## 策略标识

- 名称：`daily_analysis_coaching_v1`
- 版本：`2026-06-17`
- 适用入口：`./generate-daily-analysis.sh YYYY-MM-DD`
- 适用页面：`/daily-analysis`

## 边界原则

本地系统只负责事实采集、字段清洗、身份映射、证据包整理和模型输入包生成。本地系统不得生成以下模型产物：

- `summary`
- `rank`
- `confidence`
- `action_items`
- 复盘对象优先级
- 波动原因、贡献解释、机会判断或策略判断

如果没有大模型输出，离线结果必须保持 `model_state=model_output_required`，`model_analysis.action_items=[]`，不得用本地规则兜底。`model_analysis.attributions=[]` 只作为旧前端兼容占位，不属于新模型输出契约。

## 模型任务

大模型读取 `model_input_packet`，基于其中的官方结果、行为证据、数据质量提示和证据 ID，生成管理者早会可直接执行的行动计划。

目标不是员工排名，也不是绩效评价。模型需要回答：

- 今天要执行哪些具体动作。
- 每个动作由谁执行，面向哪个操作员或岗位。
- 执行动作分几步完成。
- 多久内完成。
- 完成后看什么验收信号。
- 哪些证据支持这个动作。
- 哪些数据缺口会阻塞或降低动作可信度。

## 输入约束

模型只允许使用 `model_input_packet` 中的字段和证据，不得引入外部事实或猜测。证据来源包括：

- `official_operator_results`
- `official_job_results`
- `historical_effects_14d`：分析日前 14 天效果事实，不包含分析当天，只能包含日级事实行和事实 rollup。
- `operation_overview_14d`：分析日前 14 天操作概览事实，不包含分析当天，只能包含动作计数、覆盖天数和来源状态。
- `behavior_summaries`
- `operation_details`
- `job_actions`
- `data_quality`

这些输入都必须是 fact-only 材料，只能表达事实行、事实 rollup、来源状态和数据缺口，不能包含本地结论、机会判断、辅导建议或归因解释。

生产链路补齐这些输入时，禁止为了凑齐 `historical_effects_14d`、`operation_overview_14d`、`operation_details` 而直接调用 CLS Search/SearchLog。这里是明确的生产边界：正式任务只能读取已批准的同步结果、离线文件、数据库或指标 topic 等非 Search 路径；若素材缺失，应保留 `source_state` / `data_quality` 缺口，而不是在生产兜底查询 Search/SearchLog。

离线入口在生成 `model_input_packet` 前必须先按操作员配置白名单过滤官方结果。只有配置中存在且 `enabled=true` 的人员可以进入以下事实集合；配置外人员及其岗位不得进入模型输入，也不得由模型生成 action。匹配字段为配置中的 `operatorId`、`displayName`、`accountName`、`aliases` 与官方结果中的 `BOSS姓名` / `职位发布人`。

`operation_details` 是大模型判断“发生了哪些操作”的关键事实层，必须独立于官方结果指标存在。它可以包含：

- `detail_open_events`：候选人详情打开事实，只记录时间、操作员、岗位、候选人本地标识和来源事件 ID。
- `greeting_events`：打招呼事实，只记录时间、操作员、岗位、结果状态和来源事件 ID。
- `chat_progress_events`：聊天推进事实，只记录打开、回复、简历信号、联系交换信号等结构化状态，不包含聊天正文。
- `job_operation_events`：岗位上架、刷新、暂停、关闭等操作事实。
- `timeline_windows`：按时间窗口整理的操作密度和关键动作集合。

如果当前离线任务未接入操作明细，`operation_details.source_state` 必须为 `not_loaded`，并在 `data_quality.missing_fields` 中写入 `operation_details`。模型不得在缺少操作明细时推断具体操作原因。

涉及聊天正文、联系方式、完整简历内容等敏感信息时，默认视为不可用输入。模型不得要求前端或插件补采敏感正文。

## 输出语言

使用中性、可执行语言：

- 使用明确动词，例如“抽查”“复盘”“补看”“确认”“调整”“安排”“记录”。
- 每条输出必须能在当天早会或跟进中执行。
- 避免“排名”“垫底”“偷懒”“表现差”“绩效差”等绩效化表达。
- 避免只输出“有机会”“需关注”“建议优化”“加强跟进”这类不可执行反馈。
- 单日数据只能作为行动触发信号，不能表达为稳定人员判断。

## 输出结构

模型必须输出结构化 JSON：

```json
{
  "summary": "string",
  "action_items": [
    {
      "rank": 1,
      "owner_role": "manager|operator|system",
      "target_operator_id": "string|null",
      "target_job_key": "string|null",
      "action": "string",
      "execution_steps": ["string"],
      "due_window": "string",
      "success_check": "string",
      "confidence": "high|medium|low",
      "evidence_refs": ["evidence_id"],
      "data_gaps": ["string"],
      "blocked_by": ["string"]
    }
  ],
  "questions_for_next_collection": ["string"]
}
```

字段要求：

- `rank`：只表示行动执行顺序，不表示人员排名。
- `owner_role`：必须说明由管理者、操作员还是系统执行。
- `target_operator_id`：面向某个操作员时必须填写；团队级动作可为 `null`。
- `target_job_key`：面向某个岗位时必须填写；非岗位动作可为 `null`。
- `action`：必须是一句话可执行动作，不能是抽象反馈。
- `execution_steps`：必须拆成 1 到 4 个具体步骤。
- `due_window`：必须写明执行时间窗口，例如“今日早会后 30 分钟内”。
- `success_check`：必须写明完成后检查什么信号。
- `confidence`：必须结合证据数量、历史基线、操作明细和数据缺口判断。
- `evidence_refs`：必须来自输入证据中的 `evidence_id`。
- `data_gaps`：必须列出影响判断的缺口，例如 `historical_baselines`、`behavior_evidence`、`operation_details`、`model_analysis`。
- `blocked_by`：必须列出执行前必须先补齐的事实或配置；没有阻塞时返回空数组。

## 质量控制

模型输出进入 `/api/daily-analysis` 前必须通过 schema 校验：

- 缺少必填字段时拒绝。
- `evidence_refs` 引用不存在的证据时拒绝或降级。
- 出现绩效化、人身评价或敏感信息时拒绝。
- 出现只有机会判断、原因解释、趋势评价但没有可执行动作的条目时拒绝。
- 在缺少历史基线或行为证据时，不能输出 `high` 置信度。

## 当前实现状态

当前离线入口只生成事实证据包和 `model_input_packet`。真实大模型调用尚未接入，因此结果保持 `analyzing` 状态，等待模型输出后再进入 `ready`。
