# 候选人详情模块详细设计

## 1. 模块定位

候选人详情模块用于记录招聘专员打开了哪些候选人的详情，以及详情页中的关键区域是否曝光。

该模块用于支撑后续分析招聘专员是否从列表进入详情、哪些候选人被进一步查看，以及详情查看行为与打招呼、回复、转化之间的关系。

## 2. 核心目标

- 记录候选人详情打开。
- 记录候选人详情关闭。
- 在候选人详情打开日志中记录“牛人分析”模块是否可见。
- 将职位、筛选、页面会话上下文附加到详情日志中。

## 3. 需要记录的日志

### 3.1 候选人详情打开日志

记录招聘专员打开某个候选人详情。

用于分析从列表曝光到详情打开的筛选行为。

### 3.2 候选人详情关闭日志

记录招聘专员关闭或离开候选人详情。

用于后续计算详情停留时间。

### 3.3 候选人详情牛人分析可见标记

记录候选人详情页中的“牛人分析”模块被展示。

当前不再单独发出 `boss_analysis_viewed` 或独立牛人分析曝光事件，而是把可见事实合并到 `candidate_detail.opened.payload.candidate.detailProfile.bossAnalysis` 和 `candidate_detail.opened.payload.analysis.module = "boss_analysis"` 中。该字段只表示页面上看到了 BOSS 展示的模块，不表示插件端认可或分析其结论。

## 4. 触发时机

- 点击候选人卡片进入详情时记录候选人详情打开日志。
- URL、弹窗、侧边栏或详情区域变化为某个候选人详情时记录候选人详情打开日志。
- 关闭详情弹窗、切换候选人、离开详情页时记录候选人详情关闭日志。
- 初次识别详情打开后，会短暂等待异步详情内容和“牛人分析”模块渲染；等待期内看见该模块时，把可见标记合并进本次详情打开日志。

## 5. 依赖上下文

候选人详情日志需要尽量带上：

- 页面会话上下文
- 当前职位上下文
- 当前筛选上下文
- 候选人可识别信息
- 详情打开来源

具体字段和候选人标识方式在真机验证后确定。

## 5.1 当前实现说明

当前第一版实现包含：

- `candidate_detail.opened`：检测到候选人详情处于打开状态时记录一次。
- `candidate_detail.closed`：详情消失、切换候选人或探针停止时记录一次关闭事实，并带上本次详情停留 `durationMs`。
- 支持从顶层详情 URL、同源 `/web/frame/c-resume` iframe 和可见详情 DOM 三类线索识别详情。
- 普通 `/web/chat/index` 聊天页不会扫描内联详情 DOM，避免把聊天页中的 profile/牛人分析样式面板误判为候选人详情；真实详情 URL 和 `/web/frame/c-resume` 详情 frame 仍会识别。
- 同源 iframe 会做有限深度递归扫描，用于覆盖推荐页内层 `/web/frame/recommend` 再嵌套 `/web/frame/c-resume` 的详情形态。
- `/web/frame/c-resume` 只作为详情打开位置线索；如果该 iframe 只有页面脚本或加载占位、没有可读候选人详情文本，探针不会直接发空详情事件。
- 对 `/web/frame/c-resume`、`/geek/detail`、`/resume/detail` 等候选人详情页，插件会在 main world 中短期捕获 Canvas `fillText` / `strokeText` 渲染的可见文字和坐标，并在 isolated content script 内按行还原；该文本只作为 DOM 文本为空时的内存兜底输入，不单独持久化完整简历正文。
- 推荐页场景下，如果 `c-resume` 详情 iframe 暂无可读详情文本，但推荐列表 DOM 中能识别当前选中候选人卡片，详情打开事件会使用该选中卡片的可见候选人基础信息作为兜底。
- 如果候选人详情来自最近点击或当前选中的已曝光卡片，详情打开/关闭事件会继承该候选人的 `candidateId`、`exposureKey` 和 `exposedEventId`，优先保证“曝光候选人 -> 详情打开”的漏斗关联稳定；牛人分析可见标记随详情打开事件一起继承这组候选人身份。
- 在 `c-resume` iframe 暂无可读详情文本、只能靠选中卡片兜底时，如果页面 selected 状态和最近真实点击的候选卡不一致，优先使用最近点击的候选卡关联，`detectedBy` 记为 `c_resume_recent_card`，避免 BOSS 虚拟列表或图片预览场景把详情错连到旧选中候选人。
- 选中卡片兜底只用于候选人基础 `profile`，不会从卡片文本提取 `detailProfile` section，避免把底部“热搜/相似经历/其他候选人”推荐卡片误写成当前候选人详情。
- 推荐页场景下，如果 `c-resume` 详情 iframe 自身没有姓名头部，但正文里的公司/岗位词能和左侧推荐列表某张候选人卡片明显重合，探针会把那张卡片作为候选人来源，`detectedBy` 记为 `c_resume_matched_card`。
- 如果 `c-resume` iframe 的 DOM 正文为空但 Canvas 捕获文本具备候选人详情信号，详情打开事件会使用该 Canvas 可见文本解析核心字段，`detectedBy` 记为 `c_resume_canvas`；如果同时与左侧卡片重合匹配，记为 `c_resume_canvas_matched_card`。
- 同一个候选人详情保持打开期间不会重复发出 opened；切换到另一个候选人时会先发出上一位的 closed，再发出新候选人的 opened。
- 初次识别到详情打开后，探针会短暂等待异步详情内容和“牛人分析”模块渲染，再把 `candidate_detail.opened` 写入队列；如果详情在等待期间消失、切换候选人或探针停止，会先立即写入 pending opened，再写入 closed 或完成清理，避免秒开秒关丢失打开事实。
- 对没有稳定候选人 ID 的详情，打开后的前 5 秒内如果只是详情文本继续异步加载，会更新内存中的详情快照，不额外发出 closed/opened。
- 如果 BOSS 先渲染了可识别但内容很浅的详情占位，随后加载出个人优势、工作经历、教育经历等核心详情项，探针会补发一次 `candidate_detail.opened`，避免用户真正打开详情时被早期占位状态静默吞掉。
- 当前第一版会把可见到的“牛人分析”信号合并进 `candidate_detail.opened.analysis.module = boss_analysis`，表示模块被看见，不保存完整分析正文，也不表示插件端认可 BOSS 的分析结论。

