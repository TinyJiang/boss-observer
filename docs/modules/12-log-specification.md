# 日志规范与后端分析契约

## 1. 目标

这份文档定义插件当前输出给后端的日志契约，便于后端保存原始事实日志、建立索引、做离线分析和导出。

原则很简单：

- 原始事件值原样保留。
- `event.type` 和 `pageType` 都按字符串枚举处理。
- 后端不要把分析结论回写成事实字段。

## 2. 传输批次

当前插件向后端发送的批次格式为：

```json
{
  "batchType": "bossObserver.events",
  "sentAt": "2026-05-11T16:04:09.376+08:00",
  "eventCount": 3,
  "events": []
}
```

字段说明：

- `batchType`: 批次类型，当前固定为 `bossObserver.events`。
- `sentAt`: 批次发送时间，ISO 8601 字符串，使用本地时区偏移格式。
- `eventCount`: 批次内事件数。
- `events`: 事件数组，元素结构见下文。

## 3. 单条事件结构

当前单条事件的基础结构为：

```json
{
  "id": "evt_...",
  "type": "page_session.page_changed",
  "occurredAt": "2026-05-11T16:04:03.999+08:00",
  "pluginVersion": "0.1.0",
  "context": {},
  "payload": {},
  "sourceTabId": 669699710,
  "sourceWindowId": 669699709,
  "sourceTabUrl": "https://www.zhipin.com/web/chat/recommend"
}
```

字段说明：

- `id`: 事件唯一 ID。
- `type`: 事件类型枚举，见第 6 节。
- `occurredAt`: 事件发生时间，ISO 8601 字符串，使用本地时区偏移格式，例如 `+08:00`。
- `pluginVersion`: 插件版本号。
- `context`: 采集时的页面会话快照，见第 4 节。
- `payload`: 事件专属数据，见第 7 节。
- `sourceTabId`: 事件来源标签页 ID。
- `sourceWindowId`: 事件来源窗口 ID。
- `sourceTabUrl`: 事件来源标签页 URL。

后端应允许 `sourceTabId`、`sourceWindowId`、`sourceTabUrl` 缺省或为空，以兼容不同阶段的实现。

## 4. 会话上下文字段

`context` 当前来自 `SessionContext.snapshot()`，字段如下：

- `sessionId`: 浏览器会话 ID。
- `pageType`: 当前页面类型枚举。
- `pageUrl`: 当前页面 URL。
- `pageTitle`: 当前页面标题。
- `isBossPage`: 是否属于 BOSS 直聘页面。
- `jobContext`: 当前识别到的职位上下文；尚未识别到时为 `null`。
- `startedAt`: 会话开始时间，ISO 8601 字符串，使用本地时区偏移格式。

说明：

- `context` 表示“采集当下”的页面快照，不保证和 `payload` 内的历史页对象一致。
- `context.pageUrl` / `context.pageType` 适合做分析维度。
- `context.pageTitle` 只作为辅助信息，不建议作为主键。
- `context.jobContext` 会随候选人曝光、详情、打招呼等后续事件进入上下文，适合做岗位维度关联；第一版只包含 `jobId`、`jobIdSource`、`jobStatus`、`jobStatusSource`，不包含职位描述正文、识别来源 URL 或更新时间。

## 5. 页面类型枚举

`pageType` 当前由 `classifyPage(url)` 生成，枚举值如下：

| 值 | 含义 | 当前规则 |
| --- | --- | --- |
| `chat` | 聊天页 | `/web/chat` 开头，但不含已单独识别的推荐、搜索、详情子页面 |
| `candidate_recommend` | 候选人推荐/列表页 | `/web/chat/recommend`、`/geek/recommend`，或查询串包含 `recommend` |
| `candidate_search` | 候选人搜索页 | `/web/chat/search`、`/geek/search`，或查询串包含 `search` |
| `candidate_intention` | 有意向候选人页 | `/web/chat/intention` |
| `candidate_interaction` | 候选人互动页 | `/web/chat/interaction` |
| `candidate_manage` | 牛人管理页 | `/web/chat/geek/manage*`，或路径包含 `/geek/manage` |
| `candidate_detail` | 候选人详情页 | `/geek/detail`、`/resume/detail`、`/web/frame/c-resume`，或查询串包含 `geekId=` |
| `recruiting_data` | 招聘数据页 | `/web/chat/data-recruit` |
| `job_manage` | 职位管理页 | `/web/chat/job/list`、`/job` 或 `/position` |
| `business_mall` | 道具/权益商城页 | `/web/chat/business/mall` |
| `project_outsource` | 项目外包页 | `/web/chat/hezuo` 开头 |
| `site_home` | BOSS 入口/城市首页 | `/` 或城市入口页，例如 `/hangzhou/` |
| `user_account` | 用户账号/登录相关页 | `/web/user` 开头 |
| `boss_unknown` | BOSS 域名内，但未命中已知规则 | BOSS 域名下的其他页面 |
| `non_boss` | 非 BOSS 页面 | 非 `zhipin.com` 域名 |
| `invalid_url` | URL 无法解析 | URL 解析失败 |

