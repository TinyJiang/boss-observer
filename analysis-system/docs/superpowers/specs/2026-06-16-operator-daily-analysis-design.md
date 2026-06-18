# 操作员日常操作分析系统设计

- 日期：2026-06-16
- 状态：设计确认
- 范围：analysis-system 后端 API、前端 UI、模型分析输入输出契约

## 目标

为每个招聘操作员提供每日操作分析页面。页面默认分析前一天，结合 BOSS 后台官方结果数据和 analysis-system 已有行为事实，输出管理者可直接执行的行动计划。

第一版重点不是评估员工，也不是追求本地确定性归因，而是把可靠的波动指标和证据包整理给 Codex 模型，由模型输出具体 action、执行步骤、时间窗口、验收信号和证据引用。

## 非目标

- 不在本地代码中计算贡献度。
- 不在本地代码中计算归因置信度。
- 不在本地代码中做归因排序。
- 不做官方结果与插件数据差异专项对账；若冲突，以官方结果为准，差异对账后续单独做。
- 不修改 Chrome 插件日志契约，也不从插件源码、debug 页、Chrome storage 读取生产数据。
- 不继续本轮飞书表初始化工作；飞书表初始化和同步任务后续单独处理。

## 数据来源

### 官方结果

后续由单独任务把 BOSS 管理员后台结果同步到飞书。analysis-system 只读取飞书中的官方结果表：

- `daily_operator_result`：单日、单操作员结果汇总。
- `daily_operator_job_result`：单日、单岗位或岗位发布人结果明细。

官方结果是分析的权威结果源。第一版字段按 BOSS 后台日维度可见字段设计，包括：

- 操作员维度：`统计日期`、`BOSS姓名`、`手机号码`、`所属公司`、`所在分组`、`认证职务`、`企业邮箱`、`BOSS查看牛人`、`BOSS发起聊天`、`BOSS沟通`、`牛人查看BOSS`、`牛人发起聊天`、`收获简历`、`交换电话微信`、`接受面试`。
- 岗位维度：`统计日期`、`职位名称`、`职位发布人`、`发布人手机号`、`发布人所属公司`、`发布人所在分组`、`发布人认证职务`、`发布人企业邮箱` 和同一组结果指标。

岗位详情、上架、刷新等动作如果飞书官方结果缺字段，先在证据包中标记缺失，后续由采集或同步侧补齐。

### 行为事实

行为事实来自 analysis-system 已批准的数据入口，例如 CLS 定时 SQL 下游结果、文件样本或已有 summary reader。生产环境不允许使用 CLS Search/SearchLog 作为权威数据源。

第一版使用现有可取到的行为事实：

- 操作员活跃、曝光、详情、打招呼、聊天相关指标。
- 岗位上下文、岗位动作、刷新/上架动作。
- 日、3 日、7 日、14 日等分析窗口内的行为汇总。

操作员身份通过本地操作员配置映射 BOSS 后台姓名，不要求飞书第一版写入 `operator_id`。

离线分析必须以本地操作员配置作为白名单。官方结果中的 `BOSS姓名` 或 `职位发布人` 只有匹配配置里的 `operatorId`、`displayName`、`accountName` 或 `aliases`，且该配置项 `enabled=true` 时，才允许进入证据包和模型输入；未配置或禁用人员不分析，其岗位结果也不分析。

## 本地处理边界

本地只产出两类结构化数据。

### 波动指标

`volatility_metrics` 描述“发生了什么变化”，不描述“为什么发生”：

- 与前一天对比。
- 与上周同 weekday 对比。
- 与 7 日均值对比。
- 与 14 日均值对比。
- 短期趋势斜率。
- 漏斗断点，例如查看到发起聊天、发起聊天到沟通、沟通到简历。

波动指标可以包含方向、幅度、基线、样本数和低样本提示，但不能输出归因结论、贡献度或置信度。

### 证据包

`evidence_bundle` 描述模型可引用的事实明细：

