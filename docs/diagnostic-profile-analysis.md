# BOSS Observer 诊断 Profile 分析约定

## 1. 用途

诊断 Profile 用于真机出现异常时快速交接现场状态。用户在插件 popup 点击“下载Profile”后，会得到一个 `boss-observer-profile-*.json` 文件；AI 或开发者根据该文件判断插件当前执行过程、上传结果、popup 红绿状态和最近事件摘要。

该文件是排障资料，不是业务数据导出。它默认不包含聊天正文、网络请求/响应正文、微信号明文、手机号明文或完整 CLS topic id。

## 2. 采集方式

1. 保持问题发生后的 Chrome 和 BOSS 页面不要立刻关闭。
2. 点击浏览器工具栏里的 `BOSS Observer Stats`。
3. 点击 `下载Profile`。
4. 把下载得到的 `boss-observer-profile-*.json` 发给分析者。
5. 如果需要进一步人工查看原始状态，再点击 popup 中的 `打开Debug`，按分析者要求复制特定区域。

不要为了采集 Profile 去点击 BOSS 的业务按钮，例如打招呼、求简历、换电话、换微信、约面试、不合适或发送消息。

## 3. Profile 字段约定

顶层字段：

- `schemaVersion`：Profile 结构版本。分析脚本应先检查该字段。
- `generatedAt`：下载 Profile 的本地时间。
- `source`：固定为 `boss_observer_popup`。
- `extension`：插件名称和版本。
- `runtime`：本次排障最重要的运行状态。

`runtime` 关键字段：

- `queueSize`：当前本地队列大小。非 0 通常表示还有事件未上传或等待 flush。
- `lastFlushAt`：最近一次 flush 时间。
- `config`：脱敏后的配置摘要，只保留开关、批次、队列容量、CLS region、是否配置 topic 等。
- `upload.lastUploadResult`：最近上传成功结果，包括目标类型、HTTP 状态、批大小、上传时间。
- `upload.lastUploadError`：最近上传失败摘要，包括错误消息、发生时间、批大小。
- `moduleHealth`：popup 红绿状态的直接计算结果。
- `productionStats`：各模块生产统计和待补采聊天名单。
- `networkDebug`：网络调试开关和请求摘要，不含 request/response body。
- `recentEvents`：最近事件摘要，不含聊天 `messages` 正文。

## 4. 分析顺序

优先按下面顺序看：

1. `extension.version`：确认用户导出的是否是预期插件版本。
2. `runtime.config.uploadEnabled` 和 `runtime.config.uploadTargetType`：确认上传开关和目标是否正确。
3. `runtime.queueSize`、`runtime.upload.lastUploadResult`、`runtime.upload.lastUploadError`：判断是未上传、上传失败，还是已上传但本地状态未清。
4. `runtime.moduleHealth`：确认 popup 哪一类显示红色。
5. `runtime.productionStats.unreportedChats`：如果聊天记录红色，先看这里列出的姓名、职位、最近消息时间和 `reportRequiredEventId`。
6. `runtime.recentEvents`：按时间从新到旧对比 `candidate_chat.report_required` 和 `candidate_chat.snapshot_captured`，重点看 `candidate.candidateId`、`candidate.profile.displayName`、`listItem.jobTitle`、`chat.jobTitle`、`listItem.lastMessageAt`、`chat.lastMessageAt`、`chat.coverageLastMessageAt`、`chat.listObservedLastMessageAt`。
7. `runtime.networkDebug`：只有排查 BOSS 接口结构或候选人详情接口时才需要看；默认只用于确认请求类别、状态码和 URL 路径。

## 5. 常见判断

- `queueSize > 0` 且无 `lastUploadError`：可能还没到 flush 时机，或刚生成事件等待下一次上传。
- `queueSize > 0` 且有 `lastUploadError`：优先排查网络、CLS 匿名上传、topic 配置或 HTTP 状态。
- `lastUploadResult.status = 200` 但聊天仍红：对比 `report_required` 和 `snapshot_captured` 的姓名、职位和消息时间，判断是否身份 key 未匹配或快照时间未覆盖。
- `snapshot_captured.chat.hasUncapturedListMessage = true`：说明用户手动从聊天列表打开时，列表显示的最新消息时间比详情 DOM 能解析到的最后一条文本更晚。此时本地水位使用 `coverageLastMessageAt` 判定补采完成，但聊天正文只代表详情 DOM 当时可见且可解析的文本。
- 待补采列表出现日期、职位分组、按钮文案：说明聊天列表 DOM 解析误判，应回到 `recentEvents` 找到对应 `report_required` 的 `listItem.displayName` 和原页面结构。
- `recentEvents` 没有目标事件：先确认 BOSS 页面是否注入、页面 URL 是否在 manifest 匹配范围内，以及插件是否刚重载清空了运行态。

## 6. 隐私边界

Profile 可以包含候选人姓名、职位标题、候选人内部 ID、页面路径、事件时间和上传状态。这些字段用于排查状态同步问题。

Profile 不应包含：

- 聊天消息正文。
- 微信号、手机号、邮箱等联系方式明文。
- 网络请求或响应正文。
- 完整上传 endpoint 或完整 CLS topic id。
- 图片、语音、附件 URL 或二进制内容。

如果某次排查确实需要原始事件或聊天正文，只能由用户明确确认后，从内部 Debug 页面或 CLS 中单独提供目标事件，且只提供排查所需的最小片段。