补充说明：

- `isBossPage` 为 `true` 的 pageType 包括 `chat`、候选人相关页面、职位/数据/商城/外包页面、入口页、账号页和 `boss_unknown`。
- `non_boss` 和 `invalid_url` 都表示插件不应把它当作 BOSS 工作页面。
- 后端分析时，`pageType` 应按枚举字符串直接落库，未知值也要保留。

## 6. 事件类型枚举

`type` 当前对应 `EVENT_TYPES` 常量，枚举值如下：

| 值 | 含义 |
| --- | --- |
| `page_session.plugin_started` | 插件启动 |
| `page_session.boss_page_entered` | 进入 BOSS 页面 |
| `page_session.boss_page_left` | 离开 BOSS 页面 |
| `page_session.page_changed` | 页面切换 |
| `page_session.page_dwell_recorded` | 页面停留记录 |
| `page_session.plugin_exception` | 插件异常 |
| `job_context.detected` | 识别到当前职位上下文 |
| `job_context.changed` | 当前职位上下文变化 |
| `candidate_filter.panel_opened` | 候选人筛选面板打开 |
| `candidate_filter.applied` | 候选人筛选条件确认/应用 |
| `candidate_list.list_viewed` | 候选人列表曝光 |
| `candidate_list.card_exposed` | 候选人卡片曝光 |
| `candidate_detail.opened` | 候选人详情打开 |
| `candidate_detail.boss_analysis_viewed` | 候选人详情牛人分析模块曝光 |
| `candidate_detail.closed` | 候选人详情关闭 |
| `candidate_greeting.clicked` | 打招呼按钮点击 |
| `candidate_greeting.succeeded` | 打招呼成功 |
| `candidate_greeting.failed` | 打招呼失败 |
| `candidate_chat.opened` | 候选人聊天窗口打开 |
| `candidate_chat.snapshot_captured` | 候选人聊天文本快照已采集 |
| `candidate_chat.wechat_captured` | 已换微信候选人的微信信息已采集 |
| `candidate_chat.report_required` | 聊天列表已提示需要打开补采 |
| `candidate_chat.capture_failed` | 聊天采集异常 |
| `queue.write_failed` | 本地队列写入失败 |
| `upload.started` | 开始上传 |
| `upload.succeeded` | 上传成功 |
| `upload.failed` | 上传失败 |

说明：

- 当前实现已经定义了这些枚举；部分事件可能在后续阶段才真正发出。
- 后端应把 `type` 当成稳定分组键，不要把它映射成数字编码后丢掉原值。

## 7. 常见 payload 约定

下面是当前事件的主要 payload 结构，后端可以按这些字段建立索引或视图。

### 7.1 `page_session.page_changed`

```json
{
  "source": "pushState",
  "previousPageType": "candidate_recommend",
  "previousUrl": "https://www.zhipin.com/web/chat/recommend",
  "currentPageType": "chat",
  "currentUrl": "https://www.zhipin.com/web/chat/index"
}
```

- `source`: 触发来源，常见值为 `pushState`、`replaceState`、`popstate`、`hashchange`、`poll`。
- `previousPageType` / `previousUrl`: 切换前页面，用于还原路由跳转来源。
- `currentPageType` / `currentUrl`: 切换后页面；也会出现在事件根部 `context` 中。

### 7.2 `page_session.boss_page_entered` / `page_session.boss_page_left`

```json
{
  "source": "poll"
}
```

