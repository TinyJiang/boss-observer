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
- `productionStats`：各模块生产统计。这里的 `pendingCount` 是本地队列中尚未成功上传的事实事件数，不是“可见聊天列表中还没点开的候选人数”。
- `chatPendingCandidates`：popup 的“待上传聊天”本地-only名单，来自当前可见聊天列表与本地成功上报水位的比较，不写入 CLS。
- `networkDebug`：网络调试开关和最多 80 条请求摘要，不含 request/response body。内部 Debug 页的网络捕获可以保留更长的本地响应预览，但会按约 2MB 总预算裁剪，不进入下载 Profile。
- `recentEvents`：最多 1000 条最近事件摘要，不含聊天 `messages` 正文。后台仍只保留少量原始事件用于 raw debug，Profile 使用脱敏摘要历史来支持较长时间窗口排查。

## 4. 分析顺序

优先按下面顺序看：

1. `extension.version`：确认用户导出的是否是预期插件版本。
2. `runtime.config.uploadEnabled` 和 `runtime.config.uploadTargetType`：确认上传开关和目标是否正确。
3. `runtime.queueSize`、`runtime.upload.lastUploadResult`、`runtime.upload.lastUploadError`：判断是未上传、上传失败，还是已上传但本地状态未清。
4. `runtime.moduleHealth`：确认 popup 哪一类显示红色。
5. `runtime.chatPendingCandidates`：如果 popup 提示“待上传聊天”，先看这里列出的姓名、职位和列表最近消息时间。
6. `runtime.productionStats.modules.candidate_chat`：确认聊天模块的 produced/uploaded/failed/pending 事件数。聊天快照属于即时 flush 事件，上传成功很快时 `pendingCount = 0` 是正常状态。
7. `runtime.recentEvents`：按时间从新到旧查看 `candidate_chat.opened`、`candidate_chat.snapshot_captured`、`candidate_chat.wechat_captured` 和 `candidate_chat.capture_failed`。排查聊天正文上传时优先看 `candidate_chat.snapshot_captured` 的 `candidate.profile.displayName`、`chat.jobTitle`、`chat.messageCount`、`chat.lastMessageAt`、`chat.coverageLastMessageAt`、`chat.listObservedLastMessageAt`。
8. `runtime.networkDebug`：只有排查 BOSS 接口结构或候选人详情接口时才需要看；默认只用于确认请求类别、状态码和 URL 路径。

## 5. 常见判断

- `queueSize > 0` 且无 `lastUploadError`：可能还没到 flush 时机，或刚生成事件等待下一次上传。
- `queueSize > 0` 且有 `lastUploadError`：优先排查网络、CLS 匿名上传、topic 配置或 HTTP 状态。
- `lastUploadResult.status = 200`、`queueSize = 0`、`candidate_chat.pendingCount = 0`：表示本地没有滞留待上传聊天事件；这不代表 `chatPendingCandidates` 一定为空。待上传聊天名单是本地-only提示，不是正式事件队列。
- `snapshot_captured.chat.hasUncapturedListMessage = true`：说明用户手动从聊天列表打开时，列表显示的最新消息时间比详情 DOM 能解析到的最后一条文本更晚。此时本地水位使用 `coverageLastMessageAt` 判定补采完成，但聊天正文只代表详情 DOM 当时可见且可解析的文本。
- `chatPendingCandidates.items` 非空但 `productionStats.candidate_chat.pendingCount = 0`：说明前台提示有可点开补采的会话，但本地事件队列没有积压；点开对应候选人后应生成 `candidate_chat.snapshot_captured` 并即时上传。
- 看不到“待上传聊天人名”：先确认当前是否在聊天页、可见列表里是否有今天明确时间的会话，以及本地上报水位是否已经覆盖列表最近消息时间。
- `recentEvents` 没有目标事件：先确认 BOSS 页面是否注入、页面 URL 是否在 manifest 匹配范围内，以及插件是否刚重载清空了运行态。当前 Profile 摘要上限是 1000 条，如果高频页面连续运行很久，仍可能被后续事件挤出。

## 6. 隐私边界

Profile 可以包含候选人姓名、职位标题、候选人内部 ID、页面路径、事件时间和上传状态。这些字段用于排查状态同步问题。

Profile 不应包含：

- 聊天消息正文。
- 微信号、手机号、邮箱等联系方式明文。
- 网络请求或响应正文。
- 完整上传 endpoint 或完整 CLS topic id。
- 图片、语音、附件 URL 或二进制内容。

如果某次排查确实需要原始事件或聊天正文，只能由用户明确确认后，从内部 Debug 页面或 CLS 中单独提供目标事件，且只提供排查所需的最小片段。网络调试预览只用于人工排查接口结构，默认上限为单请求 1MB、总历史约 2MB；不要把它当作业务日志导出渠道。