- 官方操作员结果行。
- 官方岗位结果行。
- 操作员行为窗口汇总。
- 岗位行为窗口汇总。
- 岗位动作明细。
- 未匹配岗位。
- 缺失字段。
- 低样本和数据完整性提示。

每条证据都要有稳定 `evidence_id`，模型输出通过 `evidence_refs` 引用。

## 模型输入契约

后端给 Codex 模型的输入统一为 `daily_analysis_packet`：

```json
{
  "analysis_date": "2026-06-15",
  "scope": {
    "operator_id": "op_xxx",
    "boss_name": "张三"
  },
  "official_results": {
    "operator_row": {},
    "job_rows": []
  },
  "behavior_evidence": {
    "behavior_summaries": [],
    "operation_details": {
      "detail_open_events": [
        {
          "evidence_id": "behavior:detail-open:...",
          "operator_id": "op_xxx",
          "occurred_at": "2026-06-15T10:12:00+08:00",
          "job_id": "job_xxx",
          "job_name": "职位名称",
          "candidate_local_id": "candidate_xxx",
          "source_event_id": "evt_xxx"
        }
      ],
      "greeting_events": [
        {
          "evidence_id": "behavior:greeting:...",
          "operator_id": "op_xxx",
          "occurred_at": "2026-06-15T10:13:00+08:00",
          "job_id": "job_xxx",
          "result": "success|failed|unknown",
          "source_event_id": "evt_xxx"
        }
      ],
      "chat_progress_events": [
        {
          "evidence_id": "behavior:chat-progress:...",
          "operator_id": "op_xxx",
          "occurred_at": "2026-06-15T10:20:00+08:00",
          "job_id": "job_xxx",
          "progress_type": "chat_opened|reply_observed|resume_observed|contact_exchange_observed",
          "source_event_id": "evt_xxx"
        }
      ],
      "job_operation_events": [
        {
          "evidence_id": "behavior:job-operation:...",
          "operator_id": "op_xxx",
          "occurred_at": "2026-06-15T09:30:00+08:00",
          "job_id": "job_xxx",
          "operation": "publish|refresh|pause|close|unknown",
          "source_event_id": "evt_xxx"
        }
      ],
      "timeline_windows": []
    },
    "job_actions": [],
    "timeline_windows": {}
  },
  "volatility_metrics": {
    "vs_yesterday": {},
    "vs_same_weekday": {},
    "vs_7d_avg": {},
    "vs_14d_avg": {},
    "funnel_breakpoints": []
  },
  "data_quality": {
    "missing_fields": [],
    "unmatched_jobs": [],
    "low_sample_warnings": []
  }
}
```

## 模型输出契约

模型输出统一为结构化 JSON：

```json
{
  "summary": "今日行动计划摘要",
  "action_items": [
    {
      "rank": 1,
      "owner_role": "manager|operator|system",
      "target_operator_id": "op_xxx",
      "target_job_key": "job_xxx|null",
      "action": "具体可执行动作",
      "execution_steps": ["步骤 1", "步骤 2"],
      "due_window": "今日早会后 30 分钟内",
      "success_check": "完成后检查的信号",
      "confidence": "high",
      "evidence_refs": [],
      "data_gaps": [],
      "blocked_by": []
    }
  ],
  "questions_for_next_collection": []
}
```

`action_items`、`rank`、`action`、`execution_steps`、`due_window`、`success_check` 和 `confidence` 全部是模型产物。本地只做 schema 校验、缓存和展示，不改写模型判断。

## 离线分析与后端 API

日常分析是离线生成结果，不在前台请求时实时生成。离线任务负责读取飞书官方结果、行为事实和模型输出，并把完整 `daily_analysis_payload` 写成可读取的结果 JSON。API 层只负责按日期和操作员读取结果。

当前第一版唯一手动入口为：

```bash
./generate-daily-analysis.sh YYYY-MM-DD
```