`boss_page_left` 会额外带上离开的 BOSS 页面：

```json
{
  "source": "pagehide",
  "leftPageType": "candidate_recommend",
  "leftPageUrl": "https://www.zhipin.com/web/chat/recommend"
}
```

- `source`: 触发来源。
- `leftPageType` / `leftPageUrl`: 只在离开事件里出现，用于在根部 `context` 已经变成非 BOSS 页面时保留离开前页面。

### 7.3 `page_session.page_dwell_recorded`

```json
{
  "dwellMs": 11999,
  "reason": "route:poll"
}
```

- `dwellMs`: 停留时长，毫秒。
- `reason`: 触发原因。

### 7.5 `page_session.plugin_exception`

```json
{
  "source": "poll",
  "message": "boom"
}
```

### 7.6 `job_context.detected` / `job_context.changed`

```json
{
  "source": "poll",
  "previous": {
    "jobId": "old-job",
    "jobIdSource": "url.jobid",
    "jobStatus": "0",
    "jobStatusSource": "url.status"
  },
  "current": {
    "jobId": "80ddfe02037b9e230nd-3d27FlRT",
    "jobIdSource": "url.jobid",
    "jobStatus": "0",
    "jobStatusSource": "url.status"
  }
}
```

- `job_context.detected`: 首次识别到当前职位上下文时发出，`previous` 为 `null`。
- `job_context.changed`: 当前职位 ID 或状态参数变化时发出。
- `jobId`: 当前职位 ID。第一版优先来自 URL 查询参数或 DOM dataset，例如 `jobid`、`jobId`、`encryptJobId`、`positionId`。
- `jobIdSource`: 职位 ID 来源，例如 `url.jobid` 或 `dataset.jobId`。
- `jobStatus`: URL 或 dataset 中可见的职位状态参数，识别不到时省略。
- `jobStatusSource`: 职位状态来源，识别不到时省略。
- `sourceUrl`、`confidence`、`updatedAt` 等识别诊断字段不进入正式 payload；岗位分析优先使用 `jobId` 和根部 `context.jobContext.jobId`。

识别成功后，后续事件的 `context.jobContext` 会携带同样结构。当前第一版不会从页面正文猜测职位名称，也不会采集职位描述正文。

### 7.7 `candidate_filter.panel_opened`

```json
{
  "source": "click",
  "listUrl": "https://www.zhipin.com/web/chat/recommend",
  "listPageType": "candidate_recommend",
  "filter": {
    "conditionCount": 0
  }
}
```

- `source`: 当前为 `click`。
- `listUrl` / `listPageType`: 筛选动作所在的候选人列表顶层页面。
- `filter.conditionCount`: 当前固定为 `0`。
- `filter.conditions`: 当前不在打开事件中输出。筛选摘要只在确认/应用事件中记录。

当前第一版只在候选人列表页及其同源 iframe 中监听“筛选 / 更多筛选 / 高级筛选 / 过滤”等短文本入口。事件不包含 `page`、`sourceUrl`、`actionText` 或完整面板文本。

### 7.8 `candidate_filter.applied`

```json
{
  "source": "click",
  "listUrl": "https://www.zhipin.com/web/chat/recommend",
  "listPageType": "candidate_recommend",
  "openedEventId": "evt_filter_opened",
  "filter": {
    "conditionCount": 7,
    "conditions": [
      "年龄: 18-35岁",
      "活跃度: 刚刚活跃",
      "性别: 女",
      "近期没有看过: 近14天没有",
      "是否与同事交换简历: 近一个月没有",
      "求职意向: 离职-随时到岗",
      "求职意向: 在职-考虑机会"
    ]
  }
}
```

- `openedEventId`: 10 分钟内同一列表页最近一次 `candidate_filter.panel_opened` 事件 ID；没有可关联打开事件时省略。
- `filter.conditionCount`: 当前确认动作可读到的有效短筛选摘要数量；没有可识别选中态时为 `0`。
- `filter.conditions`: 筛选面板中可识别为已选中的短条件摘要，最多 12 条，单条最长 48 个字符。

