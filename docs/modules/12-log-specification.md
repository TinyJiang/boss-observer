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
- `startedAt`: 会话开始时间，ISO 8601 字符串，使用本地时区偏移格式。

说明：

- `context` 表示“采集当下”的页面快照，不保证和 `payload` 内的历史页对象一致。
- `context.pageUrl` / `context.pageType` 适合做分析维度。
- `context.pageTitle` 只作为辅助信息，不建议作为主键。

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
| `candidate_detail` | 候选人详情页 | `/geek/detail`、`/resume/detail`，或查询串包含 `geekId=` |
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
  "previous": {},
  "current": {},
  "previousTitle": "BOSS直聘",
  "currentTitle": "BOSS直聘"
}
```

- `source`: 触发来源，常见值为 `pushState`、`replaceState`、`popstate`、`hashchange`、`poll`。
- `previous` / `current`: 切换前后的页面分类对象，结构来自 `classifyPage(url)`。

### 7.2 `page_session.boss_page_entered` / `page_session.boss_page_left`

```json
{
  "page": {},
  "source": "poll"
}
```

- `page`: 进入或离开时的页面分类对象。
- `source`: 触发来源。

### 7.3 `page_session.page_dwell_recorded`

```json
{
  "page": {},
  "dwellMs": 11999,
  "reason": "route:poll"
}
```

- `page`: 停留发生时对应的页面对象。
- `dwellMs`: 停留时长，毫秒。
- `reason`: 触发原因。

### 7.5 `page_session.plugin_exception`

```json
{
  "source": "poll",
  "message": "boom",
  "stack": "..."
}
```

## 8. 后端查询建议

后端最少应该支持按以下维度查询和导出：

- 日期
- `sessionId`
- `pageType`
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
| `source_tab_id` | `sourceTabId` |
| `source_window_id` | `sourceWindowId` |
| `source_tab_url` | `sourceTabUrl` |
| `payload_json` | `payload` 的 JSON 字符串 |
| `context_json` | `context` 的 JSON 字符串，可选 |

建议：

- `event_type`、`page_type`、`session_id`、`plugin_version`、`source_tab_id`、`source_window_id` 作为主要索引字段。
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
