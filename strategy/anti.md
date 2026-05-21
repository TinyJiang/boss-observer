# 反向策略与禁止操作判定

## 1. 文档定位

本文件用于记录不允许出现、需要避免或需要单独识别的招聘操作方式。

这里维护的是“反向策略”：某些行为表面上会增加操作量或事件数，但会破坏候选人曝光、主动打招呼、聊天转化的真实判断，或者让后续分析误判招聘动作质量。

记录原则：

- 先描述不允许或需要避免的操作方式。
- 再写清它为什么会干扰策略判断。
- 最后给出可复用的日志判定规则和案例证据。
- 没有充分数据验证的规则标为“待验证”，不要写成最终结论。

## 2. 条目模板

```md
### 反向规则：ANTI-YYYYMMDD-001

- 状态：待验证 / 已观察 / 已确认 / 已废弃
- 记录时间：
- 规则名称：
- 不允许或需要避免的操作：
- 为什么有问题：
- 主要影响方向：候选人曝光 / 主动打招呼 / 聊天转化 / 数据复盘
- 分析步骤：
- 判定规则：
- 案例证据：
- 处理建议：
- 后续验证：
```

## 3. 反向规则：详情容器内连续切换候选人

- 状态：已确认
- 规则名称：详情容器内连续切换候选人
- 不允许或需要避免的操作：在列表页没有新增候选人卡片曝光、详情抽屉或详情 iframe 没有关闭的情况下，在详情容器里连续点击“下一个”或类似入口，导致连续产生大量 `candidate_detail.opened`。
- 为什么有问题：这类操作不是从候选人列表逐个筛选进入详情，会让 `candidate_detail.opened / candidate_list.card_exposed` 比例异常偏高，破坏“列表曝光 -> 详情打开”漏斗的可解释性，也容易被误判为高质量浏览。
- 主要影响方向：候选人曝光、数据复盘

### 3.1 判定说明

“详情容器内连续切换候选人”不是“重复打开同一候选人”。

它指的是：

- 列表页没有新增 `candidate_list.card_exposed`。
- 详情抽屉或详情 iframe 没有关闭。
- 操作员在详情里点了“下一个”或类似入口。
- 日志连续产生多条 `candidate_detail.opened`。

### 3.2 分析步骤

先按操作员和日期查询 raw 事件：

- `candidate_detail.opened`
- `candidate_detail.closed`
- `candidate_list.card_exposed`
- 必要时补看 `page_session.page_changed`
- 必要时补看 `candidate_filter.applied`

再依次检查：

- 看比例异常：`detail_opened / card_exposed` 明显偏高，例如超过 `3x`。
- 看分钟分布：多个分钟里 `detail_opened > 0` 但 `card_exposed = 0`。
- 看连续趋势：如果连续几分钟都是详情增长、卡片不增长，很像详情内切换，而不是从列表逐个点击。
- 看 open/close：`opened` 明显多于 `closed`。
- 看未关闭切换：如果一个详情没有 close，就出现下一条 opened，说明详情容器没关闭但候选人切了。
- 看来源字段：`payload.source` 如果大量是 `poll`，不是 `click`，更像探针持续识别详情容器变化。
- 看识别方式：`detectedBy` 如果集中在 `c_resume_canvas_matched_card` 或 `c_resume_recent_card`，说明主要来自详情 iframe/canvas 识别。
- 看详情路径：`detailUrl` path 如果集中在 `/web/frame/c-resume/`，说明事件集中在详情 iframe。
- 看 session/tab：如果大量事件都在同一个 `page_session`、同一个 tab、同一个详情 path 内发生，且没有明显页面切换，基本就是详情容器内连续操作。

### 3.3 判定规则

满足以下多数条件时，可以标记为“疑似详情容器内连续切换候选人”：

- `detail_opened / card_exposed >= 3`
- 连续分钟出现 `detail_opened > 0` 且 `card_exposed = 0`
- `opened > closed`，且存在 open 之后未 close 又出现下一条 open
- `source = poll` 占比很高
- `detectedBy` 主要是 `c_resume_canvas_matched_card`
- 事件集中在同一个 session、tab、detail iframe
- 详情 URL path 集中在 `/web/frame/c-resume/`

### 3.4 本次案例证据

- `candidate_detail.opened = 372`
- `candidate_list.card_exposed = 63`
- `candidate_detail.closed = 275`
- `detail_opened / card_exposed = 372 / 63`，约 `5.9x`
- `source = poll` 占比 `100%`
- `detectedBy = c_resume_canvas_matched_card` 为 `324 / 372`
- 全部集中在同一个 page session
- 有大量详情增长分钟没有对应卡片增长

### 3.5 处理建议

- 这类行为应从普通“列表曝光 -> 详情打开”漏斗中单独标记，避免把它当成正常逐个候选人筛选。
- 复盘时单独查看它是否属于操作员在详情内快速翻看候选人。
- 如果后续多次出现，应考虑建立专门指标，例如“疑似详情内连续切换次数”或“无新增卡片曝光的详情打开数”。
- 当前规则先作为策略库反向判定，不直接写入插件端事实事件。