`candidate_filter.applied` 只在“确定 / 确认 / 应用 / 完成 / 搜索 / 查看结果”等动作出现在可识别筛选面板上下文里时发出，避免把普通搜索或其他确认动作误记为筛选。摘要优先来自 `aria-selected`、`aria-checked`、`aria-pressed`、`input:checked` 或常见 `selected/active/checked/current` 样式标记的控件；真实 BOSS 面板中只通过 chip 背景色标记已选项时，会按筛选字段行读取有明显选中背景的短选项，并补充可读到的年龄滑块范围。年龄滑块除普通文本和 `aria` / `data` / `value` 属性外，也会读取年龄行内滑块元素的 `::before` / `::after` 文本内容，因为真实页面可能用 CSS 伪元素渲染数值。如果真实页面没有可识别选中态，宁可输出 `conditionCount: 0`，也不把面板所有可见候选项当作已选条件。`关键词`、`关键字`、`搜索关键词`、`姓名`、`手机`、`电话`、`微信`、`联系方式` 等自由输入或敏感字段只记录为“已填写”，不保存原始值；手机号、邮箱会做脱敏兜底。

当前第一版会在探针内保留最近一次确认的筛选摘要，但尚未把筛选上下文写入候选人列表、详情或打招呼事件；后续待真机确认字段稳定后再接入跨事件上下文。

### 7.9 `candidate_list.list_viewed`

```json
{
  "source": "poll",
  "listUrl": "https://www.zhipin.com/web/chat/recommend",
  "listPageType": "candidate_recommend"
}
```

- `source`: 触发来源，当前常见值为 `start` 或 `poll`。
- `listUrl`: 候选人列表对应的顶层页面 URL。
- `listPageType`: 列表页面类型，当前第一版覆盖推荐、搜索、意向沟通和互动候选人页面。

### 7.10 `candidate_list.card_exposed`

```json
{
  "source": "poll",
  "listUrl": "https://www.zhipin.com/web/chat/recommend",
  "listPageType": "candidate_recommend",
  "candidate": {
    "stableId": "abc123",
    "stableIdSource": "url.geekId",
    "candidateId": "bo_candidate_url_geekid_abc123_k8s2p1",
    "exposureKey": "candidate_recommend:https://www.zhipin.com/web/chat/recommend:url.geekId:abc123",
    "detailUrl": "https://www.zhipin.com/web/chat/index?geekId=abc123",
    "profile": {
      "displayName": "吴先生",
      "salary": "7-8K",
      "age": 28,
      "experience": "7年",
      "education": "高中",
      "jobSeekingStatus": "离职-随时到岗",
      "activeStatus": "刚刚活跃",
      "expectedLocation": "杭州",
      "expectedPosition": "直播运营",
      "tags": ["经纪人+模特", "4年经纪经验"]
    }
  },
  "exposure": {
    "cardIndex": 0
  }
}
```

- `candidate.stableId`: 候选人可关联标识。优先来自 dataset 或详情链接；如果页面未暴露稳定 ID，则使用本地短指纹。
- `candidate.stableIdSource`: 标识来源，例如 `dataset.geekId`、`url.geekId` 或 `text_fingerprint`。
- `candidate.candidateId`: 由候选人稳定身份派生的确定性 ID，不使用本地递增序号；同一候选人跨扩展重载仍应生成同一个值。若页面没有暴露稳定候选人 ID，该值会退化为文本指纹派生 ID，不能当作跨页面永久身份。
- `candidate.exposureKey`: 由列表类型、列表 URL、候选人 ID 来源和值组成的曝光关联键，用于区分同一候选人在不同列表/页面里的曝光事实。
- `candidate.exposedEventId`: 后续详情/打招呼事件会从内存注册表继承已回写的卡片曝光事件 ID；卡片曝光事件自身不输出空值。
- `candidate.detailUrl`: 卡片内可识别的详情链接；没有时省略。
- `candidate.profile`: 从候选人卡片可见文本解析出的核心快照。当前包含姓名/称呼、薪资、年龄、经验、学历、求职状态、活跃状态、期望城市、期望岗位和少量短标签；识别不到的字段会省略。
- `exposure.cardIndex`: 本次扫描中的卡片顺序；无法识别时整个 `exposure` 可省略。
- `page`、`exposure.visibleRatio`、`exposure.textLength`、`exposure.matchedSignals` 等页面快照和诊断字段不进入正式 payload。