该入口默认读取已同步到飞书的 `daily_operator_result` 和 `daily_operator_job_result`，写出 `BOSS_ANALYSIS_DAILY_ANALYSIS_RESULTS_DIR/YYYY-MM-DD.json`；也支持 `--source-file` 读取本地官方结果 JSON 做离线回放。离线入口只生成事实证据包和 `model_input_packet`，不得在本地生成复盘对象优先级、归因、置信度或建议动作。大模型分析策略见 `docs/modules/09-daily-analysis-llm-strategy.md`；真实模型输出尚未接入时，结果必须保持 `model_state=model_output_required`。

新增聚合接口：

```text
GET /api/daily-analysis?date=YYYY-MM-DD&operator_id=optional
```

返回：

```json
{
  "status": "ready",
  "analysis_date": "2026-06-15",
  "sync_state": {},
  "volatility_metrics": {},
  "evidence_bundle": {},
  "model_analysis": {},
  "data_quality": {},
  "errors": []
}
```

状态含义：

- `ready`：官方结果、行为证据和模型分析都可用。
- `partial`：官方结果或行为证据部分缺失，仍可展示本地波动和证据。
- `analyzing`：模型分析正在生成。
- `failed`：官方结果不可用或模型输出无法解析。

如果指定日期或操作员的离线结果不存在，API 返回缺失错误，不临时回退到 demo、飞书读取或实时模型调用。

## 前端 UI

新增 `日常分析` 页面，默认日期为昨天。

页面结构：

1. 顶部状态条：分析日期、飞书同步状态、官方数据更新时间、模型生成时间、数据质量状态。
2. 波动概览：展示本地 `volatility_metrics`，只说现象，不说原因。
3. 行动计划：展示模型输出的 action 排序、执行步骤、时间窗口、验收信号、证据引用和数据缺口。
4. 操作员详情：展示单个操作员的官方结果、行为证据和关键波动。
5. 岗位证据：展示岗位官方结果、岗位动作、字段缺口和模型引用证据。

加载状态必须显式展示，包括官方结果读取中、行为汇总读取中、模型分析中、分析失败和部分数据可用。

## 错误处理

- 官方结果缺失：阻断完整分析，返回 `failed` 或 `partial`，前端明确显示。
- 行为证据缺失：允许部分分析，但写入 `data_quality.missing_fields`。
- 岗位无法匹配：保留在 `unmatched_jobs`，不丢弃。
- 低样本：写入 `low_sample_warnings`，交给模型判断影响。
- 模型输出不合法：不展示半结构化结论，保留错误并允许重试。
- 飞书同步未完成：显示同步状态，不把不完整数据伪装成完整分析。

## 测试范围

后端单元测试：

- 官方结果 reader 对空数据、未知字段、重复行保持兼容。
- 波动计算覆盖昨日比、周环比、7 日均值、14 日均值和低样本。
- 证据包生成保留 evidence id，正确标记缺失字段和未匹配岗位。
- 模型输出 schema 校验拒绝非法结构。
- API 在 `ready`、`partial`、`failed` 状态下返回稳定结构。

前端测试或手工验证：

- `日常分析` 页面能显示加载、失败、部分可用和 ready 状态。
- 波动概览不展示本地归因结论。
- 行动计划卡片能展示执行步骤、时间窗口、验收信号、证据引用和数据缺口。
- 移动端和桌面端文本不重叠。

## 第一版落地顺序

1. 增加后端领域类型和波动计算纯函数。
2. 增加证据包构建器。
3. 增加模型输出 schema 校验和 demo/mock 分析器。
4. 增加离线结果 JSON reader 和 `/api/daily-analysis` dev API，API 只读离线结果。
5. 增加前端 `日常分析` 页面和 API 类型。
6. 接入离线任务中的真实飞书 reader，先生成官方结果事实版离线结果。
7. 接入历史基线、行为证据和真实模型调用作为后续任务。

第一版开发完成标准是：离线任务写入结果 JSON 后，本地 dev 环境中能打开 `日常分析` 页面并读取该结果；API 请求链路不实时生成分析。