当前第一版详情识别仍是保守启发式：

- URL 命中 `candidate_detail` 页面类型时直接视为详情打开，例如 `/geek/detail`、`/resume/detail`、`/web/frame/c-resume` 或查询串包含 `geekId=`。
- DOM 详情区域需要同时包含候选人基础信号、至少两个详情段落信号和详情操作区信号。详情段落信号包括求职期望、自我评价、经历概览、工作经历、教育经历、项目经历、资格证书或牛人分析；详情操作区信号包括收藏、不合适、举报、转发牛人等。
- 普通候选人列表 iframe 不会仅凭多个候选人卡片文本触发详情打开。
- 普通聊天页不会仅凭候选人姓名、聊天资料卡片或“牛人分析”文案触发详情打开。
- TODO：继续在真实 BOSS 推荐、搜索、意向沟通页面确认详情形态和稳定选择器，必要时替换当前 DOM 文本启发式。

当前第一版候选人信息策略：

- 复用候选人列表卡片中的候选人身份和 `profile` 解析逻辑。
- 优先从详情 URL、dataset 或详情链接中提取 `geekId`、`resumeId`、`lid`、`securityId` 等稳定标识。
- 如果页面没有暴露稳定标识，则使用详情文本、详情 URL 和来源 URL 生成短指纹。
- `profile.displayName` 支持从详情头部的“姓名 + 活跃状态 + 年龄/薪资”文本中解析。
- 当详情头部不可读时，`profile.displayName` 也可以从左侧列表卡片匹配结果里继承。
- 当详情 DOM/Canvas 无法提供稳定候选人 ID，但本次详情能关联到已曝光卡片时，候选人身份优先继承曝光卡片的稳定 ID 和核心 `profile`；详情解析出的 `detailProfile` 仍按原过滤规则附加。
- 如果详情解析出的核心 `profile` 与最近曝光卡片冲突，会先尝试按当前候选人的 `stableIdSource + stableId` 回连同一列表页里的精确曝光；仍无法命中时才断开旧曝光关联，避免把两个候选人串成一个 `candidateId`。
- 文本读取除 `innerText` / `textContent` 外，也会读取局部详情 DOM 上的 `aria-label`、`title`、`alt` 和少量 `data-*` 文本属性，用于覆盖 canvas/wasm 渲染但辅助文本可见的详情内容。
- 如果详情正文由 canvas/wasm 渲染且 DOM/辅助文本不可读，Canvas 捕获只保留最近一次渲染 burst 的短期内存快照，按坐标还原成行后进入同一套详情解析、过滤和脱敏流程。
- `candidate.detailProfile.topSummary` 优先保存详情顶部概览里的“具备工作能力”“性格优点”等短句，这是当前最重要的详情信息之一；如果没有有效内容，整个 `detailProfile` 不写入正式事件。
- `candidate.detailProfile.bossAnalysis` 优先保存详情底部“牛人分析器”模块中的可见短句和“查看全部 N 项分析”入口文案，这是当前最重要的详情信息之一；该字段只记录 BOSS 页面展示事实，不代表插件端判断。
- `candidate.detailProfile.overview` 会保存 BOSS 详情顶部概览里的 `经历：...`、`院校：...` 等短摘要，避免这些概览文本混入求职期望 section。
- `candidate.detailProfile.sections` 会保存受限长度的详情摘要，当前包含 `jobExpectation`、`advantage`、`workExperience`、`educationExperience`、`projectExperience`、`certificates` 等 section，每个 section 最多保留 3 条、单条最多 160 字；空 section 不写入正式事件。
- 详情摘要会过滤推荐列表噪音、详情操作按钮文本、候选人姓名本身，以及微信号、手机号、电话、联系方式等直接联系信息；手机号、邮箱会做脱敏兜底。
- `detail.textSources`、`detail.matchedSignals` 等诊断字段只在内部用于判断，不进入正式事件 payload，避免 CLS 日志膨胀。
- 当前不保存完整简历正文、完整优势描述、完整工作/教育经历正文、聊天内容、手机号或微信号。

## 6. MVP 范围

MVP 需要完成：

- 能识别候选人详情打开。（已完成第一版）
- 能识别候选人详情关闭。（已完成第一版）
- 能识别“牛人分析”模块可见事实。（已合并到 `candidate_detail.opened.analysis.module`）
- 能将候选人详情日志与当前职位上下文一起记录。（职位上下文第一版已完成；筛选上下文待后续实现）

## 7. 真机验证点

- 候选人详情是新页面、弹窗、抽屉还是列表内联区域。
- 候选人详情打开是否一定来自列表点击。
- 同一详情区域是否会切换不同候选人。
- 关闭详情是否有明确动作或只能通过页面变化判断。
- “牛人分析”模块是否稳定存在，是否异步加载。