当前第一版不会把完整候选人卡片文本、完整优势描述、完整工作/教育经历正文写入 payload。后端应把 `stableId + stableIdSource + listUrl/sessionId` 作为曝光事实的关联线索，不要把短指纹解释为跨页面稳定身份。

### 7.11 `candidate_detail.opened`

```json
{
  "source": "poll",
  "detailUrl": "https://www.zhipin.com/web/chat/index?geekId=abc123",
  "detectedBy": "c_resume_frame",
  "candidate": {
    "candidateId": "bo_candidate_url_geekid_abc123_k8s2p1",
    "stableId": "abc123",
    "stableIdSource": "url.geekId",
    "exposureKey": "candidate_recommend:https://www.zhipin.com/web/chat/recommend:url.geekId:abc123",
    "exposedEventId": "evt_card_exposed",
    "detailUrl": "https://www.zhipin.com/web/chat/index?geekId=abc123",
    "profile": {
      "displayName": "吴先生",
      "salary": "7-8K",
      "age": 28,
      "experience": "7年",
      "education": "高中",
      "jobSeekingStatus": "离职-随时到岗",
      "activeStatus": "刚刚活跃",
      "expectedLocation": "杭州",
      "expectedPosition": "直播运营"
    },
    "detailProfile": {
      "topSummary": {
        "items": [
          "具备工作能力：普通话标准，善于与人沟通，工作经验丰富",
          "性格优点：吃苦耐劳，有坚持不懈的精神"
        ]
      },
      "bossAnalysis": {
        "title": "牛人分析器",
        "items": [
          "牛人 10小时前 更新过简历，其通常活跃时间为 2-6pm。求职意愿 较强",
          "受欢迎程度 较高，被沟通次数超过 55% 的同类牛人"
        ],
        "actionText": "查看全部8项分析"
      },
      "sectionKeys": ["jobExpectation", "advantage", "workExperience", "educationExperience"],
      "sections": {
        "jobExpectation": {
          "items": ["杭州 直播运营"]
        },
        "advantage": {
          "items": ["熟悉客户开发和私域运营"]
        },
        "workExperience": {
          "items": ["杭州某科技有限公司 网络销售 2021-2024"]
        },
        "educationExperience": {
          "items": ["浙江某大学 市场营销 本科"]
        }
      }
    }
  }
}
```

- `detailUrl`: 当前识别到的详情 URL。弹窗/抽屉场景无法识别时可能为空字符串。
- `detectedBy`: 当前常见值为 `detail_url`、`detail_dom`、`c_resume_frame`、`c_resume_selected_card`、`c_resume_recent_card`、`c_resume_matched_card`、`c_resume_canvas` 或 `c_resume_canvas_matched_card`。
- `candidate`: 与候选人卡片曝光共用候选人身份和 `profile` 快照结构。
- 当详情来自最近点击或当前选中的已曝光卡片时，`candidate` 会继承卡片曝光事件中的 `candidateId`、`exposureKey` 和 `exposedEventId`。这三个字段优先用于后端计算曝光点击率，详情 DOM/Canvas 解析失败不应阻断漏斗关联。
- 如果详情候选人与最近曝光卡片的核心 profile 冲突，插件会先按当前候选人的 `stableIdSource + stableId` 回连同一列表页里的精确曝光；仍无法命中时才不继承旧 `exposureKey/exposedEventId`，避免错连两个候选人。
- `candidate.profile`: 只写入识别到的核心候选人字段，空字符串、`null` 和空数组会被省略。
- `candidate.detailProfile`: 从详情页可见文本提取的受限结构化摘要。没有有效详情摘要时整个字段省略；普通 section 只保留有摘要条目的 `jobExpectation`、`advantage`、`workExperience`、`educationExperience`、`projectExperience`、`certificates` 等键。
- `page`、`detailPageType`、`detail.textSources`、`detail.matchedSignals` 等重复或诊断字段不进入正式事件 payload；页面上下文看事件根部 `context`。

当前第一版会把 `/web/frame/c-resume` 作为 BOSS 详情 iframe 的强识别信号；普通候选人列表文本不会仅凭多个卡片内容触发详情事件。详情页 DOM/辅助文本不可读时，插件会使用同一详情 frame 中短期捕获的 Canvas 可见渲染文字作为解析输入，但不会把完整 Canvas 文本或完整简历正文写入 payload。事件不会把完整简历正文、完整工作/教育经历正文、聊天内容、手机号或微信号写入 payload；详情摘要会过滤包含微信、手机号、电话、联系方式等关键词的行，并对手机号、邮箱做脱敏兜底。

### 7.12 `candidate_detail.boss_analysis_viewed`

```json
{
  "source": "poll",
  "detailUrl": "https://www.zhipin.com/web/frame/c-resume/?source=recommend",
  "detectedBy": "detail_dom",
  "candidate": {},
  "openedEventId": "evt_abc",
  "analysis": {
    "module": "boss_analysis"
  }
}
```

- `openedEventId`: 对应的 `candidate_detail.opened` 事件 ID。
- `analysis.module`: 当前固定为 `boss_analysis`。
- 事件类型本身表示模块被看见，不表示插件端认可 BOSS 的分析结论。

### 7.13 `candidate_detail.closed`

```json
{
  "source": "poll",
  "reason": "detail_disappeared",
  "detailUrl": "https://www.zhipin.com/web/chat/index?geekId=abc123",
  "candidate": {},
  "durationMs": 2500,
  "openedEventId": "evt_abc"
}
```

- `reason`: 关闭原因，当前常见值为 `detail_disappeared`、`candidate_switched` 或 `probe_stopped`。
- `durationMs`: 本次详情打开到关闭的毫秒时长，由 content script 本地计时，仅表示页面可观察到的打开时长。
- `openedEventId`: 对应 `candidate_detail.opened` 事件 ID；如果测试或异常环境无法返回事件 ID，可能为空字符串。

### 7.14 `candidate_greeting.clicked`

```json
{
  "source": "click",
  "entry": "candidate_list",
  "candidate": {
    "stableId": "abc123",
    "stableIdSource": "url.geekId",
    "detailUrl": "https://www.zhipin.com/web/chat/index?geekId=abc123"
  }
}
```

- `entry`: 当前识别到的打招呼入口，常见值为 `candidate_list`、`candidate_detail`、`chat` 或 `unknown`。
- `candidate`: 与候选人列表曝光/详情打开共用候选人身份和 `profile` 快照结构。
- 如果点击目标能关联到已曝光卡片，`candidate` 会携带同一组 `candidateId`、`exposureKey` 和 `exposedEventId`；结果事件会沿用 clicked 事件里的 `candidate`。
- `page`、`sourceUrl`、`greeting.actionLabel`、`greeting.targetKey`、`greeting.matchedSignals` 不进入正式 payload；点击和结果通过事件根部 ID 与结果事件的 `clickedEventId` 关联。

当前第一版监听顶层页面和同源 iframe 中的“打招呼”按钮/链接点击，不采集打招呼话术、聊天正文、完整简历正文、手机号或微信号。

### 7.15 `candidate_greeting.succeeded`

```json
{
  "source": "poll",
  "entry": "candidate_list",
  "clickedEventId": "evt_abc",
  "elapsedMs": 800,
  "candidate": {},
  "greeting": {
    "status": "succeeded",
    "detectedBy": "page_message"
  }
}
```

- `clickedEventId`: 对应 `candidate_greeting.clicked` 事件 ID。
- `elapsedMs`: 点击到观察到结果之间的毫秒数。
- `greeting.status`: 固定为 `succeeded`。
- `greeting.detectedBy`: 当前常见值为 `action_state` 或 `page_message`。

该事件只表示插件在页面上观察到成功提示或按钮状态变化，不在插件端判断触达质量、话术质量或后续转化。

### 7.16 `candidate_greeting.failed`

```json
{
  "source": "poll",
  "entry": "candidate_list",
  "clickedEventId": "evt_abc",
  "elapsedMs": 800,
  "candidate": {},
  "greeting": {
    "status": "failed",
    "detectedBy": "page_message"
  }
}
```

- `greeting.status`: 固定为 `failed`。
- `greeting.detectedBy`: 当前常见值为 `action_state` 或 `page_message`。

点击后短时间内如果没有观察到成功或失败提示，当前实现只丢弃 pending 状态，不会把“未观察到确认”写成失败事实。

### 7.17 `candidate_chat.opened`

```json
{
  "source": "poll",
  "chatPageUrl": "https://www.zhipin.com/web/chat/index",
  "candidate": {
    "candidateId": "bo_candidate_url_geekid_abc123_k8s2p1",
    "stableId": "abc123",
    "stableIdSource": "url.geekId",
    "identityConfidence": "high",
    "profile": {
      "displayName": "桂儿"
    }
  },
  "chat": {
    "conversationKey": "bo_candidate_url_geekid_abc123_k8s2p1"
  }
}
```

- 事件表示招聘专员打开了某个候选人的聊天窗口，不表示已经成功上传聊天快照。
- `candidate` 复用候选人列表、详情和打招呼模块的身份结构；聊天页只读到姓名时会使用低置信短指纹，并输出 `identityConfidence: "low"`。
- `chat.conversationKey` 是插件本地识别当前聊天窗口的键，优先使用 `candidateId`。重复打开同一候选人仍可再次产生打开事实。

### 7.18 `candidate_chat.snapshot_captured`

```json
{
  "source": "poll",
  "chatPageUrl": "https://www.zhipin.com/web/chat/index",
  "candidate": {},
  "chat": {
    "messageCount": 3,
    "firstMessageAt": "2026-05-12T12:54:00.000+08:00",
    "lastMessageAt": "2026-05-15T09:54:00.000+08:00",
    "lastMessageFingerprint": "msg_abc",
    "snapshotCompleteness": "visible_dom",
    "mayBeIncomplete": true,
    "mediaSummary": {
      "imageNodeCount": 2
    },
    "messages": [
      {
        "messageIndex": 0,
        "messageAt": "2026-05-12T12:54:00.000+08:00",
        "direction": "candidate",
        "text": "BOSS好，我对这份工作很感兴趣",
        "fingerprint": "msg_1"
      },
      {
        "messageIndex": 1,
        "messageAt": "2026-05-12T13:39:00.000+08:00",
        "direction": "recruiter",
        "status": "已读",
        "text": "你好，可以聊一聊啊",
        "fingerprint": "msg_2"
      }
    ]
  }
}
```

- 事件在打开或切换聊天窗口时尝试生成。插件端以本地成功上报水位判断是否提交：无水位、或本次快照 `chat.lastMessageAt` 晚于 `lastReportedMessageAt` 时进入上传流程；已经成功覆盖到最新消息时不重复提交。只有服务器返回成功后，background 才推进本地聊天上报水位。
- `chat.messages` 只包含当前聊天窗口已渲染、可读取的文本消息。图片、语音、附件 URL 和二进制内容不进入 payload。
- `chat.snapshotCompleteness` 当前固定为 `visible_dom`；`mayBeIncomplete: true` 表示插件没有自动滚动加载历史，不承诺完整覆盖所有历史消息。
- `chat.mediaSummary` 只记录媒体节点数量，不记录媒体地址。

### 7.19 `candidate_chat.wechat_captured`

```json
{
  "source": "snapshot",
  "chatPageUrl": "https://www.zhipin.com/web/chat/index",
  "candidate": {},
  "wechat": {
    "accounts": ["wxid_example"],
    "source": "chat_text",
    "detectedAtMessageAt": "2026-05-15T09:54:00.000+08:00",
    "detectedAtMessageFingerprint": "msg_abc"
  }
}
```

- 只在明确微信上下文中采集，例如页面显示已交换微信字段，或聊天文本包含“微信 / 微信号 / wx / wechat / vx / 加我微信”等上下文并带账号。
- 普通“换微信”按钮不触发该事件。
- 图片中的微信号不采集，除非 BOSS 页面已经转写成可见文本。

### 7.20 `candidate_chat.report_required`

```json
{
  "source": "chat_list",
  "chatPageUrl": "https://www.zhipin.com/web/chat/index",
  "candidate": {},
  "listItem": {
    "lastMessageAt": "2026-05-15T09:54:00.000+08:00",
    "lastMessageTimeText": "09:54",
    "lastReportedMessageAt": "2026-05-15T09:20:00.000+08:00"
  }
}
```

- 事件表示插件已经在聊天列表项上显示“今日聊天未上报，请点开补采”之类提示。
- 插件不会自动打开该会话，不会阻止员工操作。
- 列表只检查明显今天的时间文本，例如 `HH:mm`、`今天 HH:mm`、`刚刚`、`N分钟前`；`昨天`、旧日期和不确定文本会忽略。

### 7.21 `candidate_chat.capture_failed`

```json
{
  "source": "poll",
  "chatPageUrl": "https://www.zhipin.com/web/chat/index",
  "reason": "active_chat_not_found",
  "message": "No active chat panel detected"
}
```

- 记录聊天页面识别、候选人身份构造或快照读取异常。
- 该事件只用于排查采集链路，不代表员工操作失败。

## 8. 后端查询建议

后端最少应该支持按以下维度查询和导出：

- 日期
- `sessionId`
- `pageType`
- `context.jobContext.jobId`
- `event.type`
- `pluginVersion`
- `sourceTabId`
- `sourceWindowId`

如果后端要做后续分析，推荐保留：

- 原始 `events` 数组
- 原始 `context`
- 原始 `payload`
- 原始 `sourceTabUrl`

不要提前把“页面切换是不是有效”“是否值得分析”之类结论写回事实日志。

## 9. 兼容约定

- 新增 `event.type` 时，优先保持字符串前缀稳定。
- 新增 `pageType` 时，不要复用旧值表达不同语义。
- 后端需要接受未知枚举值并原样存储。
- 如果未来页面分类规则变化，应以代码中的当前实现和此文档为准；两者不一致时，优先以代码行为为准，并同步更新文档。

## 10. CLS 直传落地建议

当前选定方案是插件端直传腾讯云 CLS。插件仍然先写本地队列，再由 background service worker 批量上传到 CLS。

上传目标使用 CLS 匿名上传的 HTTP 入口：

```text
https://{region}.cls.tencentcs.com/tracklog?topic_id={topic_id}
```

请求体使用 JSON：

```json
{
  "logs": [
    {
      "contents": {},
      "time": 1778486643999
    }
  ],
  "source": "boss-observer-extension"
}
```

建议把一条插件事件映射成一条 CLS 日志，并采用扁平字段。

推荐字段如下：

| CLS 字段 | 来源 |
| --- | --- |
| `event_id` | `id` |
| `event_type` | `type` |
| `occurred_at` | `occurredAt` |
| `plugin_version` | `pluginVersion` |
| `session_id` | `context.sessionId` |
| `page_type` | `context.pageType` |
| `page_url` | `context.pageUrl` |
| `page_title` | `context.pageTitle` |
| `is_boss_page` | `context.isBossPage` |
| `job_id` | `context.jobContext.jobId` |
| `job_status` | `context.jobContext.jobStatus` |
| `source_tab_id` | `sourceTabId` |
| `source_window_id` | `sourceWindowId` |
| `source_tab_url` | `sourceTabUrl` |
| `payload_json` | `payload` 的 JSON 字符串 |
| `context_json` | `context` 的 JSON 字符串，可选 |

建议：

- `event_type`、`page_type`、`session_id`、`job_id`、`plugin_version`、`source_tab_id`、`source_window_id` 作为主要索引字段。
- `payload_json` 和 `context_json` 作为原始备份，不作为主要查询字段。
- 如果需要按事件附加字段检索，优先把该字段提到扁平列，不要依赖嵌套 JSON。
- 匿名直传要求 CLS 日志主题开启匿名上传；如果后续数据污染风险不可接受，再切回自建接收服务代理写入 CLS。
- 插件本地队列仍然保留，用于网络失败、CLS 临时不可用和 service worker 重启后的重试。

当前插件配置字段：

- `uploadEnabled`: 上传总开关。开发阶段默认 `false`，只保留本地队列和调试页日志；设为 `true` 后才会按上传目标 flush。
- `clsRegion`: CLS 地域，例如 `ap-guangzhou`。
- `clsTopicId`: CLS 日志主题 ID。
- `clsSource`: CLS `source` 字段，默认 `boss-observer-extension`。
- `uploadEndpoint`: 兼容旧的自建接收服务方案；当 `uploadEnabled` 为 `true` 且配置了 `clsRegion` 和 `clsTopicId` 时，优先走 CLS 直传。

当前本地默认值保留 CLS 目标，但默认关闭上传：

- `uploadEnabled = false`
- `clsRegion = ap-shanghai`
- `clsTopicId = 5407c0a7-3e37-4c45-a204-bf5d40f157a1`
