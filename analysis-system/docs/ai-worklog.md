# AI 开发工作日志

这个文件记录分析系统子项目的 AI 编码任务运行状态，用于中断续写和多人协作。

规则：

- 开始任何实质工作前，先追加任务开始记录。
- 每完成一个可交接阶段，立即追加阶段记录。
- 不等任务结束才总结。
- 记录当前事实，不写宣传式总结。
- 如果日志和实际代码不一致，接手者以代码和 `git diff` 为准，并在本文件记录差异。
- 本日志只描述 `analysis-system/` 内的工作；父项目日志只作为历史参考。

## 记录模板

### 任务：简短标题

- 时间：YYYY-MM-DD HH:mm
- 执行者：AI / 人类 / 具体工具名
- 状态：计划中 / 实现中 / 待验证 / 验证失败 / 已完成 / 阻塞
- 目标：
- 当前理解：
- 计划修改文件：
- 不修改范围：
- 验证计划：
- 下一步：

#### 阶段记录：简短阶段名

- 时间：YYYY-MM-DD HH:mm
- 状态：
- 已完成：
- 改动文件：
- 验证结果：
- 风险/阻塞：
- 中断续写入口：

## 当前任务

### 任务：排查详情重复是否为采集侧过报

- 时间：2026-05-19 17:40
- 执行者：AI
- 状态：已完成
- 目标：用户反馈当事人确认没有重复打开候选人的习惯，需要从原始日志进一步分析 `shenlingnuo` 详情重复打开的蛛丝马迹，判断更像人工重复操作还是采集侧重复识别/过报。
- 当前理解：此前 raw 显示详情打开次数远高于候选人去重数，分钟级去重可从 372 降到 253，当日去重为 96。现在需要看事件序列、open/close 配对、同候选人间隔、detectedBy/source/detailUrl/session 等特征。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改运行时代码、SQL 或云端配置
  - 不修改 `analysis-system/` 之外文件
  - 不打印候选人姓名、简历正文、聊天正文、联系方式或完整 URL 中的敏感参数
- 验证计划：只读查询 raw topic 今天 `candidate_detail.opened/closed`，按候选人、秒级间隔、open-close 配对、payload 来源字段、session/tab/job 分布聚合，输出脱敏统计。
- 下一步：若要修复，应回到插件端 `candidate_detail.opened` 的幂等保护，避免同一详情未关闭前因 poll/canvas 匹配再次发 opened；分析系统侧保留打开次数并新增去重口径。

#### 阶段记录：完成重复详情蛛丝马迹分析

- 时间：2026-05-19 17:43
- 状态：已完成
- 已完成：只读查询今天 `shenlingnuo/沈女士` raw topic 中 `candidate_detail.opened/closed`，分析 open/close 配对、同候选人连续 open 间隔、detectedBy/source/detail path/session 分布。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：今天 raw 当前 `opened=372`、`closed=275`、候选人去重 `96`、涉及 `91` 个分钟。所有 opened 的 `source` 均为 `poll`；`detectedBy` 主要是 `c_resume_canvas_matched_card=324`，其次 `c_resume_recent_card=34`、`c_resume_canvas=11`；`detail_path` 370 条是 `/web/frame/c-resume/`；全部 372 条位于同一个 page session。相同候选人相邻 open 对共 276 对，其中 132 对在 30 秒内、59 对在 10 秒内、28 对在 5 秒内。进一步看 matching close，86 次出现“下一条同候选人 open 发生在上一条 open 的 matching close 之前，或上一条没有 matching close”，最短间隔大量集中在约 1.9 到 2.0 秒，符合 poll 重复识别特征。
- 风险/阻塞：raw 只能证明强相关特征，不能直接还原用户真实鼠标动作；但 `source=poll`、2 秒级重复、未 close 前再次 open、同一 session/iframe/canvas matcher 高度集中，已经更像采集侧过报，而不是用户主动重复打开同一候选人。
- 中断续写入口：下一步若实现修复，先检查父项目插件 `candidate_detail.opened` 的当前详情会话状态、candidate key 比较和 close 清理条件，重点看 canvas 匹配/最近卡片回连路径是否绕过了已打开去重。

### 任务：估算分钟级详情去重效果

- 时间：2026-05-19 17:32
- 执行者：AI
- 状态：已完成
- 目标：按用户问题，估算如果把 `candidate_detail.opened` 改成分钟级按候选人去重，`shenlingnuo` 今日详情数会从当前打开次数降低到多少。
- 当前理解：summary 当前只保存每分钟事件次数，不含候选人 identity key，不能从 summary 精确推导分钟级去重；需要从 raw 只读排障按 `operator + minute + candidate key` distinct 计算，或用 profile 最近窗口做局部估算。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改运行时代码、SQL 或云端配置
  - 不修改 `analysis-system/` 之外文件
  - 不打印候选人正文、聊天正文、联系方式或完整简历正文
- 验证计划：优先从 raw SearchLog 今天事件按分钟/候选人去重计算；若 raw 不可用，则用已读 profile 最近窗口和上轮 raw 汇总给出区间估算，并明确误差来源。
- 下一步：如果要落地实现，新增日级/分钟级 distinct 指标，不覆盖现有 `detail_opened` 打开次数口径。

#### 阶段记录：完成分钟级去重估算

- 时间：2026-05-19 17:38
- 状态：已完成
- 已完成：通过 raw topic 只读排障，按 `operator_account_name=沈女士`、今天自然日、`candidate_detail.opened` 计算三种口径：原始打开次数、`minute + candidate key` 去重后分钟候选人数求和、当日候选人去重数。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：当前 raw 详情打开次数为 372；分钟级候选人去重后为 253，降低 119，降幅约 32.0%；当日候选人去重为 96。候选人 key 缺失为 0。重复最重的分钟包括 `15:31` 从 9 降到 3、`12:06` 从 8 降到 3、`17:17` 从 10 降到 5。
- 风险/阻塞：这是随用户继续操作实时增长的 today 快照，不是固定结算数；分钟级去重仍会把同一候选人跨分钟重复打开计为多次，所以不能替代当日去重漏斗。
- 中断续写入口：如继续实现 SQL，先决定字段命名：`detail_opened` 保留次数，新增 `detail_minute_unique_candidates` 和 `detail_daily_unique_candidates` 或对应日级任务字段。

### 任务：用本地 profile 验证 shenlingnuo 口径

- 时间：2026-05-19 17:12
- 执行者：AI
- 状态：已完成
- 目标：读取用户提供的本地 profile `/Users/tiny/Downloads/boss-observer-profile-0.1.1-2026-05-19T17-10-14-462+08-00.json`，对比插件端本地记录、summary 和 raw 排障结果，验证 `shenlingnuo` 卡片曝光少于详情打开的原因。
- 当前理解：上一轮 raw/summary 已确认今天 `candidate_detail.opened` 是打开次数，明显多于按候选人曝光事实记录的 `candidate_list.card_exposed`。本轮需要确认本地 profile 是否也呈现同样口径、是否存在上传队列未传/事件缺失/跨日残留。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改运行时代码或云端 CLS 配置
  - 不打印候选人正文、聊天正文、联系方式或完整简历正文
- 验证计划：只读解析 profile 的事件类型、时间范围、操作员、上传队列状态、候选人去重数、详情重复分布和 card/detail 关联字段，再与上一轮 raw/summary 统计对比。
- 下一步：如果继续优化展示，应新增“详情去重候选人数”或“有卡片来源的详情打开”指标，避免把详情打开次数误解为候选人数。

#### 阶段记录：完成 profile 对比验证

- 时间：2026-05-19 17:18
- 状态：已完成
- 已完成：解析本地 profile 诊断快照。profile 生成于 `2026-05-19T17:10:14+08:00`，上传队列为 0，最近一次上传 `2026-05-19T17:08:58+08:00` 成功，模块 pending 均为 0。`recentEvents` 仅保留最近 50 条，时间范围 `17:04:17` 到 `17:08:58`，全部为 `shenlingnuo`；其中 `candidate_detail.opened=27`、`candidate_detail.closed=19`、`candidate_list.card_exposed=1`、`candidate_greeting.clicked=1`、`candidate_greeting.succeeded=1`。27 条详情打开只覆盖 9 个候选人指纹，最多的同一候选人在该窗口内打开 12 次；23 条详情带 `exposureKey` 或 `exposedEventId`，说明多数能回连卡片曝光。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：只读拉取 summary topic 对比，`17:04` 到 `17:08` 分钟汇总分别为详情 `6/6/4/2/9`、卡片 `1/0/0/0/0`，与 profile 最近事件完全对齐；随后 summary 继续出现 `17:10`、`17:11`、`17:15` 到 `17:18` 的详情打开，说明用户本机仍在继续产生详情打开事实。结论维持：异常不是上传缺失或 summary 放大，而是 `detail_opened` 是每次详情打开，`card_exposed` 是列表卡片曝光事实，同一候选人重复打开会让详情次数显著高于卡片数。
- 风险/阻塞：profile 的 `productionStats` 是模块累计计数，不按自然日也不细分 opened/closed，不能直接拿来和今日 summary 总数逐项相等对比；应只用于上传健康和模块相对量级判断。
- 中断续写入口：如需进一步证明候选人去重口径，下一步需要从 raw 侧按 `candidateId/stableId/exposureKey` 做今天全量去重统计，并把去重结果做成 API 指标。

### 任务：排查 shenlingnuo 卡片少于详情

- 时间：2026-05-19 16:29
- 执行者：AI
- 状态：已完成
- 目标：按用户截图，排查 `shenlingnuo` 今日单人明细中卡片曝光 56、详情打开 231、后台路径 245，为什么详情明显多于卡片。
- 当前理解：截图显示当前已使用 today 窗口，问题不再是跨日，而是同一天内 `candidate_detail.opened` 显著多于 `candidate_list.card_exposed`。需要从当前 API、summary 分钟汇总和必要的 raw 只读排障确认原因：是卡片曝光采集/去重少、详情重复打开多、chat/recommend 路径不同，还是 summary SQL 口径错误。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改运行时代码或云端 CLS 配置，除非确认是展示/汇总口径 bug
  - 不把 raw SearchLog 接入生产链路
  - 不打印聊天正文、联系方式或完整简历正文
- 验证计划：读取当前 `/api/operator/shenlingnuo`；按分钟/job 拆 summary；用 raw SearchLog 只读查询今天 `candidate_list.card_exposed`、`candidate_detail.opened`、`candidate_chat.opened` 的事件数、分钟分布、candidate 去重和 payload/source/detectedBy 摘要；对比 summary 与 raw，给出归因。
- 下一步：如需让漏斗顺序更符合业务直觉，后续新增“详情去重候选人数/有卡片来源的详情”指标，而不是把现有打开次数直接与卡片曝光次数比较。

#### 阶段记录：完成 raw 与 summary 对比

- 时间：2026-05-19 17:04
- 状态：已完成
- 已完成：查询当前 API、summary 分钟汇总和 today 窗口 raw 事件。summary 与 raw 基本一致，`shenlingnuo` 今天原始事件为 `candidate_list.card_exposed=62`、`candidate_detail.opened=236`、`candidate_chat.opened=14`；summary 聚合得到同量级结果，说明不是前端或单人汇总凭空放大。详情打开 236 条只覆盖 57 个候选人指纹，卡片曝光 62 条覆盖 62 个候选人指纹，核心原因是卡片曝光按候选人曝光事实记录，而详情打开按每次打开事实记录，同一个候选人多次打开会重复计入详情。详情事件中 206 条带 `exposureKey`/`exposedEventId`，`detectedBy` 主要为 `c_resume_canvas_matched_card`，说明多数详情仍可回连卡片，不是脱离列表的异常来源。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：只读排障，无运行时代码修改；使用 raw SearchLog 仅作本地开发排障，未接入生产链路。抽样聚合显示 12 点有 `detail_opened=75` 但 `card_exposed=0`，15 点有 `detail_opened=27` 但 `card_exposed=0`，符合“已曝光候选人被反复打开详情”的口径差异。
- 风险/阻塞：当前分钟 summary 不包含按候选人去重后的详情人数，也不包含 card->detail 去重转化数；如果业务需要漏斗严格满足“卡片 >= 详情”，需要在 summary SQL/API 中新增去重指标。
- 中断续写入口：若继续实现展示优化，从 `boss_minute_operator_funnel` 增加候选人去重口径开始，或先在前端把现有标签明确为“卡片曝光次数”和“详情打开次数”。

### 任务：将 CLS 读取窗口改为当天 0 点至当前

- 时间：2026-05-19 10:40
- 执行者：AI
- 状态：实现中
- 目标：按用户指出，修正固定 `1440` 分钟滚动窗口的问题；分钟 summary、日级 summary 和数据质量读取默认应从 `APP_TIMEZONE` 当天 00:00 到当前时间，而不是最近 24 小时。
- 当前理解：固定 `1440` 会在上午把昨天上午之后的数据带入今天，之前虽在单人明细聚合层过滤了本地自然日，但源读取窗口、source detail 和配置文档仍表达为滚动 24 小时，容易继续造成跨日混淆。需要改成显式 `today` 窗口，同时保留数字分钟窗口用于临时调试。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `.env.example`
  - `.env.local`
  - `README.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
  - `src/boss_analysis/consumer/cls_search.py`
  - `src/boss_analysis/dev_data.py`
  - `tests/test_cls_search.py`
  - `tests/test_summary_reader.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改云端 CLS 定时 SQL 或 Topic 配置
  - 不把 raw SearchLog 接入生产链路
- 验证计划：补充 SearchLog payload 单元测试，确认 `today` 模式 From 为当天本地 00:00；运行相关 Python 测试、全量测试和前端 build；用真实 summary 只读 smoke 校验 source detail 变成 `window=today:Asia/Shanghai` 且不读昨天。
- 下一步：完成测试和真实 summary smoke。

#### 阶段记录：完成 today 窗口修正

- 时间：2026-05-19 10:45
- 状态：已完成
- 已完成：新增 `ClsSearchConfig.window_mode` 和 `timezone_name`，支持 `CLS_*_WINDOW_MINUTES=today`；`build_search_payload()` 在 today 模式下按 `APP_TIMEZONE` 的当天 00:00 生成 `From`，`To` 仍为当前时间。将 `.env.example`、`.env.local`、README 和 CLS Topic 文档中的 summary/daily/log-quality 窗口默认值从 `1440` 改为 `today`；保留数字分钟窗口作为调试覆盖。`dev_data` source detail 改为显示 `window=today:Asia/Shanghai`。
- 改动文件：
  - `.env.example`
  - `.env.local`
  - `README.md`
  - `docs/ai-worklog.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
  - `src/boss_analysis/consumer/cls_search.py`
  - `src/boss_analysis/dev_data.py`
  - `tests/test_cls_search.py`
  - `tests/test_summary_reader.py`
- 验证结果：`PYTHONPATH=src python3 -m unittest tests.test_cls_search tests.test_summary_reader tests.test_dev_data tests.test_query_service tests.test_dev_server` 通过，61 tests；`PYTHONPATH=src python3 -m unittest discover tests` 通过，106 tests；`npm run build` 在 `frontend/` 通过。真实 summary 只读 smoke 显示 `window_label=today:Asia/Shanghai`，`From=2026-05-18T16:00:00+00:00`（北京时间 `2026-05-19 00:00`），当前只读到 `2026-05-19T10:06:00+08:00` 的 2 条 summary。
- 风险/阻塞：尝试 `./restart.sh` 后工具环境未保持后台进程，Vite 日志显示后端连接被拒绝；需要用户在普通终端手动执行 `./restart.sh`，或后续授权/使用更稳定的守护方式启动。
- 中断续写入口：如页面仍显示旧数据，先确认服务已从当前代码重启，并查看 `/api/dashboard` 的 `summary_source.detail` 是否包含 `window=today:Asia/Shanghai`。

### 任务：修正单人明细跨日混入

- 时间：2026-05-19 10:35
- 执行者：AI
- 状态：实现中
- 目标：修正用户截图中 shenlingnuo 单人明细把昨天滚动 1440 分钟 summary 带入今天数据的问题。
- 当前理解：`daily_active_duration` 已按最新本地自然日聚合，所以顶部显示今天 `1分`；但 `operator_analytics()` 当前对操作员直接使用全部 `_minute_summaries`，导致漏斗、条形图和分钟趋势跨日混入昨天数据。需要让 summary 单人明细与当日活跃使用同一 `Asia/Shanghai` 自然日边界。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/api/query_service.py`
  - `tests/test_query_service.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改云端 CLS 配置或 summary 读取窗口
  - 不把 raw SearchLog 接入生产链路
- 验证计划：新增/更新 query service 单元测试，覆盖同一操作员跨日 summary 时单人明细只聚合最新本地自然日；运行相关 unittest，必要时查询本机 API 验证 shenlingnuo 不再显示昨天趋势。
- 下一步：调整 `operator_analytics()` 的 summary 过滤逻辑。

#### 阶段记录：完成跨日过滤修复

- 时间：2026-05-19 10:39
- 状态：已完成
- 已完成：修正 `AnalysisQueryService.operator_analytics()`，在使用分钟 summary 生成单人明细前先确定目标本地自然日；优先使用该操作员的 `daily_active_duration.active_date`，否则使用当前 summary 的最新本地日期。单人漏斗、条形图和分钟趋势现在只聚合目标日记录，避免滚动 1440 分钟窗口把昨天数据带到今天。新增单元测试覆盖同一操作员跨日 summary 的场景。
- 改动文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/api/query_service.py`
  - `tests/test_query_service.py`
- 验证结果：`PYTHONPATH=src python3 -m unittest tests.test_query_service tests.test_dev_server` 通过，27 tests；`npm run build` 在 `frontend/` 通过；真实 summary 只读校验 `shenlingnuo` 当前只保留 `2026-05-19 10:06` 这一分钟，漏斗为卡片 0、详情 0、后台近似 0、打招呼 0、聊天快照 1、微信 0，不再包含昨天 `15:59` 起的 84/134/135。
- 风险/阻塞：尝试执行 `./restart.sh` 重启本机 dev 服务未获授权，因此当前浏览器里的已运行服务可能仍是旧代码；需要用户手动重启或授权后再刷新页面。
- 中断续写入口：如用户授权重启，执行 `./restart.sh` 后刷新前端；若仍看到跨日数据，检查浏览器访问的端口是否是当前 worktree 的服务。

### 任务：排查后台口径查看详情显示 212

- 时间：2026-05-18 23:10
- 执行者：AI
- 状态：实现中
- 目标：排查用户看到“后台口径查看详情”为 212，而前面 raw 排障曾计算 `candidate_detail.opened + candidate_chat.opened = 259` 的原因。
- 当前理解：前端改动使用当前 summary/API 中的 `detail_opened + chat.chat_opened` 计算近似后台口径；此前 259 来自 raw SearchLog 按账号名只读排障查询，且包含 summary 缺失的早段详情和 raw 中更多聊天打开。需要确认当前 API 数值、summary 字段、是否存在刷新/口径/数据源差异，并给出修正建议。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - 如需要修正显示说明，可能涉及 `frontend/src/App.tsx`、`frontend/src/types.ts`、`src/boss_analysis/api/query_service.py`、`src/boss_analysis/dev_server.py`、相关测试
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改云端 CLS 配置
  - 不把 raw SearchLog 接入生产链路
  - 不打印密钥、聊天正文、联系方式或完整简历正文
- 验证计划：读取当前 API 返回值、summary 记录加总和必要的 raw 排障计数；确认 212 的公式来源；如需改动展示，补充测试并运行前后端验证。
- 下一步：查询当前 `/api/operator/zhouxinyu` 和 summary 分项。

#### 阶段记录：完成 212 来源排查

- 时间：2026-05-19 10:34
- 状态：已完成
- 已完成：确认当前 `/api/operator/zhouxinyu` 返回 `funnel.detail_opened=134`、`chat.chat_opened=78`，前端“后台口径”显示 `134 + 78 = 212`。当前 summary 主题中 `zhouxinyu` 有 112 行，漏斗 80 行、聊天 32 行，时间覆盖 `2026-05-18 12:38` 到 `22:56`。raw 开发排障同窗口按账号名查询为 `candidate_detail.opened=151`、`candidate_chat.opened=82`，合计 233；其中 summary 缺 `17` 条详情，集中在 `12:35-12:38`，缺 `4` 条聊天打开，集中在 `12:22`、`12:30`、`12:40`。此前提到的 259 是当时 raw 1440 分钟窗口的结果，包含 `2026-05-17 23点` 的 30 条聊天打开；当前滚动窗口已不包含这 30 条，同时新增 `2026-05-18 22点` 的 4 条详情，因此当前 raw 合计变为 233。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：完成本机 API 只读校验、CLS summary 只读查询、CLS raw SearchLog 开发排障查询；未修改运行时代码或云端配置。
- 风险/阻塞：前端当前显示的是 summary 近似口径，不是 raw 排障口径；summary 早段缺口需要通过 summary 回填或新增专门日级/后台口径汇总解决，不能在生产页面直接读取 raw SearchLog。
- 中断续写入口：如需让页面显示接近 raw/BOSS 后台的数值，应新增或回填批准的 summary 指标，例如日级 `boss_like_detail_viewed = candidate_detail.opened + candidate_chat.opened`，并固定自然日窗口。

### 任务：数据质量真实数据配置和独立 Tab

- 时间：2026-05-18 22:40
- 执行者：AI
- 状态：已完成
- 目标：按用户要求，后续默认不再启动 demo，直接对接线上真实汇总数据；把数据质量接到单独指标集配置，并在前端新增独立数据质量 tab，支持按操作员 ID 与插件版本查询。
- 当前理解：`.env.local` 已设置 `BOSS_ANALYSIS_DATA_SOURCE=summary` 和 `BOSS_ANALYSIS_REQUIRE_REAL_DATA=1`，需要补齐独立数据质量指标集的 `CLS_LOG_QUALITY_*` 配置段；前端当前只是把数据质量放在大盘底部，需要改成导航 tab，并提供 `operator_id` 与 `plugin_version` 查询条件。后端需要提供可按条件过滤 10 分钟质量汇总的 API，避免前端只能看全局聚合。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `.env.local`
  - `.env.example`
  - `dev.sh`
  - `README.md`
  - `docs/modules/06-log-health-probe.md`
  - `src/boss_analysis/domain/metrics.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/api/query_service.py`
  - `src/boss_analysis/dev_server.py`
  - `frontend/src/api.ts`
  - `frontend/src/types.ts`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `tests/test_query_service.py`
  - `tests/test_dev_server.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实腾讯云 CLS 资源或定时 SQL
  - 不接入生产 raw CLS Search/SearchLog
  - 不展示或输出 `.env.local` 中的密钥
- 验证计划：补充后端过滤 API 和前端类型相关测试；运行相关 Python unittest、全量 unittest 和前端 build；不启动 demo 服务。
- 下一步：把 `.env.local` 中 `CLS_LOG_QUALITY_TOPIC_ID` 补成用户新建的数据质量指标集/主题 ID 后，刷新前端“数据质量”tab 即可按操作员 ID 和插件版本查询。

#### 阶段记录：完成数据质量 tab 和过滤接口

- 时间：2026-05-18 22:54
- 状态：已完成
- 已完成：在 `.env.local` 和 `.env.example` 增加独立 `CLS_LOG_QUALITY_*` 配置段，并设置 `BOSS_ANALYSIS_NO_DEMO=1`；`dev.sh` 默认传 `--no-demo`，避免自动 fallback demo；新增 `LogQualityQueryResult` 和 `AnalysisQueryService.log_quality()`，支持按 `operator_id`、`plugin_version` 过滤 10 分钟质量汇总；dev server 新增 `GET /api/log-quality?operator_id=...&plugin_version=...`；前端新增独立“数据质量”tab，查询条件为操作员 ID 和插件版本，展示过滤后的质量状态、检查事件、问题密度、插件版本和事件类型问题；同步模块文档和 README。
- 改动文件：
  - `docs/ai-worklog.md`
  - `.env.local`
  - `.env.example`
  - `dev.sh`
  - `README.md`
  - `docs/modules/06-log-health-probe.md`
  - `src/boss_analysis/domain/metrics.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/api/query_service.py`
  - `src/boss_analysis/dev_server.py`
  - `frontend/src/api.ts`
  - `frontend/src/types.ts`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `tests/test_query_service.py`
  - `tests/test_dev_server.py`
- 验证结果：`PYTHONPATH=src python3 -m unittest tests.test_query_service tests.test_dev_server` 通过，26 tests；`PYTHONPATH=src python3 -m unittest discover tests` 通过，104 tests；`npm run build` 在 `frontend/` 通过。
- 风险/阻塞：`.env.local` 已有真实 summary/daily 配置，但 `CLS_LOG_QUALITY_TOPIC_ID` 当前仍为空，因为本地文件里没有新建数据质量指标集的 ID，不能猜测云端资源；填入后才会实际加载质量指标。默认端口 `8765/5173` 已有既有真实数据服务占用；用 `8766/5174` 提权启动成功后进程很快退出且日志为空，未留下可用的新 URL。
- 中断续写入口：填入 `CLS_LOG_QUALITY_TOPIC_ID` 后，重新运行 `./dev.sh` 或指定空闲端口启动，访问数据质量 tab 检查过滤结果；如服务仍退出，先查端口占用和 `.dev/backend.log`。

### 任务：实现日志健康探测前后端闭环

- 时间：2026-05-18 22:09
- 执行者：AI
- 状态：已完成
- 目标：按用户要求开始实现日志健康度探测的前后端代码逻辑，先打通 `boss_10min_log_quality` 汇总读取、后端健康聚合和前端数据质量展示。
- 当前理解：上一轮已完成 CLS 定时 SQL、Topic 配置和 10 分钟质量汇总解析；本轮应在 analysis-system 内实现本地/开发读取健康汇总、按插件版本和事件类型计算质量状态，并在前端展示数量与质量异常。生产仍不得调用 raw CLS Search/SearchLog；健康汇总 SearchLog 入口只作为本地开发/排障读取目标 topic 的临时方式，且受 `APP_ENV=production` 禁用保护。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/metrics.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/consumer/cls_search.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `src/boss_analysis/api/query_service.py`
  - `frontend/src/types.ts`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `tests/test_summary_reader.py`
  - `tests/test_dev_data.py`
  - `tests/test_query_service.py`
  - `tests/test_dev_server.py`
  - `docs/modules/06-log-health-probe.md`
  - `README.md`
  - `.env.example`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实腾讯云 CLS Topic、定时 SQL 任务或生产部署配置
  - 不接入生产 raw CLS Search/SearchLog
  - 不实现数据库持久化 worker、告警事件生命周期或敏感正文展示
- 验证计划：补充 summary reader、dev data、query service 和 dev server 单元测试；运行相关 Python unittest；运行前端 `npm run build`。
- 下一步：可用 `BOSS_ANALYSIS_LOG_QUALITY_DATA_FILE` 或 `CLS_LOG_QUALITY_TOPIC_ID` 接入 10 分钟质量汇总，刷新前端查看“数据质量”区域；后续再做生产 summary-sync/worker 持久化。

#### 阶段记录：完成前后端健康闭环

- 时间：2026-05-18 22:09
- 状态：已完成
- 已完成：新增 10 分钟日志质量读取配置 `CLS_LOG_QUALITY_*` 和本地文件配置 `BOSS_ANALYSIS_LOG_QUALITY_DATA_FILE`；dev data 可加载 `boss_10min_log_quality` 汇总；`AnalysisQueryService.health()` 将日志质量汇总聚合为整体状态、检查事件数、问题数、问题密度、按插件版本汇总和按事件类型问题排行；`/api/dashboard` 返回 `log_quality_source` 与扩展后的 `health`；前端新增数据质量区域展示质量状态、最新窗口、插件版本和事件类型问题；同步 README、模块文档和 `.env.example`。
- 改动文件：
  - `docs/ai-worklog.md`
  - `README.md`
  - `.env.example`
  - `docs/modules/06-log-health-probe.md`
  - `src/boss_analysis/domain/metrics.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/consumer/cls_search.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `src/boss_analysis/api/query_service.py`
  - `frontend/src/types.ts`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `tests/test_summary_reader.py`
  - `tests/test_dev_data.py`
  - `tests/test_query_service.py`
  - `tests/test_dev_server.py`
- 验证结果：`PYTHONPATH=src python3 -m unittest tests.test_summary_reader tests.test_dev_data tests.test_query_service tests.test_dev_server` 通过，48 tests；`PYTHONPATH=src python3 -m unittest discover tests` 通过，102 tests；`npm run build` 在 `frontend/` 通过。
- 风险/阻塞：当前仍是内存版 API 聚合和前端展示，没有实现生产 `summary-sync-worker`、持久化健康表、独立 `/api/health/logs/*` 路由或告警生命周期；`CLS_LOG_QUALITY_TOPIC_ID` 路径继承开发 SearchLog reader，只能本地/排障使用，`APP_ENV=production` 会失败关闭。
- 中断续写入口：任务已完成；下一步若继续实现生产链路，应从 `log-health-probe-worker`/summary-sync 持久化 `boss_health_10min_prod` 结果开始，再拆独立健康 API。

#### 阶段记录：开发服务启动受限

- 时间：2026-05-18 22:33
- 状态：阻塞
- 已完成：尝试用 demo 数据启动本地开发服务；默认后端端口 `8765` 已被占用，改用 `8766/5174` 后因沙箱禁止监听本机端口失败；随后请求提权启动被用户拒绝。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：未能启动开发服务；代码验证仍以单元测试和前端 build 为准。
- 风险/阻塞：当前没有运行中的本轮新启动前端 URL；如需现场查看，可由用户手动运行 `BOSS_ANALYSIS_DATA_SOURCE=demo BOSS_ANALYSIS_REQUIRE_REAL_DATA=0 BOSS_ANALYSIS_BACKEND_PORT=8766 BOSS_ANALYSIS_FRONTEND_PORT=5174 ./dev.sh`，或先处理占用 `8765` 的既有进程后运行默认 `./dev.sh`。
- 中断续写入口：若继续需要浏览器验收，先确认端口权限/已有服务，再启动开发服务并截图检查数据质量区域。

### 任务：补充 CLS Topic 配置

- 时间：2026-05-18 22:02
- 执行者：AI
- 状态：已完成
- 目标：按用户要求，在 CLS 定时 SQL 任务清单中补充 Topic 配置，方便用户创建/检查源主题和目标主题。
- 当前理解：需要明确原始事实 topic、分钟汇总 topic、日级汇总 topic 和 10 分钟健康 topic 的命名、用途、索引字段、保留周期建议、环境变量映射和创建顺序。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改运行时代码、测试或真实云端 CLS 配置
  - 不接入生产 SearchLog
- 验证计划：文档级验证，检查 topic 名称、用途、索引字段、环境变量和任务引用一致；不运行代码测试。
- 下一步：用户可按 Topic 配置先创建/检查 1 个原始事实 topic 和 3 个目标 topic，再创建定时 SQL 任务。

#### 阶段记录：完成 Topic 配置补充

- 时间：2026-05-18 22:02
- 状态：已完成
- 已完成：在 `docs/modules/07-cls-scheduled-sql-tasks.md` 新增 `Topic 配置` 章节，覆盖 `boss`、`boss_summary_minute_prod`、`boss_summary_daily_prod`、`boss_health_10min_prod` 的用途、写入方、读取方、保留周期建议、本地环境变量、创建顺序和索引字段；明确 `operator_id` 必须是 text，健康 topic 的 `CLS_LOG_QUALITY_TOPIC_ID` 当前只是后续规划，代码尚未接入。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
- 验证结果：已运行 `rg -n "Topic 配置|boss_summary_minute_prod|boss_summary_daily_prod|boss_health_10min_prod|CLS_SUMMARY_TOPIC_ID|CLS_DAILY_SUMMARY_TOPIC_ID|CLS_LOG_QUALITY_TOPIC_ID|operator_id.*text|创建顺序" docs/modules/07-cls-scheduled-sql-tasks.md` 确认关键配置写入；未运行代码测试，因为本次只改文档。
- 风险/阻塞：没有实际创建或修改腾讯云 CLS topic；索引配置仍需用户在控制台执行，并注意索引只对新写入日志生效。
- 中断续写入口：任务已完成；如果用户配置时遇到字段类型、索引或 SQL 预览报错，继续按控制台错误修正文档/SQL。

### 任务：生成 CLS 定时 SQL 任务配置清单

- 时间：2026-05-18 21:49
- 执行者：AI
- 状态：已完成
- 目标：按用户要求，整理当前 CLS 层需要配置的全部定时 SQL 任务和可粘贴 SQL，方便用户去腾讯云控制台配置。
- 当前理解：当前 analysis-system 依赖的 CLS 层任务包括 `boss_minute_operator_funnel`、`boss_minute_chat`、`boss_daily_operator_active_duration` 和 `boss_10min_log_quality`；需要同时说明源/目标 topic、调度周期、SQL 时间窗口、索引字段、配置顺序和注意事项。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
  - `docs/modules/README.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改运行时代码、测试或真实云端 CLS 配置
  - 不接入生产 SearchLog
- 验证计划：文档级验证，检查四个任务名、目标 topic、SQL 语句、SearchLog 禁用边界和模块索引；不运行代码测试。
- 下一步：用户可按 `docs/modules/07-cls-scheduled-sql-tasks.md` 去 CLS 控制台配置任务；配置后检查目标 topic 是否有对应 `metric_name` 结果。

#### 阶段记录：完成 CLS 任务清单

- 时间：2026-05-18 21:49
- 状态：已完成
- 已完成：新增 `docs/modules/07-cls-scheduled-sql-tasks.md`，汇总 4 个 CLS 定时 SQL 任务：`boss_minute_operator_funnel`、`boss_minute_chat`、`boss_daily_operator_active_duration`、`boss_10min_log_quality`；每个任务包含源/目标主题建议、调度周期、SQL 时间窗口、目标字段和可粘贴 SQL；补充通用索引要求、配置后检查和官方参考链接；同步模块索引。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
  - `docs/modules/README.md`
- 验证结果：已运行 `rg -n "boss_minute_operator_funnel|boss_minute_chat|boss_daily_operator_active_duration|boss_10min_log_quality|SearchLog|try_cast|histogram" docs/modules/07-cls-scheduled-sql-tasks.md` 确认任务、SQL 关键函数和 SearchLog 边界均存在；未运行代码测试，因为本次只生成配置文档。
- 风险/阻塞：SQL 尚未在腾讯云控制台实际预览/运行；若控制台 SQL 方言对 `try`、`try_cast` 或 `histogram` 有限制，需要按控制台报错微调。目标主题索引和源主题字段类型会直接影响结果。
- 中断续写入口：任务已完成；下一步可由用户配置 CLS 任务后，把预览/运行报错贴回继续修正 SQL。

### 任务：实现 CLS 10 分钟日志质量计算口径

- 时间：2026-05-18 21:29
- 执行者：AI
- 状态：已完成
- 目标：按用户要求，先实现 CLS 层日志质量计算逻辑，将质量报告粒度调整为 10 分钟，而不是分钟级。
- 当前理解：CLS 层适合先计算 10 分钟窗口内的字段完整率、候选人身份线索、链路关联线索和聊天 message 结构质量；真正跨事件确认 detail/greeting 是否能找到 card/chat 前序事件，需要 analysis-system 后续基于 raw_events/fact 索引做精确检查。生产仍不能通过 SearchLog 做长期数据源。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/modules/06-log-health-probe.md`
  - `src/boss_analysis/domain/summary.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `tests/test_summary_reader.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改云端 CLS 任务配置
  - 不接入生产 SearchLog
  - 不实现前端页面和持久化 worker
- 验证计划：补充 10 分钟日志质量汇总解析测试；运行 `PYTHONPATH=src python3 -m unittest tests.test_summary_reader`；文档检查 10 分钟粒度和 SQL 说明。
- 下一步：如继续实现，接入 `boss_10min_log_quality` 的 summary 同步/读取配置，再把解析结果 rollup 到健康 API 和前端数据质量页。

#### 阶段记录：完成 10 分钟质量汇总和解析

- 时间：2026-05-18 21:29
- 状态：已完成
- 已完成：将日志质量 CLS 汇总从分钟级调整为 10 分钟级，新增 `boss_10min_log_quality` 定时 SQL 设计，覆盖 card/detail/greeting/chat 的关键字段、链路线索和 message 结构质量；新增 `LogQualitySummaryRecord` 领域模型、JSON/JSONL/CLS contents 解析入口和单元测试；同步总览文档中的指标名称。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/06-log-health-probe.md`
  - `docs/overview-design.md`
  - `src/boss_analysis/domain/summary.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `tests/test_summary_reader.py`
- 验证结果：`PYTHONPATH=src python3 -m unittest tests.test_summary_reader` 通过，10 tests；`PYTHONPATH=src python3 -m unittest tests.test_summary_reader tests.test_dev_data tests.test_cls_search` 通过，31 tests。
- 风险/阻塞：未修改云端 CLS 任务配置，SQL 尚未在腾讯云控制台实跑；CLS 层只计算字段和链路线索覆盖，跨事件精确确认“找到 card 曝光”仍需 analysis-system 后续基于 `raw_events` / facts 实现。
- 中断续写入口：任务已完成；下一步可新增 `CLS_LOG_QUALITY_*` 读取配置、summary-sync 同步和健康 API 展示。

### 任务：补充单日志级健康检查设计

- 时间：2026-05-18 21:19
- 执行者：AI
- 状态：已完成
- 目标：按用户补充要求，在日志健康度探测设计中加入单条日志级别检查，包括 card/detail/greeting/chat 的关键字段、跨事件关联和按插件版本查看。
- 当前理解：除了分钟/汇总层面的数量和质量健康，还需要对每条事实日志做契约完整性、关键字段存在性、候选人身份质量、事件链路可关联性检查；结果要按 `plugin_version` 分组，便于识别某个插件版本导致字段缺失或关联失败。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/modules/06-log-health-probe.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改运行时代码、前端代码、测试或云端 CLS 配置
  - 不读取真实 CLS 或插件 profile
- 验证计划：文档级验证，检查新增章节覆盖用户点名的 card、detail、greeting、chat、message、plugin version 维度，并保持 SearchLog 生产禁用边界。
- 下一步：如进入实现，先建立单日志质量规则注册表和 `log_event_quality_findings` / rollup 模型，再接入按 `plugin_version` 的 API 展示。

#### 阶段记录：完成单日志级设计补充

- 时间：2026-05-18 21:19
- 状态：已完成
- 已完成：在 `docs/modules/06-log-health-probe.md` 补充单日志质量检查章节，覆盖通用字段、card 关键字段、detail 关键字段和 card 回连、greeting 来源/结果关联、chat 候选人信息和 message 结构；新增按 `plugin_version` 分组查看的要求，并补充规则、数据模型、API、前端展示、实施顺序和测试要求。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/06-log-health-probe.md`
- 验证结果：已运行 `rg -n "candidate_list.card_exposed|candidate_detail.opened|detail_card_link_missing|candidate_greeting.clicked|greeting_result_click_link_missing|candidate_chat.snapshot_captured|plugin_version|event-quality|plugin-versions|SearchLog" docs/modules/06-log-health-probe.md`，确认用户点名维度和生产 SearchLog 禁用边界均已覆盖。未运行代码测试，因为本次只改文档。
- 风险/阻塞：当前只完成设计，没有实现规则引擎、数据库表或 API；父仓库仍有既有未提交改动，本次未处理。
- 中断续写入口：任务已完成；后续实现从 `LogEventQualityFinding`、规则注册表、事件关联索引和按插件版本 rollup 开始。

### 任务：设计日志健康度探测模块

- 时间：2026-05-18 21:04
- 执行者：AI
- 状态：已完成
- 目标：按用户要求，为 analysis-system 新增一个健康度探测模块详细设计，核心能力是判断日志数量和日志质量是否正常。
- 当前理解：健康度探测应消费已批准的数据链路，优先基于 CLS 分钟汇总、日级汇总、raw_events/解析错误/投影错误和运行状态生成可解释的健康结论；生产环境不能把 CLS Search/SearchLog 作为探测数据源；探测结果只能说明日志链路可信度和异常线索，不能写成员工绩效或候选人质量判断。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/modules/06-log-health-probe.md`
  - `docs/modules/README.md`
  - `docs/overview-design.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改运行时代码、前端代码、测试或云端 CLS 配置
  - 不新增生产 SearchLog 路径
  - 不定义候选人质量、员工绩效或话术评价规则
- 验证计划：文档级验证，检查模块边界、CLS Search 约束、与现有 summary/query/operations 设计的引用一致性；不运行代码测试。
- 下一步：如进入实现，先从 `HealthSummary` 扩展和内存版规则评估开始，再做持久化 worker 和前端数据质量页。

#### 阶段记录：完成阅读和方案选择

- 时间：2026-05-18 21:04
- 状态：实现中
- 已完成：阅读 `AGENTS.md`、`docs/ai-worklog.md`、README、边界、总览、聚合/API、事实投影、运维文档、父项目日志规范，以及当前 `HealthSummary`、分钟汇总和 query service 中已有健康字段；确认当前已有 raw/summary 基础健康计数，但缺少独立的数量/质量探测规则、阈值、输出模型和告警分层。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：尚未验证；当前只完成设计上下文和方案边界确认。
- 风险/阻塞：`docs/ai-worklog.md` 中上一条“展示双详情口径”任务仍标为实现中；本次不接管该任务，也不修改运行时代码。
- 中断续写入口：继续新增 `docs/modules/06-log-health-probe.md`，并在模块索引和总览设计中挂接该模块。

#### 阶段记录：完成设计文档

- 时间：2026-05-18 21:04
- 状态：已完成
- 已完成：新增日志健康度探测模块详细设计，覆盖目标/非目标、生产输入来源、推荐 `boss_minute_log_health` 汇总、数量健康、质量健康、规则分层、基线设计、数据模型、探测流程、API、前端展示、实施顺序和测试要求；同步模块索引和总览设计。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/06-log-health-probe.md`
  - `docs/modules/README.md`
  - `docs/overview-design.md`
- 验证结果：已运行 `rg -n "06-log-health-probe|boss_minute_log_health|SearchLog|log-health-probe-worker|日志健康" docs` 检查引用和 SearchLog 边界；已阅读新增模块文档和总览相关段落。未运行代码测试，因为本次只修改文档设计。
- 风险/阻塞：当前仓库父目录仍有大量既有未提交改动，且 `analysis-system/` 在父仓库状态中显示为未跟踪目录；本次未处理这些无关改动。上一条“展示双详情口径”日志仍标为实现中，本次未接管。
- 中断续写入口：任务已完成；后续实现可按模块文档“实施顺序”从领域模型和 `HealthSummary` 扩展开始。

### 任务：展示双详情口径并精简来源分钟

- 时间：2026-05-18 21:00
- 执行者：AI
- 状态：实现中
- 目标：按用户要求，在单人明细中同时展示纯 `candidate_detail.opened` 详情打开数和近似 BOSS 后台口径的查看详情数，并去掉来源分钟卡片里与今日活跃分钟重复的数字。
- 当前理解：近似后台口径第一版使用 `detail_opened + chat.chat_opened`，保留当前纯详情打开指标；“来源分钟”指单人详情的当日活跃来源/来源分钟展示，当前可能重复显示 active_minutes/source_minute_count，需要弱化或移除重复数值。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/metrics.py`
  - `src/boss_analysis/api/query_service.py`
  - `src/boss_analysis/dev_server.py`
  - `frontend/src/types.ts`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `tests/test_query_service.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改云端 CLS 配置
  - 不改变 raw/summary 生产链路
- 验证计划：补/调 query service 测试覆盖双口径；运行相关 Python 测试；前端运行 TypeScript build。
- 下一步：阅读单人明细 UI 和 dev_server JSON 序列化，确定最小字段和展示改动。

#### 阶段记录：完成展示调整和验证

- 时间：2026-05-18 21:04
- 状态：已完成
- 已完成：单人明细漏斗增加“后台口径”数值，按当前已加载数据用 `detail_opened + chat.chat_opened` 计算；条形图增加“后台近似”；保留原“详情打开”纯 `candidate_detail.opened` 数值。将当日活跃摘要第三张卡从重复的 `source_minute_count` 改为“统计来源：分钟汇总”，并展示 `source_row_count` 来源记录行数。同步更新 `dev_server.py` 内置静态 fallback。
- 改动文件：
  - `docs/ai-worklog.md`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `src/boss_analysis/dev_server.py`
- 验证结果：`npm run build` 在 `frontend/` 通过；`PYTHONPATH=src python3 -m unittest tests.test_dev_server tests.test_query_service` 通过，22 tests。
- 风险/阻塞：当前“后台口径”是近似口径，受 summary 当前覆盖范围影响；它不会自动补上 `12:35-12:38` 的 17 条 raw 详情缺口，也不会读取 raw SearchLog。
- 中断续写入口：任务已完成；如需更贴近 BOSS 后台 252，需要先补 summary 缺口或新增离线/生产汇总字段承载后台近似口径。

### 任务：分析 zhouxinyu 本地 profile 详情次数差异

- 时间：2026-05-18 20:54
- 执行者：AI
- 状态：实现中
- 目标：读取用户提供的本地 profile `/Users/tiny/Downloads/boss-observer-profile-0.1.1-2026-05-18T20-50-59-017+08-00.json`，结合前一轮 raw/summary 对账结果，定位 zhouxinyu BOSS 后台查看详情次数 252 与系统统计 130 的具体原因。
- 当前理解：profile 是插件本地诊断数据，可能包含 productionStats、队列/上传状态、事件计数和调试状态；需要避免泄露敏感正文、联系方式和完整候选人资料，只提取计数、时间范围和事件链路健康信息。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改运行时代码、前端代码或云端 CLS 配置
  - 不把 profile 或 raw SearchLog 作为生产链路
  - 不打印聊天正文、联系方式或完整简历正文
- 验证计划：只读解析 profile 顶层结构、生产统计、事件队列/上传记录和详情/聊天相关计数；必要时与当前 CLS raw/summary 只读结果交叉比对；最终给出差异归因和可执行修复建议。
- 下一步：读取 profile JSON 结构并汇总关键字段。

#### 阶段记录：完成 profile 归因分析

- 时间：2026-05-18 20:57
- 状态：已完成
- 已完成：只读解析用户提供的 profile。profile 生成于 `2026-05-18 20:50:59+08:00`，runtime 最近更新于 `20:25:57`；队列为 0，最后上传状态 200，模块 pending 和 uploadFailed 均为 0，说明 130 与 147 的差异不是本地队列积压或上传失败导致。profile 当前运行窗口内 `candidate_detail` 产出 2 条（1 open + 1 close），`candidate_chat` 产出 14 条；recentEvents 50 条中 `candidate_detail.opened=1`、`candidate_chat.opened=4`、`candidate_chat.snapshot_captured=5`。现场序列显示 `19:24:36` 在推荐页打开一次详情，`19:24:48` 切到聊天页，随后 `19:24:52`、`19:24:58`、`19:25:02`、`19:28:00` 连续产生 `candidate_chat.opened`，这些不会进入当前 `detail_opened` 指标，但很可能被 BOSS 后台“查看详情次数”算入更宽口径。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：profile 只读解析完成；结合上一轮 raw/summary 对账，当前可解释为 `130` 是 summary 详情口径，raw 详情应为 `147`，剩余到 BOSS `252` 的主要差异来自聊天页候选人打开/会话资料查看这类 `candidate_chat.opened` 事件。
- 风险/阻塞：profile 只保留 recentEvents 和当前运行窗口 productionStats，不是全天完整事件明细；BOSS 后台官方“查看详情”是否精确包含哪些聊天页打开动作，仍需用后台按小时明细或真机对照确认。
- 中断续写入口：如需修复展示口径，可新增一个“BOSS后台近似查看详情”指标，使用 `candidate_detail.opened` 加上符合条件的 `candidate_chat.opened`，并保留当前纯详情打开指标；如只修 summary 缺口，先回填 `12:35-12:38` 的 17 条 raw 详情。

### 任务：分析 zhouxinyu 详情查看次数差异

- 时间：2026-05-18 20:32
- 执行者：AI
- 状态：实现中
- 目标：按用户要求，从原始数据和 summary 排查 `zhouxinyu` 的 BOSS 后台查看详情次数 252 与当前系统统计 130 次之间的差异来源。
- 当前理解：本次允许把原始 CLS SearchLog 作为开发排障校验来源，但不能作为生产链路；需要对比 raw `candidate_detail.opened`、分钟 summary 的 detail 计数和当前 API/前端展示口径，重点判断是时间窗口、事件类型、operator 映射、去重口径、延迟/漏汇总还是 BOSS 官方口径不同造成。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改运行时代码、前端代码或云端 CLS 配置
  - 不把 raw SearchLog 接入正式实现
  - 不打印云密钥、聊天正文、联系方式或完整简历正文
- 验证计划：阅读 aggregation/query 与 summary reader 相关源码；只读查询本地 summary/current API 所用数据与 raw 原始事件，按时间、event_type、operator 字段、候选人/事件去重维度拆分；最终给出差异归因和后续修复建议。
- 下一步：阅读相关模块文档和源码，确认“130”来自哪个统计口径，再做只读数据对账。

#### 阶段记录：完成只读对账分析

- 时间：2026-05-18 20:49
- 状态：已完成
- 已完成：确认本机 `/api/operator/zhouxinyu` 返回的 `funnel.detail_opened=130` 来自 `boss_summary_minute_prod` 中 `boss_minute_operator_funnel.detail_opened` 加总；summary 当前加载 170 条，其中 `zhouxinyu` 109 条、漏斗 77 条、聊天 32 条，时间覆盖 `2026-05-18 12:38` 到 `20:25`。只读查询 raw 主题后，按 `operator_account_name:"谢女士"` 得到 `candidate_detail.opened=147`，按分钟比 summary 多 17 条，全部集中在 `12:35` 到 `12:38`。raw 账号全量事件中另有 `candidate_chat.opened=112`，`candidate_detail.opened + candidate_chat.opened = 259`，与用户提供的 BOSS 后台 252 更接近，提示 BOSS 后台“查看详情”可能包含聊天/会话资料打开等更宽口径，或存在插件未捕获的官方详情行为。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：完成本机 API 只读校验、CLS summary 只读查询、CLS raw SearchLog 开发排障查询；未修改运行时代码或云端配置。
- 风险/阻塞：raw SearchLog 仅用于本次开发排障，不能接入正式链路；无法仅凭当前数据断定 BOSS 后台 252 的官方分母，需要用户提供 BOSS 后台时间范围/小时拆分或进一步确认官方口径。
- 中断续写入口：如需继续，优先拿 BOSS 后台的时间范围和按小时明细；若只修正本系统当前可确认缺口，可回填 `12:35-12:38` 的分钟 summary 17 条，但这只能把 130 修到 147，不能解释到 252。

### 任务：修正日级 CLS SQL source_row_count 说明

- 时间：2026-05-18 19:33
- 执行者：AI
- 状态：已完成
- 目标：响应用户在腾讯 CLS 控制台执行 SQL 时遇到的 `Column 'source_row_count' cannot be resolved` 报错，明确 `source_row_count` 不是源字段，而是内层 `count(*)` 生成的排查字段。
- 当前理解：用户粘贴的旧 SQL 内层误引用了源主题不存在的 `source_row_count`；真实源 `boss_summary_minute_prod` 没有该字段，应该在内层使用 `count(*) as source_row_count`，外层才能 `sum(source_row_count)`。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/modules/04-aggregation-query-api.md`
- 不修改范围：
  - 不修改云端 CLS 配置
  - 不修改运行时代码
  - 不查询 raw 日志
- 验证计划：检查文档 SQL 仍保留内层 `count(*) as source_row_count`，并补充说明避免再次粘贴旧写法。
- 下一步：把可直接贴入 CLS 的修正版 SQL 发给用户。

### 任务：修正当日活跃时长窗口

- 时间：2026-05-18 19:30
- 执行者：AI
- 状态：已完成
- 目标：按用户确认，修正当日活跃时长相关配置与实现，避免只按最近 180 分钟或最近 1 分钟计算；日级 SQL 使用当天累计窗口，本地 summary 兜底按当天读取。
- 当前理解：生产源仍然是 `boss_summary_minute_prod` 分钟汇总，不把 raw SearchLog 接入正式链路；需要调整本地配置/代码/文档，使“今日活跃时长”覆盖当天，而不是仅最近几小时。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `.env.example`
  - `.env.local`
  - `docs/modules/04-aggregation-query-api.md`
  - `README.md`
  - 可能涉及 `src/boss_analysis/consumer/cls_search.py`、`src/boss_analysis/consumer/summary_reader.py`、`src/boss_analysis/dev_data.py`、相关测试
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改云端 CLS 任务配置
  - 不恢复 raw SearchLog 生产依赖
  - 不启动长期 dev 服务
- 验证计划：阅读现有 summary 加载链路；补充/更新单元测试；运行相关 Python 测试，必要时做真实 summary 只读 smoke 验证。
- 下一步：定位 summary 搜索配置和 query service 兜底逻辑，确定最小改动。

#### 阶段记录：完成窗口修正和验证

- 时间：2026-05-18 19:34
- 状态：已完成
- 已完成：将 CLS summary SearchLog 默认窗口从 180 分钟改为 1440 分钟，并同步 `.env.example`、`.env.local` 和 README；将 `boss_daily_operator_active_duration` 的腾讯 CLS 定时 SQL 推荐窗口从 `@h-24h,@m-1m` 改为 `@d,@m-1m`；补充 summary 配置默认窗口测试。
- 改动文件：
  - `.env.example`
  - `.env.local`
  - `README.md`
  - `docs/ai-worklog.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `src/boss_analysis/consumer/cls_search.py`
  - `tests/test_summary_reader.py`
- 验证结果：`PYTHONPATH=src python3 -m unittest tests.test_summary_reader tests.test_cls_search tests.test_dev_data tests.test_query_service` 通过，42 tests；`PYTHONPATH=src python3 -m unittest discover tests` 通过，96 tests；真实 summary 只读 smoke 显示当前 `CLS_SUMMARY_WINDOW_MINUTES=1440`，`zhouxinyu` 可读到 108 行、69 个去重分钟，首末分钟约为 `2026-05-18 12:38` 到 `2026-05-18 19:28`。
- 风险/阻塞：`12:20-12:37` 仍是 raw 有记录但 summary 无对应分钟的历史缺口，需要通过 summary 回填或接受该段缺失；本次未修改云端 CLS 任务配置，仍需用户在腾讯云控制台把真实日级任务窗口改为 `@d,@m-1m`。
- 中断续写入口：如需继续，可重启本地 dev 服务后查看大盘，或进入腾讯云控制台修改 `boss_daily_operator_active_duration` 定时 SQL 时间窗口。

### 任务：校验 zhouxinyu 下午原始日志与分钟汇总

- 时间：2026-05-18 19:16
- 执行者：AI
- 状态：已完成
- 目标：按用户要求，只读查询 `zhouxinyu` 今天下午的分钟级 summary 和原始日志，验证“下午应有很多操作记录”是否成立，并判断当前当日活跃时长偏低是 SQL 窗口、summary 缺失、operator_id 缺失还是展示口径造成。
- 当前理解：生产实现仍应使用分钟级 summary；本次允许查询原始日志仅用于开发排查和数据校验，不作为正式环境链路。需要保护云端密钥，不在日志和最终回复泄露 `.env.local` 内容。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改云端 CLS 配置
  - 不启动 dev 服务
  - 不把 raw SearchLog 接入正式实现
- 验证计划：查找现有 CLS 查询脚本/服务；分别查询分钟 summary topic 与原始日志 topic 在今天下午的 `zhouxinyu` 行数、分钟分布和关键事件分布；必要时对 `<missing>` operator_id 做只读对照。
- 下一步：阅读现有 CLS reader/query 配置和脚本，确定最小只读查询命令。

#### 阶段记录：完成 summary/raw 只读校验

- 时间：2026-05-18 19:26
- 状态：已完成
- 已完成：通过腾讯云 CLS API 只读确认原始日志主题为 `boss`，topic id `5407c0a7-3e37-4c45-a204-bf5d40f157a1`；使用开发辅助 SearchLog 查询 `2026-05-18 12:00` 到当前时间窗口，校验 `zhouxinyu` / `谢女士` 的 summary 与 raw 分布。summary 全量本地过滤得到 `zhouxinyu` 98 行、68 个分钟，首末分钟约为 `12:38` 到 `19:19`；raw 按 `operator_account_name:谢女士` 得到 1150 行、81 个分钟，首末时间约为 `12:20:44` 到 `19:19:49`。当前 `.env.local` 的 `CLS_SUMMARY_WINDOW_MINUTES=180` 只返回 50 行、30 个分钟，首末分钟约为 `17:44` 到 `19:25`，可复现前端只看到傍晚以后活跃时长的现象。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：summary 与 raw 均确认下午有明显多于 21 分钟的操作记录；raw 存在 13 个分钟没有对应 summary，集中在 `12:20` 到 `12:37`，包含聊天、卡片曝光、详情打开、打招呼等事件。
- 风险/阻塞：本次 raw SearchLog 仅用于开发排查；正式链路仍不应依赖 raw SearchLog。当前展示偏低的主要原因是本地 summary 读取窗口只有 180 分钟，另有早期 raw 记录未被分钟 summary 任务覆盖。
- 中断续写入口：下一步应把“今日活跃时长”的本地读取/兜底窗口改为当天窗口，或优先修正日级定时 SQL 为 `@d,@m-1m` 后读取日级快照；如需补 `12:20-12:37`，只能做 summary 任务回填或一次性 raw 校验补数，不能作为常态链路。

### 任务：用 Computer Use 排查 CLS 定时 SQL 空结果

- 时间：2026-05-18 18:25
- 执行者：AI
- 状态：已完成
- 目标：按用户要求，通过 Computer Use 查看腾讯云 CLS 定时 SQL 任务配置、预览结果和运行日志，定位“预览有数据但任务运行结果为空”的原因。
- 当前理解：这是控制台只读排查任务，不修改本地代码和云端任务配置；需要重点核对任务 SQL、调度时间范围、输出目标、执行日志、结果写入条数和预览使用的时间窗口是否一致。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不保存或修改 CLS 定时 SQL 任务配置
  - 不启动 dev 服务
  - 不查询 raw 日志作为生产链路
- 验证计划：用 Computer Use 观察腾讯云控制台页面，记录发现；必要时只读点击预览、运行日志、任务详情等页面，不执行保存/删除/修改。
- 下一步：打开/切换到浏览器中的腾讯云 CLS 定时 SQL 页面并检查任务。

#### 阶段记录：完成控制台只读排查

- 时间：2026-05-18 18:31
- 状态：已完成
- 已完成：通过 Computer Use 查看腾讯云 CLS 定时 SQL 任务 `boss_daily_operator_active_duration`，确认任务状态为运行中、近 1 天实例 128 条且调度结果均为成功；源主题为 `boss_summary_minute_prod`，目标主题为指标主题 `boss_daily_operator_active_duration`，调度周期 1 分钟，SQL 时间窗口为 `@m-1m,@m`，时间戳配置为默认查询窗口左侧时间。运行明细中最近实例均显示输入行数 0、输出行数 0；任务监控页显示处理日志量贴近 0，SQL 分析结果为成功。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：控制台只读观察完成；未修改云端配置，未保存任务。
- 风险/阻塞：预览能查出数据但运行为空的主要差异是预览时间范围更宽，而真实调度每次只扫描上一分钟；如果上游分钟汇总写入有延迟或该分钟无活跃行，任务会成功但输出 0。目标为指标主题也意味着当前本地 SearchLog 日志读取不会把它当作日志主题结果读到。
- 中断续写入口：如需修复，先确认是继续输出指标主题供监控查询，还是改/新增日志主题供 analysis-system 用 SearchLog 读取；再调整 SQL 时间窗口，例如当天累计窗口 `@d,@m-1m` 或兜底 `@h-24h,@m-1m`。

### 任务：后台化 dev 脚本并补充 restart/stop

- 时间：2026-05-18 18:16
- 执行者：AI
- 状态：已完成
- 目标：将 `dev.sh` 调整为后台启动开发服务，并新增 `restart.sh`、`stop.sh` 方便管理遗留 dev 进程。
- 当前理解：用户希望开发服务不占用当前终端；需要用 pid/log 文件管理前后端 dev 进程，并能安全停止、重启。只处理 analysis-system 子项目脚本，不修改父项目或插件代码。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `dev.sh`
  - `restart.sh`
  - `stop.sh`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改后端业务代码、前端业务代码或依赖文件
  - 不启动长期 dev 服务作为最终状态，除非验证脚本行为需要短暂启动后停止
- 验证计划：阅读现有脚本和 README；用 shell 语法检查脚本；必要时短暂执行 `dev.sh` 后用 `stop.sh` 清理并确认端口释放。
- 下一步：阅读 README、边界/设计文档、现有 `dev.sh` 和相关 package 脚本，确定脚本管理方式。

#### 阶段记录：完成阅读和方案选择

- 时间：2026-05-18 18:22
- 状态：实现中
- 已完成：阅读 `AGENTS.md`、README、边界/总览/运行相关文档、日志契约、现有 `dev.sh`、前端 package 脚本和当前 diff；确认现有脚本以前台方式启动后端和 Vite，用户需要改为后台可管理进程。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：尚未运行验证；当前只完成方案选择。
- 风险/阻塞：将新增 `.dev/` 运行目录存放 pid/log，需要把该目录加入 `.gitignore`；README 的“Ctrl-C 停止”说明需要同步更新。
- 中断续写入口：继续修改 `dev.sh`、新增 `stop.sh`/`restart.sh`，并同步 README、`.gitignore`。

#### 阶段记录：完成脚本实现和验证

- 时间：2026-05-18 18:29
- 状态：已完成
- 已完成：`dev.sh` 改为后台启动后端和前端，写入 `.dev/backend.pid`、`.dev/frontend.pid`、`.dev/backend.log`、`.dev/frontend.log`；新增 `stop.sh` 按 pid、端口和 Vite esbuild helper 清理本项目 dev 进程；新增 `restart.sh` 串联 stop/start；README 已更新后台启动、停止和重启说明；`.gitignore` 已忽略 `.dev/`。
- 改动文件：
  - `.gitignore`
  - `README.md`
  - `dev.sh`
  - `stop.sh`
  - `restart.sh`
  - `docs/ai-worklog.md`
- 验证结果：
  - `bash -n dev.sh` 通过。
  - `bash -n stop.sh` 通过。
  - `bash -n restart.sh` 通过。
  - `BOSS_ANALYSIS_DATA_SOURCE=demo BOSS_ANALYSIS_REQUIRE_REAL_DATA=0 ./dev.sh` 在提升权限后完成启动路径，输出后端和前端 pid，日志显示后端监听、Vite ready。
  - `BOSS_ANALYSIS_DATA_SOURCE=demo BOSS_ANALYSIS_REQUIRE_REAL_DATA=0 ./restart.sh` 在提升权限后完成 stop/start 路径。
  - `./stop.sh` 已执行；`lsof -nP -iTCP:8765 -sTCP:LISTEN`、`lsof -nP -iTCP:5173 -sTCP:LISTEN`、`pgrep -fl "boss_analysis.dev_server|vite --host 127.0.0.1 --port 5173|esbuild --service"` 均无结果。
- 风险/阻塞：Codex 工具环境会在命令结束后清理由该命令派生的后台子进程，因此无法在工具内长期保持 dev 服务供浏览器人工访问；脚本已在退出前确认服务启动，普通终端运行应保持后台进程。
- 中断续写入口：如后续需要改成 macOS `launchctl` 用户服务或跨机器守护进程，可基于当前 pid/log 脚本继续扩展。

### 任务：真实日级指标接入校验

- 时间：2026-05-18 16:53
- 执行者：AI
- 状态：已完成
- 目标：在不启动 dev 服务的前提下，用本地 `.env.local` 配置校验分钟汇总和日级活跃时长指标是否能被读取、解析并进入 dashboard/operator payload。
- 当前理解：用户要求继续开发；上一轮已完成日级指标模型和前端展示，本轮优先做真实配置下的无服务校验，并根据结果修复解析、过滤或展示问题。只读取已批准 summary/daily summary topic，不查询 raw 日志。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - 如发现问题，可能修改 `src/boss_analysis/**`、`frontend/src/**`、`tests/**`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不启动前后端 dev 服务
  - 不打印云密钥或敏感正文
  - 不使用 raw SearchLog 生产链路
- 验证计划：运行本地 Python smoke 脚本加载 `.env.local`，输出脱敏的 source/record count/operator 指标摘要；如有代码变更，补测并跑单元测试和前端 build。
- 下一步：执行真实配置 smoke 校验。

#### 阶段记录：完成真实配置 smoke 和分钟兜底

- 时间：2026-05-18 18:15
- 状态：已完成
- 已完成：使用 `.env.local` 做只读 smoke 校验，分钟 summary topic 可读；日级 summary topic 当前 3 天窗口 SearchLog 原始响应为 0 条。为避免大盘空白，已把日级默认查询改为 `*`，避免 `metric_name` 未索引导致查询失败；同时在 query service 中新增日级活跃时长分钟汇总兜底，日级 topic 为空时按 `operator_id + active_date + minute` 从分钟 summary 去重 rollup，并在前端来源提示中标记“分钟汇总兜底”。
- 改动文件：
  - `.env.example`
  - `.env.local`
  - `docs/ai-worklog.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `src/boss_analysis/consumer/cls_search.py`
  - `src/boss_analysis/api/query_service.py`
  - `frontend/src/App.tsx`
  - `tests/test_cls_search.py`
  - `tests/test_summary_reader.py`
  - `tests/test_query_service.py`
- 验证结果：
  - 真实配置 smoke：分钟 summary 读取 75 条；日级 topic 读取 0 条；分钟兜底生成 2 个操作员、合计 57 活跃分钟。
  - `PYTHONPATH=src python3 -m unittest discover tests` 通过，95 tests。
  - `npm run build` 在 `frontend/` 下通过。
  - `rg -n "CLS_DAILY_SUMMARY_QUERY|分钟汇总兜底|derive_latest_daily|test_daily_active_duration_falls_back" .env.example .env.local docs/modules/04-aggregation-query-api.md src/boss_analysis/api/query_service.py frontend/src/App.tsx tests/test_query_service.py tests/test_cls_search.py tests/test_summary_reader.py` 确认关键实现存在。
- 风险/阻塞：真实日级 topic 当前无日志，需要在 CLS 控制台确认 `boss_daily_operator_active_duration` 的目标是否为日志主题、目标 topic ID 是否正确、任务是否已经实际写入结果；当前本地展示会先用分钟 summary 兜底。
- 中断续写入口：下一步可让用户运行 `npm run dev` 检查大盘显示；若日级 topic 后续有数据，本地会优先使用日级 topic 快照并停止兜底。

### 任务：接入日级活跃时长指标

- 时间：2026-05-18 16:35
- 执行者：AI
- 状态：已完成
- 目标：接入 CLS 定时 SQL 输出的 `boss_daily_operator_active_duration` 指标数据，并为新 topic ID 写好本地配置占位。
- 当前理解：用户已在 CLS 成功配置日级活跃时长 SQL，并换了新的目标 topic ID；本轮先在 analysis-system 内增加日级 summary 配置键、读取模型和查询展示字段，仍然只读取已批准的 summary/metric 结果，不查询 raw SearchLog 作为生产实现。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `.env.example`
  - `.env.local`
  - `src/boss_analysis/domain/*.py`
  - `src/boss_analysis/consumer/*.py`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/api/query_service.py`
  - `src/boss_analysis/dev_server.py`
  - `tests/*.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不写入真实新 topic ID 或云密钥
  - 不启动 dev 服务
  - 不恢复 raw SearchLog 生产依赖
- 验证计划：补充解析和 query service 单元测试；运行相关测试，必要时运行全量 `npm test`。
- 下一步：补配置占位与日级 metric 数据模型。

#### 阶段记录：完成日级指标接入

- 时间：2026-05-18 16:45
- 状态：已完成
- 已完成：新增 `CLS_DAILY_SUMMARY_*` 和 `BOSS_ANALYSIS_DAILY_SUMMARY_DATA_FILE` 配置；新增 `DailyActiveDurationRecord`、日级指标解析、日级 summary 搜索配置、dev dataset 加载；query service 将 `boss_daily_operator_active_duration` 去重后暴露到 dashboard 和单人详情，并可用 `last_active_minute` 辅助活跃状态；前端展示今日活跃分钟、单人当日活跃、首末活跃和日级指标来源。
- 改动文件：
  - `.env.example`
  - `.env.local`
  - `docs/ai-worklog.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `src/boss_analysis/consumer/cls_search.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `src/boss_analysis/domain/summary.py`
  - `src/boss_analysis/domain/metrics.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `src/boss_analysis/api/query_service.py`
  - `frontend/src/types.ts`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `tests/test_cls_search.py`
  - `tests/test_summary_reader.py`
  - `tests/test_dev_data.py`
  - `tests/test_query_service.py`
- 验证结果：
  - `PYTHONPATH=src python3 -m unittest tests.test_summary_reader tests.test_cls_search tests.test_query_service tests.test_dev_data tests.test_dev_server` 通过，49 tests。
  - `PYTHONPATH=src python3 -m unittest discover tests` 通过，94 tests。
  - `npm run build` 在 `frontend/` 下通过。
  - `rg -n "CLS_DAILY_SUMMARY_TOPIC_ID|BOSS_ANALYSIS_DAILY_SUMMARY_DATA_FILE|daily_active_duration" docs/modules/04-aggregation-query-api.md .env.example .env.local` 确认配置键和文档已写入。
- 风险/阻塞：本轮未启动 dev 服务，也未连接真实 CLS 预览；如果日级 topic 字段索引或 `metric_name` 查询未生效，前端会显示日级指标未读取或读取 0 条，需要先检查目标 topic 的索引和 query。
- 中断续写入口：下一步可运行 `npm run dev` 后在大盘确认 `日级指标` 来源、`今日活跃分钟` 和单人详情里的 `当日活跃` 是否出现真实数值。

### 任务：补充腾讯 CLS 当日活跃时长 SQL

- 时间：2026-05-18 16:26
- 执行者：AI
- 状态：已完成
- 目标：按用户要求，生成可直接贴入腾讯 CLS 定时 SQL 配置的“当日活跃时长”真实 SQL。
- 当前理解：该 SQL 应以 `boss_summary_minute_prod` 的分钟级汇总为源，只消费 `boss_minute_operator_funnel` 和 `boss_minute_chat` 产生的分钟字段，不查询 raw 日志或 SearchLog；CLS 目标主题是追加写，因此需要只输出当天快照并带稳定 metric 名称。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/modules/04-aggregation-query-api.md`
- 不修改范围：
  - 不修改业务代码
  - 不修改 `analysis-system/` 之外文件
  - 不连接真实 CLS 执行查询
  - 不使用 raw SearchLog 作为生产链路
- 验证计划：检查文档中包含可贴入 CLS 的 `* | select ...` SQL、推荐源/目标主题、调度窗口和字段索引注意事项。
- 下一步：在聚合/API 模块文档补充腾讯 CLS 定时 SQL 章节。

#### 阶段记录：完成 CLS SQL 文档

- 时间：2026-05-18 16:29
- 状态：已完成
- 已完成：在聚合/API 模块文档补充 `boss_daily_operator_active_duration` 的腾讯 CLS 定时 SQL，包含推荐源主题 `boss_summary_minute_prod`、目标主题 `boss_summary_daily_prod`、调度窗口 `@h-24h,@m-1m`、当天过滤、缺失 operator 排除、分钟去重和字段索引要求。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/04-aggregation-query-api.md`
- 验证结果：
  - `rg -n "腾讯 CLS 定时 SQL|boss_daily_operator_active_duration|current_date|@h-24h|PostgreSQL 落库 SQL" docs/modules/04-aggregation-query-api.md` 确认可贴入 SQL 和配置说明已写入。
  - 已人工检查 SQL 不依赖 raw SearchLog，不依赖 `metric_name` 源字段，且只输出 `current_date` 当天快照。
- 风险/阻塞：未连接真实 CLS 预览执行；如果源主题计数字段未开启统计分析或类型不是数值，需要先在 CLS 索引配置中修正。
- 中断续写入口：下一步可在腾讯 CLS 控制台预览 SQL；如预览报字段类型错误，优先检查 `minute`、`operator_id` 和计数字段索引类型。

### 任务：补充当日活跃时长聚合 SQL

- 时间：2026-05-18 16:19
- 执行者：AI
- 状态：已完成
- 目标：按用户要求，为“当日活跃时长”补充可落地的聚合 SQL。
- 当前理解：上一轮已有口径和伪 SQL；本轮需要写成更接近生产的 PostgreSQL SQL，包括目标表结构、按目标日期计算、按幂等键 upsert，仍然只基于分钟级 summary 表，不查询 raw 日志。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/modules/04-aggregation-query-api.md`
- 不修改范围：
  - 不修改业务代码
  - 不修改 `analysis-system/` 之外文件
  - 不查询真实 CLS 或 raw SearchLog
- 验证计划：检查 SQL 章节包含 `CREATE TABLE`、`INSERT ... ON CONFLICT`、source 表假设和参数说明。
- 下一步：编辑聚合/API 模块文档。

#### 阶段记录：完成聚合 SQL

- 时间：2026-05-18 16:20
- 状态：已完成
- 已完成：把 `当日活跃时长` 从伪 SQL 升级为 PostgreSQL 可落地 SQL，包含 `daily_operator_active_duration` 目标表 DDL、基于 `:target_date` 的分钟汇总 rollup、`insert ... on conflict` 幂等覆盖写入，以及按天查询结果 SQL。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/04-aggregation-query-api.md`
- 验证结果：
  - `rg -n "create table if not exists daily_operator_active_duration|insert into daily_operator_active_duration|on conflict|:target_date|minute_summary_records|boss_daily_operator_active_duration" docs/modules/04-aggregation-query-api.md` 确认可执行 SQL 关键结构存在。
  - 已检查 SQL 章节包含目标表、参数说明、source 表假设、upsert 和查询语句。
- 风险/阻塞：本轮只写 SQL 文档，未连接真实数据库执行；后续落库时需要确认 `minute_summary_records` 实际列名是否与文档一致，尤其是 `chat_snapshot_captured` / `snapshot_captured` 字段。
- 中断续写入口：下一步可把该 SQL 做成 migration/worker，或按真实表结构调整字段名后执行。

### 任务：生成当日活跃时长指标生产逻辑

- 时间：2026-05-18 16:12
- 执行者：AI
- 状态：已完成
- 目标：按用户要求，从分钟级数据设计“当日活跃时长”指标生产逻辑。
- 当前理解：该指标必须从分钟级 summary 产物生成，不能回查原始日志；核心口径应按操作员每天有效活跃分钟去重计数，而不是按事件数、summary 行数或多个 metric 相加。需要明确 day 边界、有效分钟判定、去重、异常 operator 处理和生产落地方式。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/modules/04-aggregation-query-api.md`
- 不修改范围：
  - 不修改业务代码
  - 不修改 `analysis-system/` 之外文件
  - 不查询真实 CLS 或 raw SearchLog
  - 不输出员工绩效结论
- 验证计划：检查文档中新增指标口径是否包含输入、输出、去重规则、SQL/伪代码和边界说明。
- 下一步：编辑聚合/API 模块文档。

#### 阶段记录：完成当日活跃时长逻辑文档

- 时间：2026-05-18 16:13
- 状态：已完成
- 已完成：在 `docs/modules/04-aggregation-query-api.md` 新增 `当日活跃时长` 指标生产逻辑，定义从 `boss_minute_operator_funnel` 和 `boss_minute_chat` 的分钟级 summary 中按 `operator_id + active_date + minute` 去重计数，输出 `active_minutes`、`active_seconds`、首末活跃分钟、来源行数等字段；明确 `<missing>` 不归属真实操作员，生产链路不得使用 SearchLog。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/04-aggregation-query-api.md`
- 验证结果：
  - `rg -n "当日活跃时长|daily_active_duration|active_minutes|boss_daily_operator_active_duration|active_signal|source_row_count" docs/modules/04-aggregation-query-api.md docs/ai-worklog.md` 确认关键词和口径写入。
  - 已人工检查新增章节包含输入来源、口径定义、输出字段、伪 SQL、幂等键、刷新策略和边界展示。
- 风险/阻塞：本轮只生成指标生产逻辑文档，未实现后端 API 或前端展示；后续实现时需补单元测试覆盖同一分钟多 metric 去重。
- 中断续写入口：下一步可在 domain/query service 中实现 `daily_active_duration`，或做 CLS/DB 日级汇总任务。

### 任务：用原始日志排查 summary 异常行

- 时间：2026-05-18 15:31
- 执行者：AI
- 状态：已完成
- 目标：按用户要求，临时查询原始 CLS 日志，排查大盘“流水线异常”里缺操作员 summary 行是怎么来的。
- 当前理解：这是一次开发排障验证，允许临时使用 CLS SearchLog；不得把 raw search 接入实现或生产链路。异常数来自 `summary_missing_operator_count`，也就是 summary topic 中 `operator_id` 为 `<missing>` 的分钟汇总行，需要先定位这些 summary 行，再回查对应分钟附近的 raw topic 事件字段。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改业务代码
  - 不启动或停止 dev 服务
  - 不输出密钥、聊天正文、联系方式或完整简历正文
  - 不把 raw SearchLog 写成生产依赖
- 验证计划：读取本地 `.env.local` 配置；查询 summary topic 的缺 operator 行；按分钟和事件类型回查 raw topic，汇总 event_type、operator_id、job_id、session_id 等脱敏字段。
- 下一步：执行只读 raw SearchLog 排障查询。

#### 阶段记录：完成 raw 日志反查

- 时间：2026-05-18 15:36
- 状态：已完成
- 已完成：临时使用 CLS SearchLog 做开发排障；先查询 summary topic 当前窗口，发现当前缺 operator 异常为 5 条而不是 7 条，均为 `boss_minute_operator_funnel`，集中在 `2026-05-18 12:34` 到 `12:38`，job 为 `a77c258dc3864d2d0nd-3tS_GFBY`；再按这些分钟回查 raw topic，命中 63 条相关原始事件，所有命中事件的 `operator_id` 都是 `zhouxinyu`。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：
  - summary 当前窗口：`summary_total=55`，`missing_total=5`，`missing_by_metric={'boss_minute_operator_funnel': 5}`。
  - raw 反查窗口：`raw_total_window=81`，匹配异常分钟和 job 的 raw 行 `63` 条，`by_operator={'zhouxinyu': 63}`。
  - raw 事件类型分布：`candidate_list.card_exposed=18`、`candidate_detail.opened=17`、`candidate_detail.closed=17`、`candidate_greeting.clicked=5`、`candidate_greeting.succeeded=3`、`page_session.page_dwell_recorded=1`、`page_session.page_changed=1`、`candidate_chat.report_required=1`。
- 风险/阻塞：当前异常不是插件 raw 日志缺 `operator_id`，而是 summary SQL/CLS 索引或历史汇总阶段把已有 `operator_id=zhouxinyu` 的 raw 事件聚成了 `<missing>`；需要检查定时 SQL 和 CLS 字段索引生效时间，历史 `<missing>` summary 行不会自动修正。
- 中断续写入口：下一步可检查 `boss_minute_operator_funnel` 的定时 SQL 字段引用，或清理/重算 `boss_summary_minute_prod` 中历史 `<missing>` 行。

### 任务：关闭全部本地 dev 进程

- 时间：2026-05-18 15:21
- 执行者：AI
- 状态：已完成
- 目标：按用户要求，关闭当前所有 analysis-system 本地 dev 进程，释放后端和前端端口。
- 当前理解：用户 Ctrl-C 后进程没有释放；当前确认后端 PID 75398 监听 8765，Vite PID 80079 监听 5173，esbuild PID 80080 仍存在，5174 当前未监听。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改代码或配置
  - 不修改 `analysis-system/` 之外文件
  - 不查询真实 CLS
- 验证计划：按 PID 精确停止后端、Vite、esbuild；检查 `pgrep` 和 8765/5173/5174 端口均无监听。
- 下一步：停止 PID 75398、80079、80080 并验证端口释放。

#### 阶段记录：dev 进程已全部关闭

- 时间：2026-05-18 15:25
- 状态：已完成
- 已完成：停止后端 PID 75398、Vite PID 80079、esbuild PID 80080。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：
  - `pgrep -fl "boss_analysis.dev_server|/analysis-system/frontend/node_modules/.bin/vite|/analysis-system/frontend/node_modules/@esbuild"` 无输出。
  - `lsof -nP -iTCP:8765 -sTCP:LISTEN` 无输出。
  - `lsof -nP -iTCP:5173 -sTCP:LISTEN` 无输出。
  - `lsof -nP -iTCP:5174 -sTCP:LISTEN` 无输出。
- 风险/阻塞：无；当前本地 dev 端口已释放。
- 中断续写入口：用户后续可手动运行 `./dev.sh` 重新以前台方式启动。

### 任务：清理残留 5174 dev 端口

- 时间：2026-05-18 15:15
- 执行者：AI
- 状态：已完成
- 目标：处理用户反馈 Ctrl-C 后 5174 端口仍未停止的问题，并避免 Vite 后续自动漂移到 5174。
- 当前理解：当前 5174 由残留 Vite 进程监听；同时还有一个正常 Vite 进程监听 5173。Vite 默认在指定端口被占用时会尝试下一个端口，因此重复启动可能出现 5174。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `dev.sh`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不停止当前正常 5173/8765 dev 服务
  - 不查询真实 CLS
- 验证计划：释放 5174；确认 5174 不再监听；给 Vite 增加 strict port；运行 `bash -n dev.sh`。
- 下一步：更新 `dev.sh`，避免以后自动切到 5174。

#### 阶段记录：释放 5174 并禁止 Vite 自动换端口

- 时间：2026-05-18 15:17
- 状态：已完成
- 已完成：用 `lsof` 确认 5174 被 Vite PID 80127 监听；按用户反馈停止该残留进程；`dev.sh` 的 Vite 启动参数增加 `--strictPort`，后续如果 5173 被占用会直接失败，不再自动切到 5174。
- 改动文件：
  - `dev.sh`
  - `docs/ai-worklog.md`
- 验证结果：
  - `lsof -nP -iTCP:5174 -sTCP:LISTEN` 无输出，5174 已释放。
  - `lsof -nP -iTCP:5173 -sTCP:LISTEN` 显示当前正常 Vite PID 80079。
  - `pgrep -fl "boss_analysis.dev_server|vite|esbuild"` 显示后端 PID 75398、Vite PID 80079、esbuild PID 80080。
  - `bash -n dev.sh` 通过。
- 风险/阻塞：当前 5173/8765 dev 服务仍按用户控制继续运行；如果要重启加载最新代码，需要用户在对应前台终端 Ctrl-C 后重新运行 `./dev.sh`。
- 中断续写入口：任务已完成；若再次出现端口漂移，优先检查是否有多个 `./dev.sh` 实例同时运行。

### 任务：排查活跃但无分钟趋势

- 时间：2026-05-18 15:08
- 执行者：AI
- 状态：已完成
- 目标：排查用户反馈“显示几分钟前活跃，但单人详情没有分钟趋势”的原因。
- 当前理解：如果活跃状态和详情都来自同一批 summary 记录，`/api/operator/{operator_id}` 应该返回 `minute_points`；若没有趋势，优先检查当前运行的后端是否已重启到包含 `minute_points` 的新代码。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改代码
  - 不启动或停止 dev 服务
  - 不查询真实 CLS 之外的数据源
- 验证计划：查看当前 dev 进程；请求 `/api/dashboard`、`/api/operator/zhouxinyu` 和 `/api/operators` 对比 active operator 与 detail payload。
- 下一步：告知用户重启 dev server。

#### 阶段记录：确认后端进程未加载新代码

- 时间：2026-05-18 15:09
- 状态：已完成
- 已完成：确认当前有后端 PID 75398 和 Vite PID 75400 在跑；`/api/dashboard` 返回 `active_operators[0].operator_id=zhouxinyu`、最近活跃时间 `2026-05-18T15:05:00+08:00`、summary 记录 51 条；`/api/operator/zhouxinyu` 返回累计 funnel/chat/job_ids，但没有 `minute_points` 字段。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：当前运行后端没有加载刚新增的 `OperatorAnalytics.minute_points` 代码；需要用户 Ctrl-C 停止当前 `./dev.sh` 前台进程并重新运行 `./dev.sh`。
- 风险/阻塞：本轮不主动停止用户 dev 进程。
- 中断续写入口：重启后再次请求 `/api/operator/zhouxinyu`，应能看到 `operator.minute_points` 数组；若仍为空，再检查 summary 中 `operator_id` 是否和配置完全一致。

### 任务：活跃状态定时刷新和单人分钟折线图

- 时间：2026-05-18 15:00
- 执行者：AI
- 状态：已完成
- 目标：按用户要求，把大盘操作员活跃状态改成定时刷新；单人详情改成按分钟 summary 取数打点的折线图。
- 当前理解：前端当前只在首屏加载一次 dashboard/operator/detail；后端 `OperatorAnalytics` 只返回累计漏斗和聊天指标，没有分钟序列。本轮应在后端从 `MinuteSummaryRecord` 聚合出单人分钟点，并在前端用轮询刷新 dashboard 和详情，用 SVG 绘制分钟级折线图。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/metrics.py`
  - `src/boss_analysis/api/query_service.py`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `frontend/src/types.ts`
  - 相关测试
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不启动或停止 dev 服务
  - 不查询真实 CLS
  - 不新增前端依赖
- 验证计划：补后端分钟点单测；运行 Python 单测、compileall、前端 build。
- 下一步：新增分钟点模型和 query 聚合，再更新前端轮询与折线图。

#### 阶段记录：完成轮询刷新和分钟折线图

- 时间：2026-05-18 15:05
- 状态：已完成
- 已完成：新增 `OperatorMinutePoint` 领域模型，`OperatorAnalytics` 返回 `minute_points`；query service 按操作员和分钟聚合 summary 记录，漏斗字段来自 `boss_minute_operator_funnel`，聊天字段来自 `boss_minute_chat`，避免同一分钟双算聊天指标；前端 dashboard 和 operator detail 均改为 15 秒定时刷新，初次加载保留 loading，后台刷新不清空已有画面；单人详情新增 SVG 分钟趋势折线图，按分钟点展示卡片、详情、打招呼、聊天、微信曲线。
- 改动文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/metrics.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/api/query_service.py`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `frontend/src/types.ts`
  - `tests/test_query_service.py`
- 验证结果：
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-test-pycache python3 -m unittest discover -s tests` 通过，88 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-compile-pycache python3 -m compileall src` 通过。
  - `frontend/` 下 `npm run build` 通过。
  - `rg -n "minute_points|MinuteLineChart|setInterval|OperatorMinutePoint|REFRESH_INTERVAL_MS" src frontend/src tests` 确认轮询和分钟点实现存在。
- 风险/阻塞：本轮未启动 dev 服务，未真机查看图表；用户需手动运行 `./dev.sh` 查看。当前前端轮询间隔固定为 15 秒，后续如需可改成环境变量或 API 返回配置。
- 中断续写入口：任务已完成；下一步可在页面上真机查看折线图密度、颜色和移动端布局。

### 任务：前台启动 dev 服务

- 时间：2026-05-18 14:51
- 执行者：AI
- 状态：阻塞
- 目标：按用户要求，把 dev 服务以前台方式启动，确保用户可以用 Ctrl-C 停止。
- 当前理解：当前已有旧后端和 Vite 进程占用 8765/5173，且后端仍使用旧 `cls-search` 参数；这些进程无法接回当前终端前台，只能停止后用新版 `./dev.sh` 前台重启。`dev.sh` 当前已以前台 wrapper 方式等待，Ctrl-C 会触发 cleanup 停掉后端和前端。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不改代码或配置
  - 不查询真实 CLS
- 验证计划：确认旧进程 PID；停止旧进程；以前台方式运行 `./dev.sh`，观察后端和前端启动输出。
- 下一步：停止旧 dev 进程并前台启动新版脚本。

#### 阶段记录：旧进程已停，前台启动被权限阻塞

- 时间：2026-05-18 14:54
- 状态：阻塞
- 已完成：确认旧 dev 进程存在，后端仍使用旧 `--data-source cls-search` 参数；已停止旧后端 PID 63848 和旧 Vite PID 68038；尝试以前台方式运行 `./dev.sh`。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：
  - 沙箱内前台启动失败：后端访问腾讯云 HTTPS 报 `Operation not permitted`，Vite 监听 `127.0.0.1:5173` 报 `listen EPERM`。
  - 已申请非沙箱前台运行 `./dev.sh`，但授权被拒绝。
  - `pgrep -fl "boss_analysis.dev_server|vite|npm"` 当前无 dev 进程。
- 风险/阻塞：无法在当前沙箱权限下启动需要网络和本地端口监听的 dev 服务；需要用户在自己的终端运行 `./dev.sh`，或重新允许非沙箱运行。
- 中断续写入口：用户可在 `analysis-system/` 目录直接运行 `./dev.sh`；它会以前台 wrapper 方式启动，Ctrl-C 会停止前后端。

### 任务：用 summary 数据源替代 raw search 实现

- 时间：2026-05-18 14:37
- 执行者：AI
- 状态：已完成
- 目标：按用户要求更新现有实现，把以前直接读取 raw CLS SearchLog 的数据源路径替换为分钟汇总 summary 路径。
- 当前理解：当前 dev server 仍保留 `cls-search` raw 日志读取入口和相关测试/文档；本轮应把运行入口、默认 alias、文档说明和测试改为 summary-first/summary-only。底层 SearchLog 客户端可保留给本地读取 summary topic 做验证，但 raw `cls-search` 不再作为 dashboard/dev 数据源。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `README.md`
  - `.env.example`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `src/boss_analysis/consumer/cls_search.py`
  - 相关测试
  - `dev.sh`
  - `.env.example`
  - `.env.local`
  - 视检查结果更新相关模块文档
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不启动或停止 dev 服务
  - 不查询真实 CLS
  - 不删除底层 dev 验证用 SearchLog 客户端，除非代码已无引用
- 验证计划：用 `rg` 找出 `cls-search`/raw SearchLog 数据源入口；修改后运行 Python 单测、compileall、前端 build 和 dev server help 检查。
- 下一步：梳理代码中 `cls-search` 与 raw SearchLog 路径，确定需要移除/替换的实现点。

#### 阶段记录：完成 summary 替代 raw search 实现

- 时间：2026-05-18 14:45
- 状态：已完成
- 已完成：dev 数据源入口统一为 `summary`，移除 dashboard/dev server 的 raw `cls-search` 数据源选择；`real` 在无数据文件时改走 summary，有数据文件时仍读本地文件；`dev.sh`、`.env.example`、`.env.local` 默认值改为 `summary`，并移除本地 raw `CLS_SEARCH_*` 配置；后端 CLI choices 仅保留 `auto/real/demo/file/summary/empty`；底层 SearchLog helper 仅作为本地 summary topic 验证工具保留，并在 `APP_ENV=production` 下失败关闭；文档同步说明 SearchLog 只能本地验证，不能接入正式输入链路。
- 改动文件：
  - `AGENTS.md`
  - `.env.example`
  - `.env.local`
  - `README.md`
  - `dev.sh`
  - `docs/ai-worklog.md`
  - `docs/modules/01-ingestion-normalization.md`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `src/boss_analysis/consumer/cls_search.py`
  - `tests/test_cls_search.py`
  - `tests/test_dev_data.py`
  - `tests/test_dev_server.py`
  - `tests/test_summary_reader.py`
- 验证结果：
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-test-pycache python3 -m unittest discover -s tests` 通过，88 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-compile-pycache python3 -m compileall src` 通过。
  - `frontend/` 下 `npm run build` 通过。
  - `bash -n dev.sh` 通过。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-help-pycache python3 -m boss_analysis.dev_server --help` 通过，CLI 仅显示 `summary`，不再显示 raw search 数据源。
  - `rg -n "cls-search|cls_search|summary-search|summary_search|CLS_SEARCH_TOPIC_ID|CLS_SEARCH_QUERY|load_cls_search_config" AGENTS.md README.md .env.example dev.sh src tests docs/modules docs/boundary.md docs/overview-design.md` 只剩底层 summary SearchLog helper 命名相关结果，不再有 raw search 数据源入口。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-env-pycache python3 -c "from boss_analysis.dev_server import load_env_files; import os; load_env_files(None); assert os.environ.get('BOSS_ANALYSIS_DATA_SOURCE') == 'summary'; assert os.environ.get('CLS_SUMMARY_TOPIC_ID'); assert 'CLS_SEARCH_TOPIC_ID' not in os.environ; print('env local summary-only config ok')"` 通过。
- 风险/阻塞：本轮没有启动、停止或重启 dev 服务；旧进程若仍以旧参数运行，需要用户手动重启。底层文件名 `cls_search.py` 和 `CLS_SEARCH_VERSION` 仍保留，因为腾讯云 API 动作本身叫 SearchLog，仅用于本地 summary topic 验证，生产由 `APP_ENV=production` 防护失败关闭。
- 中断续写入口：任务已完成；下一步如果进入正式部署，需要把 summary 的生产消费链路接到 Kafka/投递/数据库，不得使用 SearchLog。

### 任务：补充正式环境禁止 Search 接口约束

- 时间：2026-05-18 14:35
- 执行者：AI
- 状态：已完成
- 目标：按用户要求，在 `AGENTS.md` 中加入强约束：正式环境不允许使用 CLS Search/SearchLog 接口，Search 只允许开发验证使用。
- 当前理解：当前本地 dev 支持 `cls-search` 和 `summary-search`，其中 `summary-search` 也是通过 SearchLog 读取汇总主题；这些能力应被明确限定为本地开发、临时排障和验证，不得进入生产 API、worker、部署脚本或正式数据链路。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `AGENTS.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不改运行代码或当前 dev 配置
  - 不启动或停止 dev 服务
  - 不查询真实 CLS
- 验证计划：检查 `AGENTS.md` 中新增强约束语义明确，并用关键词搜索确认写入。
- 下一步：编辑 `AGENTS.md` 边界规则和实现规则。

#### 阶段记录：完成 Search 接口生产禁用约束

- 时间：2026-05-18 14:38
- 状态：已完成
- 已完成：在 `AGENTS.md` 新增 `CLS Search 接口强约束` 小节，明确正式环境不得使用 CLS Search/SearchLog 作为数据源；`cls-search`、`summary-search` 和任何 SearchLog reader 仅限本地开发、一次性排障和上线前验证；正式分钟汇总必须走已批准的非 Search 生产消费链路；生产配置下可能触发 Search/SearchLog 的代码路径必须失败关闭或移除。
- 改动文件：
  - `AGENTS.md`
  - `docs/ai-worklog.md`
- 验证结果：
  - `sed -n '12,55p' AGENTS.md` 确认新增约束位置和全文。
  - `rg -n "CLS Search 接口强约束|正式环境严禁|summary-search|SearchLog|失败关闭" AGENTS.md docs/ai-worklog.md` 确认关键词写入。
- 风险/阻塞：本轮只修改协作规范和工作日志，没有改运行代码；后续做正式部署或生产 worker 时仍需要按此约束补代码级防护。
- 中断续写入口：任务已完成；后续若进入生产部署，应优先检查 `src/boss_analysis/dev_data.py`、`src/boss_analysis/consumer/cls_search.py` 和部署配置，确保生产环境不能走 SearchLog。

### 任务：补充本地 summary 环境配置

- 时间：2026-05-18 14:32
- 执行者：AI
- 状态：已完成
- 目标：按用户反馈，把 `.env.local` 补齐分钟汇总数据源相关配置，避免 `dev.sh` 默认 `summary-search` 时仍缺少 `CLS_SUMMARY_*`。
- 当前理解：`.env.example` 已包含 summary 配置，但 `.env.local` 仍停在 raw `cls-search` 配置；本轮只更新 `analysis-system/.env.local` 和工作日志，不改代码、不启动或停止 dev 进程。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `.env.local`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不覆盖本地腾讯云密钥
  - 不启动或停止 dev 服务
  - 不查询真实 CLS
- 验证计划：检查 `.env.local` 中 summary 相关键存在，且不输出密钥值；必要时做脚本语法级验证。
- 下一步：补齐 `.env.local` 的 `BOSS_ANALYSIS_*` 和 `CLS_SUMMARY_*`。

#### 阶段记录：完成 `.env.local` summary 配置补齐

- 时间：2026-05-18 14:35
- 状态：已完成
- 已完成：将 `.env.local` 默认数据源改为 `summary-search`，补充 `BOSS_ANALYSIS_REQUIRE_REAL_DATA`、`BOSS_ANALYSIS_SUMMARY_DATA_FILE`、`BOSS_ANALYSIS_OPERATOR_CONFIG_FILE`，并加入 `CLS_SUMMARY_*` 配置指向已验证的 `boss_summary_minute_prod` 汇总主题；保留原 raw `CLS_SEARCH_*` 配置作为旧数据源配置。
- 改动文件：
  - `.env.local`
  - `docs/ai-worklog.md`
- 验证结果：
  - `bash -n dev.sh` 通过。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-env-pycache python3 -c "from boss_analysis.dev_server import load_env_files; import os; load_env_files(None); assert os.environ.get('BOSS_ANALYSIS_DATA_SOURCE') == 'summary-search'; assert os.environ.get('BOSS_ANALYSIS_REQUIRE_REAL_DATA') == '1'; assert os.environ.get('BOSS_ANALYSIS_OPERATOR_CONFIG_FILE') == 'config/operators.local.json'; assert os.environ.get('CLS_SUMMARY_TOPIC_ID'); print('env local summary config ok')"` 通过。
- 风险/阻塞：本轮没有启动、停止或重启 dev 服务；如果旧进程仍在跑，需要用户手动重启后才能读取新的 `.env.local`。
- 中断续写入口：任务已完成；下一步用户重启 `./dev.sh` 后检查 `/api/dashboard.source.kind` 是否为 `summary_search`。

### 任务：操作员先渲染并切换分钟汇总数据源

- 时间：2026-05-18 14:18
- 执行者：AI
- 状态：已完成
- 目标：按用户要求调整大盘加载流程：操作员列表先从本地配置加载出来，数据返回后只更新活跃状态；加载期间展示 loading；dev 默认数据源改为分钟级汇总，后续不再查询原始 raw 日志。
- 当前理解：`dev.sh` 已被用户改成默认 `cls-search` 并要求真实数据；本轮改为 `summary-search`，只读 `CLS_SUMMARY_TOPIC_ID` 或 `BOSS_ANALYSIS_SUMMARY_DATA_FILE`。新增 `/api/operators` 只读本地 operator 配置，避免前端为了显示名单等待 dashboard/summary 查询。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `dev.sh`
  - `.env.example`
  - `README.md`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `frontend/src/api.ts`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `frontend/src/types.ts`
  - 相关测试
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不启动本地 dev server 或 Vite
  - 不查询真实 CLS
  - 不改变插件或根项目日志契约
- 验证计划：补充离线测试覆盖 summary-only 数据源和 `/api/operators`；运行 Python 测试、前端 build、脚本语法检查。
- 下一步：用户手动停止旧 dev 进程后运行新版 `./dev.sh` 验证页面。

#### 阶段记录：完成列表加载和 summary-only 接入

- 时间：2026-05-18 14:26
- 状态：已完成
- 已完成：新增 `summary-search` 数据源模式，后端在该模式下只加载 `BOSS_ANALYSIS_SUMMARY_DATA_FILE` 或 `CLS_SUMMARY_TOPIC_ID` 的分钟汇总，不查询原始 raw 日志；`dev.sh` 默认改为 `summary-search` 并默认要求真实汇总配置；新增 `/api/operators` 直接返回本地操作员配置，前端启动后先加载并渲染操作员列表，dashboard/summary 返回后只更新活跃状态；前端增加分钟汇总、操作员列表、单人明细的 loading 和错误态；README 和 `.env.example` 同步说明。
- 改动文件：
  - `.env.example`
  - `README.md`
  - `dev.sh`
  - `docs/ai-worklog.md`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `frontend/src/App.tsx`
  - `frontend/src/api.ts`
  - `frontend/src/styles.css`
  - `frontend/src/types.ts`
  - `tests/test_dev_data.py`
  - `tests/test_dev_server.py`
- 验证结果：
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-test-pycache python3 -m unittest discover -s tests` 通过，87 个测试。
  - `frontend/` 下 `npm run build` 通过。
  - `bash -n dev.sh` 通过。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-help-pycache python3 -m boss_analysis.dev_server --help` 通过，CLI 已包含 `summary-search`。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-compile-pycache python3 -m compileall src` 通过。
- 风险/阻塞：按用户要求本轮没有启动或停止 dev 服务。验证时发现本机已有用户侧旧进程在跑：后端 `--data-source cls-search`、前端 Vite `5173`；若要使用新逻辑，需要用户手动停止旧进程并重新运行 `./dev.sh`。
- 中断续写入口：任务已完成；后续可把前端状态轮询或 summary 最新时间告警做细。

### 任务：生成 dev.sh 一键开发启动脚本

- 时间：2026-05-18 14:09
- 执行者：AI
- 状态：已完成
- 目标：按用户要求生成 `dev.sh`，以后由用户手动运行该脚本启动前后端本地开发服务。
- 当前理解：用户不希望 AI 再主动启动或关闭 dev 进程；本轮只创建脚本、更新说明并做静态验证。脚本默认启动 demo/mock 数据，前端代理到同一个后端端口；真实 CLS 模式可通过环境变量覆盖。
- 计划修改文件：
  - `dev.sh`
  - `README.md`
  - `frontend/vite.config.ts`
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不启动本地 dev server 或 Vite
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实 CLS 资源或密钥配置
- 验证计划：运行 `bash -n dev.sh`、前端 build、必要时检查 dev server CLI help；不执行 `./dev.sh`。
- 下一步：用户手动运行 `./dev.sh` 做端到端启动验证。

#### 阶段记录：完成 dev.sh

- 时间：2026-05-18 14:11
- 状态：已完成
- 已完成：新增可执行 `dev.sh`，默认以 demo/mock 数据启动后端 `boss_analysis.dev_server` 和前端 Vite；脚本设置 `PYTHONPATH`、前端 API target、操作员配置文件，支持通过 `BOSS_ANALYSIS_*` 环境变量覆盖端口、数据源、真实数据要求和刷新间隔；`Ctrl-C` 会同时停止两个子进程。README 增加本地一键开发说明；Vite 配置支持从 shell 环境读取 `BOSS_ANALYSIS_API_TARGET`。
- 改动文件：
  - `dev.sh`
  - `README.md`
  - `frontend/vite.config.ts`
  - `docs/ai-worklog.md`
- 验证结果：
  - `bash -n dev.sh` 通过。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-help-pycache python3 -m boss_analysis.dev_server --help` 通过。
  - `frontend/` 下 `npm run build` 通过。
  - 检查确认未启动 `boss_analysis.dev_server`、`npm run dev` 或 Vite 进程。
- 风险/阻塞：本轮按用户要求没有执行 `./dev.sh` 做端到端启动验证；首次运行若 `frontend/node_modules` 不存在，脚本会提示先在 `frontend/` 下执行 `npm install`。
- 中断续写入口：任务已完成；用户可手动运行 `./dev.sh`。

### 任务：修复 mock 大盘白屏

- 时间：2026-05-18 14:00
- 执行者：AI
- 状态：排查中
- 目标：用户反馈大盘白屏；定位是静态页面、前端运行时、接口数据结构还是 dev server 启动方式导致，并修复到可打开可展示 10 个 mock 操作员。
- 当前理解：`http://127.0.0.1:8766/api/dashboard` 已返回 10 个活跃操作员和 64 条 demo 事件；因此优先排查浏览器页面 JS/CSS 和前端入口。8765 仍是原真实数据 server，本轮不动真实数据进程。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - 视排查结果可能修改 `src/boss_analysis/dev_server.py` 或 `frontend/src/*`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不停止或覆盖 8765 真实数据 server
  - 不修改真实 CLS 资源
- 验证计划：用 curl/浏览器或静态检查复现白屏；修复后重新运行相关 Python 测试、前端 build，并确认页面/API 可展示 10 个 mock 操作员。
- 下一步：检查 8766 首页、静态 JS/CSS、前端源码和浏览器错误。

### 任务：生成 10 个操作员 mock 数据

- 时间：2026-05-18 13:46
- 执行者：AI
- 状态：已完成
- 目标：按用户要求，在本地操作员配置和 demo 数据中生成 10 个 mock 操作员，让大盘后续能展示这些人，并且每个人都有活跃状态和可查看的单人详细数据。
- 当前理解：用户已手动修改 `config/operators.local.json`，其中 `zhouxinyu` 展示名为“周心语”，本轮必须保留该修改；本地配置文件仍是开发阶段方案，生产阶段再迁移到数据库或管理页。本轮不改真实 CLS 资源，不碰 analysis-system 之外文件。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `config/operators.local.json`
  - `config/operators.example.json`
  - `src/boss_analysis/dev_data.py`
  - `tests/test_dev_server.py`
  - 视需要修改 README 或前端展示
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实 CLS 资源或定时 SQL
  - 不读取插件运行时、Chrome storage 或 debug 页作为生产依赖
  - 不覆盖用户已修改的 `zhouxinyu` 展示信息
- 验证计划：运行 Python 单元测试、compileall 和前端 build；必要时用 dev dataset 检查 10 个 mock 操作员都有事件和单人指标。
- 下一步：后续可把 operator registry 从本地 JSON 迁移到数据库/管理页，并在大盘加人员详情钻取交互。

#### 阶段记录：完成 mock 数据生成

- 时间：2026-05-18 13:51
- 状态：待验证
- 已完成：保留用户修改的 `zhouxinyu` / “周心语” / “谢女士”，在本地操作员配置中补齐 10 个启用操作员；新增可提交的示例配置；将 demo seed 改为 10 个与配置一致的 operator_id，每人都有曝光、详情打开、打招呼点击/成功、聊天打开、聊天快照，部分人额外有微信捕获事实；更新 dev server 测试以断言 10 人均为活跃且单人详情指标非空。
- 改动文件：
  - `config/operators.local.json`
  - `config/operators.example.json`
  - `src/boss_analysis/dev_data.py`
  - `tests/test_dev_server.py`
  - `docs/ai-worklog.md`
- 验证结果：待运行 Python 单元测试、compileall 和前端 build。
- 风险/阻塞：`config/operators.local.json` 是本地开发配置，部署后仍不适合作为实时配置源；正式阶段需要迁移到数据库或管理页。当前 demo 数据不会影响真实 CLS 数据源。
- 中断续写入口：从运行测试开始；如果测试通过，更新本任务为已完成。

#### 阶段记录：验证通过并完成任务

- 时间：2026-05-18 13:51
- 状态：已完成
- 已完成：完成 10 个本地 mock 操作员与对应 demo 事实数据；默认 demo dashboard 可返回 10 个配置操作员、10 个活跃操作员，并且单人详情有曝光、详情、打招呼、聊天指标。
- 改动文件：
  - `config/operators.local.json`
  - `config/operators.example.json`
  - `src/boss_analysis/dev_data.py`
  - `tests/test_dev_server.py`
  - `docs/ai-worklog.md`
- 验证结果：
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-test-pycache python3 -m unittest discover -s tests` 通过，84 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-compile-pycache python3 -m compileall src` 通过。
  - `frontend/` 下 `npm run build` 通过。
  - `DevApp(data_source="demo").dashboard_payload()` 快速检查返回 active/configured 数量均为 10。
  - 已在 `http://127.0.0.1:8766` 启动 demo dev server；`curl -L http://127.0.0.1:8766/api/dashboard` 返回 `active_count=10`、`configured_operators=10`、`raw_event_count=64`。
- 风险/阻塞：本地 JSON 只是开发期可热改入口；部署后需要迁移到可在线修改的 operator registry。
- 中断续写入口：任务已完成；demo dev server 已在 `http://127.0.0.1:8766` 启动，下一步可目测大盘或继续做单人详情钻取 UI。

### 任务：本地操作员配置文件

- 时间：2026-05-18 13:21
- 执行者：AI
- 状态：已完成
- 目标：按用户最新要求，先用本地配置文件维护操作员列表，并生成一个可直接修改的配置文件；本地 dev server 应能热加载，便于不重启页面就调整操作员展示。
- 当前理解：长期部署后本地文件不适合作为最终方案，后续应迁到数据库或后台管理页；但本轮先落地 `analysis-system/config/operators.local.json`，让当前本地开发页面能显示配置过的操作员名称/账号，并保留从 CLS 观察到的活跃状态。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `.gitignore`
  - `.env.example`
  - `config/operators.local.json`
  - 视代码结构新增或修改 operator 配置读取、QueryService、dev server、前端类型和测试
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实 CLS 资源
  - 不读取插件运行时、Chrome storage 或 debug 页作为生产依赖
  - 不把本地文件方案写成最终生产方案
- 验证计划：新增离线单元测试覆盖配置解析和热加载；运行 Python 测试、compileall 和前端 build。
- 下一步：新增 operator 配置模型和 dev server 热加载接入。

#### 阶段记录：完成本地操作员配置

- 时间：2026-05-18 13:25
- 状态：已完成
- 已完成：生成 `config/operators.local.json`，默认包含当前真实日志里的 `zhouxinyu`；新增可提交模板 `config/operators.example.json`；新增 operator 配置解析和 mtime 热加载；dev server 在 dashboard/operator payload 生成前重新加载配置；QueryService 将配置里的展示名和账号名合并进活跃操作员摘要，并返回启用的配置操作员列表；前端操作员列表优先展示配置文件中的操作员，活跃状态来自 CLS/事实流；文档说明本地文件只作为开发阶段展示配置，生产后应迁移到数据库或管理页。
- 改动文件：
  - `.gitignore`
  - `.env.example`
  - `README.md`
  - `config/operators.example.json`
  - `config/operators.local.json`（git ignore，本地配置）
  - `docs/ai-worklog.md`
  - `docs/boundary.md`
  - `docs/overview-design.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `src/boss_analysis/api/query_service.py`
  - `src/boss_analysis/dev_server.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/domain/metrics.py`
  - `src/boss_analysis/domain/operators.py`
  - `src/boss_analysis/operator_config.py`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `frontend/src/types.ts`
  - `tests/test_dev_server.py`
  - `tests/test_operator_config.py`
  - `tests/test_query_service.py`
- 验证结果：
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-test-pycache python3 -m unittest discover -s tests` 通过，84 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-compile-pycache python3 -m compileall src` 通过。
  - `frontend/` 下 `npm run build` 通过。
  - `git status --ignored config` 确认 `config/operators.local.json` 被忽略，模板 `config/operators.example.json` 可提交。
- 风险/阻塞：本地文件方案不适合最终部署后的多人实时管理；正式阶段应把同一结构迁移到数据库或后台配置 API。本轮只配置展示元数据，不改变事实归因口径，`operatorId` 必须与 CLS `operator_id` 完全一致。
- 中断续写入口：修改 `config/operators.local.json` 后刷新前端即可看到新操作员列表；后续可实现数据库版 operator registry 和管理页。

### 任务：接入 CLS 分钟汇总结果

- 时间：2026-05-18 12:47
- 执行者：AI
- 状态：已完成
- 目标：用户已在 CLS 配置 `boss_minute_chat` 和 `boss_minute_operator_funnel` 两个核心定时 SQL 任务；本轮更新 analysis-system 本地设计文档和代码，使本地系统可以识别并消费分钟汇总主题结果，减少对 raw event 临时聚合的依赖。
- 当前理解：生产分钟级统计由 CLS 定时 SQL 写入 `boss_summary_minute_prod`；本地系统应保留 raw event fallback 和离线样本测试，同时新增 summary reader/模型/查询入口。当前已发现源主题 `boss` 的 `operator_id` 索引类型被建成 `long`，会导致新汇总中 operator 变成 `<missing>`，需要在文档和代码里保留这种异常状态的可见性。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/overview-design.md`
  - `docs/runtime-plan.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `src/boss_analysis/consumer/cls_search.py`
  - 视代码结构新增或修改 summary/domain/query/frontend/test 文件
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实 CLS 资源或定时 SQL 任务
  - 不读取插件运行时、Chrome storage 或 debug 页作为生产依赖
  - 不输出或保存密钥、聊天正文、联系方式或完整简历正文
- 验证计划：先阅读现有 dev server/query/frontend 数据流；新增离线样本单元测试覆盖分钟汇总解析和查询；运行 Python 测试、compileall，必要时运行前端 build。
- 下一步：梳理当前 dashboard/operator API 与前端字段，确定 summary 数据以何种结构进入 QueryService。

#### 阶段记录：完成本地分钟汇总接入

- 时间：2026-05-18 13:02
- 状态：已完成
- 已完成：新增 CLS 分钟汇总领域模型和 summary reader，支持从 `BOSS_ANALYSIS_SUMMARY_DATA_FILE` 或 `CLS_SUMMARY_TOPIC_ID` 读取 `boss_summary_minute_prod`；QueryService 对单人漏斗/聊天指标优先使用 `boss_minute_operator_funnel` 和 `boss_minute_chat`，缺失时回退 raw event/fact；dashboard health 增加 summary 记录数、最新分钟和 `<missing>` operator 行数；前端展示分钟汇总来源和缺操作员异常；文档补充第一批定时 SQL 任务、本地消费方式和源主题 `operator_id` 索引类型风险。
- 改动文件：
  - `.env.example`
  - `README.md`
  - `docs/ai-worklog.md`
  - `docs/boundary.md`
  - `docs/overview-design.md`
  - `docs/runtime-plan.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `src/boss_analysis/api/query_service.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `src/boss_analysis/consumer/cls_search.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/domain/metrics.py`
  - `src/boss_analysis/domain/summary.py`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `frontend/src/types.ts`
  - `tests/test_dev_data.py`
  - `tests/test_query_service.py`
  - `tests/test_summary_reader.py`
- 验证结果：
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-test-pycache python3 -m unittest discover -s tests` 通过，79 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-compile-pycache python3 -m compileall src` 通过。
  - `frontend/` 下 `npm run build` 通过。
  - 使用临时 `CLS_SUMMARY_TOPIC_ID=f509f01d-4097-4cd9-ac3b-f7781a4c73e2` 只读验证真实汇总主题：读到 21 条 summary，metric 包含 `boss_minute_chat` 和 `boss_minute_operator_funnel`，可识别操作员 `zhouxinyu`；其中 14 条仍为 `<missing>` operator，符合源主题 `operator_id` 索引类型待修复的现状。
- 风险/阻塞：本次未修改真实 CLS 资源；当前运行中的旧 dev server 如需展示 summary，需要用新代码重启，并设置 `CLS_SUMMARY_TOPIC_ID`。已写入 `boss_summary_minute_prod` 的 `<missing>` 历史汇总不会自动修复，需要修正源主题 `boss.operator_id` 索引类型后等待新结果或补跑任务。
- 中断续写入口：下一步修正 CLS 源主题 `boss` 的 `operator_id` 索引为 text，确认新分钟汇总不再 missing；然后可把 summary reader 接入持久化缓存或继续配置岗位/数据质量类定时 SQL。

### 任务：为 CLS 分钟汇总主题创建索引

- 时间：2026-05-18 11:59
- 执行者：AI
- 状态：已完成
- 目标：按用户要求，在腾讯云 CLS 上为日志主题 `boss_summary_minute_prod` 创建/更新索引配置，便于定时 SQL 结果检索和后续 API 查询。
- 当前理解：本次只操作 `boss_summary_minute_prod` 这个目标日志主题的索引配置，不创建定时 SQL 任务，不创建或删除日志主题，不修改原始 `boss` 主题。索引开启后会产生索引流量和索引存储费用，且索引规则只对新写入日志生效。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不打印或保存腾讯云密钥
  - 不创建/删除 CLS 主题或定时 SQL 任务
  - 不重建历史索引
- 验证计划：用腾讯云 CLS API 查找主题 TopicId；读取现有索引；调用 CreateIndex 或 ModifyIndex；再次 DescribeIndex 验证索引状态和关键字段。
- 下一步：创建定时 SQL 任务后，等待新汇总日志写入，再用检索分析验证字段查询和 SQL 分析。

#### 阶段记录：通过控制台开启索引

- 时间：2026-05-18 12:08
- 状态：已完成
- 已完成：按用户要求改用浏览器控制台操作；进入 `boss_summary_minute_prod` 主题详情页的“索引配置”，确认 TopicId 为 `f509f01d-4097-4cd9-ac3b-f7781a4c73e2`，索引原先为关闭；使用控制台推荐配置开启索引并提交成功。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：控制台显示“操作成功”；索引状态已开启；全文索引已开启；键值索引已开启；键值索引自动配置为“是”；最近修改时间显示 `2026-05-18 12:08:41`，页面提示索引生效一般有 60 秒延迟。
- 风险/阻塞：索引配置变更只对后续写入的新数据生效；本次未点击“重建索引”，不会回补历史数据索引。开启索引会产生索引流量和索引存储费用。
- 中断续写入口：下一步可在 `boss_summary_minute_prod` 上创建第一批定时 SQL 任务，写入新日志后通过“检索分析”验证字段和 SQL。

### 任务：调整分钟级聚合到 CLS 平台侧

- 时间：2026-05-18 11:18
- 执行者：AI
- 状态：已完成
- 目标：根据用户要求，将分钟级日志聚合定位到 CLS 定时 SQL/指标主题侧实现，本地分析系统避免承担完整分钟级聚合数仓职责。
- 当前理解：分钟级聚合需要接近原始日志源和长期查询窗口，适合由 CLS 定时 SQL 以 1 分钟调度或 1 分钟时间窗口产出汇总日志主题/指标主题；本地系统主要读取 CLS 聚合结果、做权限过滤、展示和少量探索性补充。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/overview-design.md`
  - `docs/runtime-plan.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `docs/modules/05-operations-security.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不创建、删除或修改真实 CLS 资源
  - 不在本地实现新的分钟级聚合 worker
  - 不写具体生产 SQL 和表结构
- 验证计划：查阅腾讯云 CLS 官方文档确认定时 SQL 分钟级能力；更新设计文档后检查关键术语和边界；文档变更不运行代码测试。
- 下一步：进入具体实现前，先设计 CLS 分钟汇总任务清单、目标主题命名、字段口径、同步策略和失败补偿。

#### 阶段记录：完成分钟级聚合边界调整

- 时间：2026-05-18 11:20
- 状态：已完成
- 已完成：查阅腾讯云 CLS 官方文档，确认定时 SQL 支持分钟级调度和分钟级时间窗口，且官方把“日志预聚合为分钟级指标数据”列为推荐场景；已更新 overview、运行方案、聚合/API 模块和运维模块，把生产分钟级聚合的主实现调整为 CLS 定时 SQL，analysis-system 只读取/同步汇总结果、做权限过滤、缓存、二次 rollup 和探索性补充。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/overview-design.md`
  - `docs/runtime-plan.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `docs/modules/05-operations-security.md`
- 验证结果：
  - 已检查文档中 `分钟级`、`定时 SQL`、`summary-reader`、`summary-sync-worker`、`aggregate-worker` 等关键表述，确认不再把本地系统描述为生产分钟级聚合主链路。
  - 文档变更未运行代码测试。
- 风险/阻塞：尚未创建真实 CLS 定时 SQL 任务；后续操作真实云资源前，需要明确源 topic、目标 topic/指标主题、SQL、调度周期、时间窗口、CAM 权限、费用和回滚方案。
- 中断续写入口：下一步从 `docs/modules/04-aggregation-query-api.md` 的推荐分钟汇总粒度开始，拆出第一批 CLS SQL 任务清单。

### 任务：按“xxx的微信号:”标记修正微信成功口径

- 时间：2026-05-17 23:41
- 执行者：AI
- 状态：已完成
- 目标：用户明确聊天记录中出现“xxx的微信号:”标记就是交换成功；按该标记重新分析和修正投影口径。
- 当前理解：之前的微信关键词口径过泛；新的成功口径应收紧为聊天快照文本中出现 `...的微信号:` / `...的微信号：` 或 `微信号:` / `微信号：`。本轮继续不输出姓名、微信号、聊天正文。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/workers/fact_projector.py`
  - `tests/test_fact_projector.py`
  - `tests/test_query_service.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不输出或保存微信号、手机号、聊天正文
  - 不把 `report_required` 混入微信成功数
- 验证计划：用 CLS 脱敏统计确认标记数量；更新投影正则和测试；重启后端并验证 API 微信数。
- 下一步：后续可把 `candidate_chat.report_required` 单独做成“待补采聊天/待报告聊天”指标，不混入微信成功。

#### 阶段记录：续写接手

- 时间：2026-05-17 23:45
- 状态：实现中
- 已完成：接手当前“微信号标记”口径修正任务；已确认工作日志存在任务开始记录，后端当前仍有旧进程运行，代码中已出现按 `微信号:` / `微信号：` 标记识别的投影逻辑和相关测试。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：尚未重新验证运行中 API；下一步重启后端并检查 `operator/zhouxinyu` 的微信成功数。
- 风险/阻塞：不能输出聊天正文、姓名或微信号；真实 CLS 查询和端口监听需要继续沿用本地配置。
- 中断续写入口：从重启后端 `boss_analysis.dev_server` 并验证 dashboard/operator API 继续。

#### 阶段记录：完成微信号标记口径验证

- 时间：2026-05-17 23:52
- 状态：已完成
- 已完成：已按用户确认的 `xxx的微信号:` / `xxx的微信号：` 标记作为微信交换成功口径；重新启动真实数据后端并从 CLS 脱敏统计当前 1440 分钟窗口。严格标记口径下，全量为 5 条事件、全局 3 个候选人；其中 `zhouxinyu` 为 3 条事件、2 个候选人，缺 operator 的历史日志为 2 条事件、1 个候选人。`candidate_chat.report_required` 当前为 162 条事件、98 个候选人，但按日志规范仍视作待补采/待报告聊天，不计入微信成功。
- 改动文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/facts.py`
  - `src/boss_analysis/workers/fact_projector.py`
  - `tests/test_fact_projector.py`
  - `tests/test_query_service.py`
- 验证结果：
  - 已重启后端：`python3 -m boss_analysis.dev_server --host 127.0.0.1 --port 8765 --data-source real --require-real-data --refresh-seconds 10`，PID 33939。
  - `curl -L http://127.0.0.1:5173/api/operator/zhouxinyu` 返回 `wechat_captured=3`。
  - `curl -L http://127.0.0.1:5173/api/dashboard` 返回 `source.kind=cls_search`、`record_count=1793`；当前 `active_count=0` 是最近活跃窗口内没有新事件，不是数据源断开。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-test-pycache python3 -m unittest discover -s tests` 通过，72 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-compile-pycache python3 -m compileall src` 通过。
  - `frontend/` 下 `npm run build` 通过；子项目根目录没有 `package.json`，根目录 `npm run build` 不适用。
- 风险/阻塞：当前前端展示的是微信成功事件数，不是候选人去重数；如果要展示“交换成功候选人数”，需要新增聚合字段。缺 operator 的 2 条历史日志暂不归属到 `zhouxinyu`。
- 中断续写入口：前端刷新 `http://127.0.0.1:5173/`，进入 `zhouxinyu` 单人页可见微信成功数为 3；后续可新增去重候选人口径和 `report_required` 独立指标。

### 任务：排查真实日志微信交换数量为 0

- 时间：2026-05-17 23:23
- 执行者：AI
- 状态：已完成
- 目标：用户反馈微信交换肯定不为 0，直接分析 CLS 原始日志，确认交换成功相关日志数量和当前投影缺口。
- 当前理解：当前 API `operator/zhouxinyu` 返回 `wechat_captured=0`，但这只代表已投影的 `candidate_chat.wechat_captured` 事件数量；真实日志中可能使用 `candidate_chat.report_required`、聊天快照消息内容、或其他字段表达“交换微信/需报告”，需要从 raw payload 统计，不打印敏感联系方式。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - 视结果可能修改 `src/boss_analysis/workers/fact_projector.py`
  - 视结果可能修改测试和前端展示
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不输出微信号、手机号、聊天正文或完整 payload
  - 不把敏感正文落入文档
- 验证计划：读取 CLS 原始日志，统计微信相关事件类型、payload/chat 字段形态、包含联系方式/微信关键词的快照数量和去重候选人/会话数量；补充安全的投影口径后运行测试。
- 下一步：决定是否把 `candidate_chat.report_required` 作为单独“待补采/未上报聊天”指标展示，而不是混入微信成功数。

#### 阶段记录：完成微信交换日志分析和保守投影修复

- 时间：2026-05-17 23:40
- 状态：已完成
- 已完成：脱敏分析 CLS 日志，确认当前没有显式 `candidate_chat.wechat_captured` 事件；默认 `*` 查询原先只取 1000 条，已补 SearchLog 分页读取，当前 1440 分钟窗口读取 1774 条；聊天快照中微信关键词共 8 条、5 个候选人，其中 `zhouxinyu` 为 4 条、2 个候选人；带“已交换/换微信/交换微信”等成功语义共 5 条、2 个候选人，其中 `zhouxinyu` 为 3 条、1 个候选人；`candidate_chat.report_required` 共 130 条、102 个候选人，其中 `zhouxinyu` 为 70 条、65 个候选人，但按日志规范它是待补采/未上报聊天，不等同微信交换成功。
- 改动文件：
  - `.env.example`
  - `.env.local`（被 git ignore，本地配置）
  - `src/boss_analysis/consumer/cls_search.py`
  - `src/boss_analysis/domain/facts.py`
  - `src/boss_analysis/workers/fact_projector.py`
  - `tests/test_cls_search.py`
  - `tests/test_fact_projector.py`
  - `tests/test_query_service.py`
  - `docs/ai-worklog.md`
- 验证结果：
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-test-pycache python3 -m unittest discover -s tests` 通过，71 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-compile-pycache python3 -m compileall src` 通过。
  - `npm run build` 通过。
  - 已重启后端，`curl -L http://127.0.0.1:5173/api/operator/zhouxinyu` 返回 `wechat_captured=4`。
- 风险/阻塞：当前 API 的 `wechat_captured=4` 是保守口径：只统计 `zhouxinyu` 且聊天快照中出现微信线索的事件数；缺 operator 的旧日志中还有 4 条微信线索。若业务确认 `report_required` 对应交换成功，需要新增独立指标或重新定义微信成功口径。
- 中断续写入口：前端刷新 `http://127.0.0.1:5173/` 可见 `zhouxinyu` 微信数为 4；继续可把 `report_required` 做成“待补采聊天/疑似交换待确认”指标。

### 任务：排查 CLS 有实时数据但大盘不显示活跃

- 时间：2026-05-17 23:14
- 执行者：AI
- 状态：已完成
- 目标：定位腾讯云 CLS 后台已有实时数据，但分析系统大盘 `active_count` 为 0 的原因。
- 当前理解：分析系统已成功从 CLS SearchLog 读取 1000 条真实日志，`source.kind=cls_search`；问题不在连接，而可能在 SearchLog 快照加载一次不刷新、事件类型/字段映射不匹配、`occurred_at` 与当前活跃窗口不匹配，或真实日志结构与 normalizer 预期不同。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - 视排查结果可能修改 `src/boss_analysis/consumer/cls_search.py`
  - 视排查结果可能修改投影/查询/测试
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不输出密钥、完整 payload、聊天正文或联系方式
  - 不创建、删除或修改腾讯云资源
- 验证计划：直接读取 CLS 摘要，统计事件类型、日志时间、`occurred_at` 时间、operator 字段和 raw 内容形态；必要时重启后端验证前端 API。
- 下一步：补充更多真实事件类型投影，例如 `candidate_chat.report_required`、页面会话和筛选事件。

#### 阶段记录：定位并修复实时活跃不显示

- 时间：2026-05-17 23:21
- 状态：已完成
- 已完成：读取 CLS 最新摘要，确认最新事件时间为 `2026-05-17T23:17:39+08:00`，operator 为 `zhouxinyu`，真实日志字段完整；定位大盘不显示的原因是 dev server 启动时只拉一次 CLS，且活跃口径只看已投影事实，未纳入 raw events 中的实时事件。已修改查询服务让大盘活跃基于 raw events 兜底，已修改 dev server 对真实数据源按刷新间隔重新加载。
- 改动文件：
  - `src/boss_analysis/api/query_service.py`
  - `src/boss_analysis/dev_server.py`
  - `tests/test_query_service.py`
  - `tests/test_dev_server.py`
  - `docs/ai-worklog.md`
- 验证结果：
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-test-pycache python3 -m unittest discover -s tests` 通过，67 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-compile-pycache python3 -m compileall src` 通过。
  - `npm run build` 通过。
  - 已重启后端：`python3 -m boss_analysis.dev_server --host 127.0.0.1 --port 8765 --data-source real --require-real-data --refresh-seconds 10`，PID 17946。
  - `curl -L http://127.0.0.1:5173/api/dashboard` 返回 `active_count=1`、操作员 `zhouxinyu`、上次活跃约 1 分钟前、`source.kind=cls_search`。
- 风险/阻塞：`unknown_event_type_count=130`，说明仍有真实事件类型未做事实投影；当前活跃大盘已用 raw events 兜底，但后续单人深挖需要继续补事件类型映射。
- 中断续写入口：前端刷新 `http://127.0.0.1:5173/`；后端每 10 秒刷新一次 CLS。下一步从 `candidate_chat.report_required`、`page_session.*`、`candidate_filter.*`、`job_context.changed` 做投影和前端展示。

### 任务：验证用户填写的真实 CLS 配置

- 时间：2026-05-17 23:00
- 执行者：AI
- 状态：已完成
- 目标：使用用户已填写的 `.env.local` 配置启动真实 CLS 数据源，确认前端是否不再显示演示数据。
- 当前理解：`.env.local` 中 `TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`、`CLS_SEARCH_REGION`、`CLS_SEARCH_TOPIC_ID` 等关键项已填写，`TENCENTCLOUD_TOKEN` 留空符合长期密钥用法；本轮只验证连接和 API source，不打印密钥内容。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不输出 SecretId、SecretKey 或完整请求签名
  - 不创建、删除或修改腾讯云资源
- 验证计划：启动 `python3 -m boss_analysis.dev_server --host 127.0.0.1 --port 8765 --data-source real --require-real-data`；检查 `http://127.0.0.1:5173/api/dashboard` 的 `source.kind` 是否为 `cls_search`。
- 下一步：继续处理真实数据口径，重点是未知事件类型和活跃窗口展示。

#### 阶段记录：真实 CLS 数据接入验证通过

- 时间：2026-05-17 23:10
- 状态：已完成
- 已完成：确认 `.env.local` 中关键配置已填写；首次 SearchLog 返回 `ResourceNotFound.TopicNotExist`，随后通过 `DescribeTopics` 在 `ap-shanghai` 下找到可见日志主题 `boss`，使用 TopicId `5407c0a7-3e37-4c45-a204-bf5d40f157a1` 临时覆盖并成功启动真实数据后端；已将 `.env.local` 的 `CLS_SEARCH_TOPIC_ID` 更新为该 TopicId。
- 改动文件：
  - `docs/ai-worklog.md`
  - `.env.local`（被 git ignore，本地配置）
- 验证结果：
  - `python3 -m boss_analysis.dev_server --host 127.0.0.1 --port 8765 --data-source real --require-real-data` 已启动，PID 16236。
  - `curl -L http://127.0.0.1:5173/api/dashboard` 返回 `source.kind = cls_search`、`record_count = 1000`、`raw_event_count = 1000`。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-test-pycache python3 -m unittest discover -s tests` 通过，65 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-compile-pycache python3 -m compileall src` 通过。
  - `npm run build` 通过。
- 风险/阻塞：真实日志已接入，但当前 1440 分钟窗口内 `active_count = 0`，`unknown_event_type_count = 119`；下一步需要根据真实日志事件类型补充投影支持或调整展示窗口/口径。
- 中断续写入口：打开 `http://127.0.0.1:5173/` 查看真实数据源；后端当前运行在 `http://127.0.0.1:8765/`。

### 任务：强制接入真实数据并去除静默演示回退

- 时间：2026-05-17 22:41
- 执行者：AI
- 状态：已完成
- 目标：响应用户指出前端仍显示假数据的问题，确认本机真实数据配置状态，并让真实数据模式不再静默回退到 demo。
- 当前理解：当前运行环境没有 `.env/.env.local`，也没有 `TENCENTCLOUD_*`、`CLS_SEARCH_*`、`BOSS_ANALYSIS_DEV_DATA_FILE` 环境变量；因此页面显示 demo 是因为后端未获得真实数据源配置。本轮要让 dev server 自动读取本地 `.env`，并提供 `--require-real-data`/真实模式缺配置失败，避免用户误以为已接入真实数据。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/dev_server.py`
  - `src/boss_analysis/dev_data.py`
  - `tests/test_dev_server.py`
  - `tests/test_dev_data.py`
  - 必要时 `README.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不读取或打印真实密钥内容
  - 不绕过日志契约读取插件运行时或 Chrome storage
- 验证计划：运行 Python 测试、compileall；用真实数据强制模式启动，确认缺配置时明确失败；如配置存在则重启后端并验证 `/api/dashboard.source` 不再是 demo。
- 下一步：用户在 `.env.local` 填入 CLS 真实配置后，重启后端并验证 `/api/dashboard.source.kind` 为 `cls_search`。

#### 阶段记录：完成本地真实数据配置文件

- 时间：2026-05-17 22:49
- 状态：已完成
- 已完成：创建被 git ignore 的 `.env.local`，默认 `BOSS_ANALYSIS_DATA_SOURCE=cls-search`，预留 `TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`、`CLS_SEARCH_REGION`、`CLS_SEARCH_TOPIC_ID` 等配置位；更新 `.gitignore` 忽略 `.env.*` 并保留 `.env.example`。
- 改动文件：
  - `.gitignore`
  - `.env.local`（被 git ignore，本地配置文件）
  - `docs/ai-worklog.md`
- 验证结果：
  - `git check-ignore -v .env.local` 确认 `.env.local` 会被忽略。
  - `python3 -m boss_analysis.dev_server --host 127.0.0.1 --port 8766 --data-source real --require-real-data` 在空配置下明确报错 `Missing required environment variable: CLS_SEARCH_TOPIC_ID`，没有回退 demo。
- 风险/阻塞：`.env.local` 当前仍是空值占位；需要用户填入真实 CLS TopicId、地域和腾讯云密钥后才能实际读取真实数据。
- 中断续写入口：填完 `.env.local` 后，从 `analysis-system/src` 运行 `python3 -m boss_analysis.dev_server --host 127.0.0.1 --port 8765 --data-source real --require-real-data`，再检查 `http://127.0.0.1:5173/api/dashboard` 的 `source.kind`。

### 任务：接入真实 CLS 数据源

- 时间：2026-05-17 22:32
- 执行者：AI
- 状态：已完成
- 目标：让本地分析系统可以配置真实数据源，优先支持从腾讯云 CLS SearchLog 读取真实日志，并让前端看到当前数据源状态。
- 当前理解：仓库内没有真实导出文件或云凭据；本轮不直接操作真实云资源、不写入密钥，先实现可配置的 CLS SearchLog 读取器、dev server 数据源选择和前端数据源提示。真实运行时由用户通过环境变量注入 SecretId/SecretKey、TopicId、地域和查询窗口。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `.env.example`
  - `src/boss_analysis/consumer/cls_search.py`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `tests/test_cls_search.py`
  - `tests/test_dev_data.py`
  - `tests/test_dev_server.py`
  - `frontend/src/types.ts`
  - `frontend/src/App.tsx`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不实际请求腾讯云 CLS 或创建/修改云资源
  - 不提交任何 SecretId、SecretKey、Token 或完整连接串
  - 不引入新依赖
- 验证计划：用 mock HTTP 客户端测试 TC3 签名/请求结构和 CLS 响应解析；运行 Python 全量测试、compileall 和前端 build。
- 下一步：拿到真实 CLS TopicId、地域和凭据后，用 `--data-source cls-search` 启动后端验证真实日志读取。

#### 阶段记录：完成真实数据源接入代码

- 时间：2026-05-17 22:39
- 状态：已完成
- 已完成：新增腾讯云 CLS SearchLog 读取器，使用 TC3-HMAC-SHA256 签名；dev server 支持 `--data-source file|cls-search|demo|empty|auto`；dashboard API 返回 `source` 元数据；前端顶部显示当前数据源和读取条数；README 和 `.env.example` 写入真实数据启动方式。
- 改动文件：
  - `.env.example`
  - `README.md`
  - `src/boss_analysis/consumer/__init__.py`
  - `src/boss_analysis/consumer/cls_search.py`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `tests/test_cls_search.py`
  - `tests/test_dev_data.py`
  - `tests/test_dev_server.py`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `frontend/src/types.ts`
  - `docs/ai-worklog.md`
- 验证结果：
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-test-pycache python3 -m unittest discover -s tests` 通过，62 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-compile-pycache python3 -m compileall src` 通过。
  - `npm run build` 通过。
  - 已重启本地后端 dev server，`curl -L http://127.0.0.1:5173/api/dashboard` 返回 `source` 字段；当前因未配置真实凭据/数据文件，运行中数据源仍为 `demo`。
- 风险/阻塞：本轮没有真实 SecretId/SecretKey、CLS TopicId 和地域，未实际请求腾讯云；真实云端验证前需要用户确认权限范围和凭据注入方式。
- 中断续写入口：在环境变量中配置 `TENCENTCLOUD_SECRET_ID`、`TENCENTCLOUD_SECRET_KEY`、`CLS_SEARCH_TOPIC_ID`、`CLS_SEARCH_REGION` 后，从 `analysis-system/src` 运行 `python3 -m boss_analysis.dev_server --host 127.0.0.1 --port 8765 --data-source cls-search`。

### 任务：前端界面中文化

- 时间：2026-05-17 22:25
- 执行者：AI
- 状态：已完成
- 目标：把当前 Vite React 大盘页面面向用户可见的文案改为中文界面。
- 当前理解：本轮只改前端展示文案和必要的展示映射，不改后端 API、数据模型、真实数据导入逻辑或分析口径。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `frontend/index.html`
  - `frontend/src/App.tsx`
  - `frontend/src/api.ts`
  - `frontend/src/main.tsx`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改后端接口、测试样本或指标计算逻辑
  - 不新增依赖
- 验证计划：运行 `npm run build`；确认本地前端页面仍可访问。
- 下一步：继续扩展真实数据接入或拆分前端模块。

#### 阶段记录：完成中文界面切换

- 时间：2026-05-17 22:25
- 状态：已完成
- 已完成：将页面标题、导航、顶部状态、指标卡、活跃操作员列表、单人明细漏斗和错误提示等用户可见文案改为中文；为当前已知事件类型增加中文展示映射。
- 改动文件：
  - `frontend/index.html`
  - `frontend/src/App.tsx`
  - `frontend/src/api.ts`
  - `frontend/src/main.tsx`
  - `docs/ai-worklog.md`
- 验证结果：
  - `npm run build` 通过。
  - `rg -n "BOSS Analysis|Dashboard|Operators|Health|Local dev|Realtime|Active now|Observed|Raw events|Pipeline|Active operators|Operator detail|Generated|Loading|Unknown error|no job|ago|Card exposure|Detail opens|Greeting|Wechat captured|Cards|Details|Chats|Request failed|Root element" frontend/src frontend/index.html` 未发现剩余用户界面英文文案，仅命中类型和函数名。
  - `curl -L http://127.0.0.1:5173/` 返回中文页面标题。
  - `curl -L http://127.0.0.1:5173/api/dashboard` 仍能通过前端代理读取后端 dashboard JSON。
- 风险/阻塞：内部数据字段和 TypeScript 类型名仍保持英文；后续新增事件类型需要继续补中文展示映射。
- 中断续写入口：从 `frontend/src/App.tsx` 的 `ACTION_LABELS` 和当前组件结构继续拆分国际化或模块化。

### 任务：接入前端框架并支持本地真实数据源

- 时间：2026-05-17 22:09
- 执行者：AI
- 状态：已完成
- 目标：接入一个便于后续开发的前端框架，并让本地 dev 后端可以从真实 CLS/插件导出数据文件读取数据，而不是只能使用内置 demo。
- 当前理解：用户希望继续推进到可开发的前端和真实数据入口；本轮先采用 Vite + React + TypeScript 做前端工程，后端保持当前标准库 dev API；真实云 CLS 直连需要凭据、主题、权限和费用确认，因此本轮先支持本地真实数据文件导入，兼容 CLS 扁平日志、CLS `contents` 包装、插件批次 `events` 和插件单条事件结构。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `tests/test_dev_data.py`
  - `tests/test_dev_server.py`
  - `frontend/*`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不连接真实腾讯云资源
  - 不写入或提交任何密钥
  - 不实现生产认证/部署
- 验证计划：运行 Python 全量测试和 compileall；安装前端依赖后运行前端构建；启动后端 API 和 Vite dev server，用 HTTP 请求验证页面/API。
- 下一步：可用 `http://127.0.0.1:5173/` 查看 React/Vite 前端；如要接真实 CLS 云端，需要确认 CLS topic、地域、读取方式、CAM 权限和密钥注入方式。

#### 阶段记录：完成真实数据文件入口

- 时间：2026-05-17 22:14
- 状态：已完成
- 已完成：`dev_data.py` 支持从 `--data-file` 或 `BOSS_ANALYSIS_DEV_DATA_FILE` 指向的 JSON/JSONL 读取真实数据；兼容 CLS 扁平日志、CLS `contents` 包装、插件批次 `events` 和插件单条事件结构，并统一转入现有 ingestion pipeline。
- 改动文件：
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `tests/test_dev_data.py`
  - `tests/test_dev_server.py`
- 验证结果：`PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m unittest discover -s tests` 通过，53 个测试。
- 风险/阻塞：当前是本地文件真实数据入口，不是直接云端 CLS 拉取；直接连云需要额外凭据和资源确认。
- 中断续写入口：使用 `python3 -m boss_analysis.dev_server --data-file /path/to/export.jsonl` 启动后端。

#### 阶段记录：完成 Vite React 前端接入

- 时间：2026-05-17 22:21
- 状态：已完成
- 已完成：新增 `frontend/` Vite + React + TypeScript 工程，迁移大盘页面到 React 组件，配置 `/api` 代理到 `127.0.0.1:8765`；已安装前端依赖并生成 `package-lock.json`；启动后端 dev API 和 Vite 前端 dev server。
- 改动文件：
  - `.gitignore`
  - `frontend/package.json`
  - `frontend/package-lock.json`
  - `frontend/index.html`
  - `frontend/tsconfig.json`
  - `frontend/tsconfig.node.json`
  - `frontend/vite.config.ts`
  - `frontend/src/App.tsx`
  - `frontend/src/api.ts`
  - `frontend/src/main.tsx`
  - `frontend/src/styles.css`
  - `frontend/src/types.ts`
- 验证结果：
  - `npm run build` 通过。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m unittest discover -s tests` 通过，53 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m compileall src` 通过。
  - `curl -L http://127.0.0.1:5173/` 返回 Vite React 页面。
  - `curl -L http://127.0.0.1:5173/api/dashboard` 通过 Vite proxy 返回后端 dashboard JSON。
- 风险/阻塞：npm 用户级 cache 权限异常，已改用项目内 `.npm-cache/` 并加入 `.gitignore`；启动本地端口需要授权。当前真实数据来自本地导出文件，尚未直接读取腾讯云 CLS。
- 中断续写入口：前端 dev server 在 `http://127.0.0.1:5173/`，后端 API 在 `http://127.0.0.1:8765/`。

#### 阶段记录：完成收口复核

- 时间：2026-05-17 22:24
- 状态：已完成
- 已完成：复核前端构建、后端测试、编译检查和本地 dev 访问；确认 Vite proxy 可读取后端 dashboard API，当前页面可在本机打开。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：
  - `npm run build` 通过。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-test-pycache python3 -m unittest discover -s tests` 通过，53 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-compile-pycache python3 -m compileall src` 通过。
  - `curl -L http://127.0.0.1:5173/` 返回 Vite React 页面。
  - `curl -L http://127.0.0.1:5173/api/dashboard` 返回后端 dashboard JSON。
  - `curl -L http://127.0.0.1:8765/api/dashboard` 返回后端 dashboard JSON。
- 风险/阻塞：尚未直接连接腾讯云 CLS；要做云端直连前，需要确认地域、topic、读取窗口、CAM 权限、密钥注入方式和费用风险。
- 中断续写入口：继续从前端模块拆分、正式 API 服务框架或云端 CLS reader 设计进入；当前可先用 `python3 -m boss_analysis.dev_server --data-file /path/to/export.jsonl` 读取本地真实导出数据。

### 任务：实现本地 dev 大盘页面

- 时间：2026-05-17 21:58
- 执行者：AI
- 状态：已完成
- 目标：实现一个可本地启动并在浏览器查看的第一版大盘页面，复用现有 ingestion pipeline、fact projector 和 query service。
- 当前理解：用户希望能在本地 dev 看到第一个页面；当前不引入 FastAPI/React/Vite 等依赖，先用标准库 HTTP server 提供静态页面和 JSON API，示例数据通过 pipeline 生成，后续再替换为正式前后端栈。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `tests/test_dev_server.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不新增依赖
  - 不连接真实 CLS、数据库或云资源
  - 不实现认证、生产部署或真实前端构建链
- 验证计划：运行全部单元测试；运行 `python3 -m compileall src`；启动本地 dev server 并用 HTTP 请求验证首页和 API。
- 下一步：用户可打开 `http://127.0.0.1:8765/` 查看本地 dev 大盘；后续可继续实现正式 FastAPI/前端工程化或接真实数据源。

#### 阶段记录：完成本地页面和 dev server

- 时间：2026-05-17 22:02
- 状态：已完成
- 已完成：新增 `dev_data.py` 用 pipeline 生成本地示例事实；新增 `dev_server.py`，使用标准库 HTTP server 提供 `/`、`/assets/app.css`、`/assets/app.js`、`/api/dashboard`、`/api/operator/{operator_id}`；页面展示活跃人数、活跃操作员、raw event 数、问题数、单人漏斗和柱状指标。已启动本地 dev server。
- 改动文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `tests/test_dev_server.py`
- 验证结果：
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m unittest discover -s tests` 通过，49 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m compileall src` 通过。
  - `curl -L http://127.0.0.1:8765/` 返回首页 HTML。
  - `curl -L http://127.0.0.1:8765/api/dashboard` 返回 `active_count: 2`、`raw_event_count: 9`。
  - `curl -L http://127.0.0.1:8765/api/operator/op_001` 返回单人漏斗和聊天指标。
- 风险/阻塞：当前是本地 dev server 和示例数据，不是生产 HTTP 服务；端口绑定需要在本机权限外运行，已通过授权启动。尚未接真实 CLS/TencentDB。
- 中断续写入口：继续做正式 API/server 工程化，或把 dev 页面改为读取 SQLite 中的真实本地样本。

### 任务：实现 ingestion pipeline

- 时间：2026-05-17 21:53
- 执行者：AI
- 状态：已完成
- 目标：把 normalizer、raw event repository 和 fact projector 串成可复用的输入处理管线，为后续 CLS Kafka consumer 提供核心调用层。
- 当前理解：pipeline 接收一条 CLS 扁平日志，完成标准化、raw 保存和事实投影；重复事件应幂等成功但不重复投影；缺失 `event_id` 只记录解析错误；未知事件类型保存 raw 后投影层跳过。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/ingestion.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/consumer/pipeline.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `tests/test_ingestion_pipeline.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不实现 Kafka client、offset 提交、网络连接或真实云资源
  - 不新增依赖
- 验证计划：运行全部单元测试；运行 `python3 -m compileall src`。
- 下一步：后续可实现 CLS Kafka consumer shell 或 HTTP read-only API shell，二者都可复用本 pipeline。

#### 阶段记录：完成 pipeline 实现与测试

- 时间：2026-05-17 21:55
- 状态：已完成
- 已完成：新增 `IngestionResult` 和 `IngestionPipeline`，将一条 CLS 扁平日志串联为 normalize -> raw repository save -> fact projection；重复事件不重复投影；未知事件保存 raw 后跳过投影；缺失 `event_id` 只记录解析错误；坏 payload 保存 raw 并记录投影错误；内存和 SQLite repository 都可复用。
- 改动文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/ingestion.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/consumer/pipeline.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `tests/test_ingestion_pipeline.py`
- 验证结果：
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m unittest discover -s tests` 通过，45 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m compileall src` 通过。
- 风险/阻塞：尚未实现真实 Kafka client 和 offset 提交；pipeline 只表达单条消息的本地处理结果。
- 中断续写入口：可继续实现 `cls-consumer` 进程外壳，或先实现 HTTP read-only API 外壳。

### 任务：实现落盘版 raw event repository

- 时间：2026-05-17 21:50
- 执行者：AI
- 状态：已完成
- 目标：在不新增依赖、不连接真实云数据库的前提下，实现可落盘的 raw event repository，验证表结构、幂等写入、错误记录和重放筛选行为。
- 当前理解：本机没有 SQLAlchemy；本阶段先使用标准库 `sqlite3` 实现与 `RawEventRepository` 一致的行为，作为真实 PostgreSQL 实现前的可测试持久化版本。后续替换为 PostgreSQL/SQLAlchemy 时应保持同样协议和测试语义。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/storage/sqlite_raw_events.py`
  - `src/boss_analysis/storage/__init__.py`
  - `tests/test_sqlite_raw_events.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不新增依赖
  - 不连接真实 PostgreSQL、CLS 或任何云资源
  - 不修改日志契约和模块设计文档
- 验证计划：运行全部单元测试；运行 `python3 -m compileall src`。
- 下一步：实现 ingestion pipeline，把 normalizer、raw repository 和 fact projector 串起来，作为后续 Kafka consumer 的核心调用层。

#### 阶段记录：完成 SQLite raw event repository

- 时间：2026-05-17 21:52
- 状态：已完成
- 已完成：新增 `SQLiteRawEventRepository`，使用标准库 `sqlite3` 初始化 `raw_events` 和 `event_parse_errors` 表；实现 normalized event 落盘、重复 `event_id` 幂等、解析错误保存、错误 preview 脱敏、按条件重放、跨实例重新打开数据库读取。
- 改动文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/storage/sqlite_raw_events.py`
  - `src/boss_analysis/storage/__init__.py`
  - `tests/test_sqlite_raw_events.py`
- 验证结果：
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m unittest discover -s tests` 通过，39 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m compileall src` 通过。
- 风险/阻塞：SQLite 实现用于本地和行为验证，不是最终 PostgreSQL/TencentDB 实现；SQLAlchemy 当前不在本机环境中，后续引入依赖后应保持 repository 协议和测试语义一致。
- 中断续写入口：继续实现 ingestion pipeline 或开始 PostgreSQL/SQLAlchemy repository。

### 任务：实现运行安全基础模块

- 时间：2026-05-17 21:36
- 执行者：AI
- 状态：已完成
- 目标：实现第五模块 `05-operations-security` 的配置读取、敏感值脱敏和错误 preview 安全处理，并补充测试。
- 当前理解：当前不操作真实云资源；先提供环境变量配置模型、进程角色校验、公开配置脱敏和错误预览截断/联系方式脱敏能力，为后续 API、consumer 和 worker 复用。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `.env.example`
  - `src/boss_analysis/domain/operations.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/config.py`
  - `src/boss_analysis/security.py`
  - `tests/test_operations_security.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不连接真实 CLS、数据库、COS、KMS 或 CAM
  - 不新增依赖
  - 不提交或生成真实密钥
- 验证计划：运行全部单元测试；运行 `python3 -m compileall src`。
- 下一步：后续可进入真实 PostgreSQL/SQLAlchemy 持久化、FastAPI HTTP 层或 CLS Kafka consumer 接入。

#### 阶段记录：完成配置与安全工具实现

- 时间：2026-05-17 21:38
- 状态：已完成
- 已完成：新增 `AppSettings`、`RuntimeHealth`、`ProcessRole`；新增 `load_settings` / `public_settings` 环境配置读取和公开配置脱敏；新增 `redact_mapping`、`safe_preview`，对 secret/password/token/key/database_url/authorization 等敏感键脱敏，对手机号和邮箱做 preview 级遮盖；更新 `.env.example` 增加 `PROCESS_ROLE`、`LOG_LEVEL`、`SENSITIVE_DATA_ACCESS_ENABLED`。
- 改动文件：
  - `docs/ai-worklog.md`
  - `.env.example`
  - `src/boss_analysis/domain/operations.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/config.py`
  - `src/boss_analysis/security.py`
  - `tests/test_operations_security.py`
- 验证结果：
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m unittest discover -s tests` 通过，33 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m compileall src` 通过。
- 风险/阻塞：当前只是本地配置和安全工具，没有接 KMS/CAM/真实云资源；`safe_preview` 只做明显手机号和邮箱遮盖，不等同于完整 DLP。
- 中断续写入口：可优先实现真实 PostgreSQL repository，让当前内存 repository/fact store 迁移到持久化；或先补 FastAPI read-only 查询接口。

### 任务：实现聚合与查询服务模块

- 时间：2026-05-17 21:33
- 执行者：AI
- 状态：已完成
- 目标：实现第四模块 `04-aggregation-query-api` 的纯 Python 聚合和查询服务，并补充测试。
- 当前理解：当前不引入 FastAPI 或真实数据库；先基于 `InMemoryFactStore` 和 `RawEventRepository` 生成稳定查询结果，覆盖大盘活跃、操作员漏斗、聊天/微信指标、健康指标、空数据结构和敏感字段默认不返回。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/metrics.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/api/query_service.py`
  - `src/boss_analysis/api/__init__.py`
  - `tests/test_query_service.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改日志契约和模块设计文档
  - 不实现 HTTP server、认证、导出任务、CLS 定时 SQL 读取或前端
  - 不返回聊天正文、联系方式或完整简历正文
- 验证计划：运行全部单元测试；运行 `python3 -m compileall src`。
- 下一步：进入第五模块 `05-operations-security`，实现配置读取、密钥脱敏和基础运行健康模型。

#### 阶段记录：完成聚合查询服务实现与测试

- 时间：2026-05-17 21:35
- 状态：已完成
- 已完成：新增指标模型 `ActiveOperatorSummary`、`DashboardSummary`、`FunnelSummary`、`ChatSummary`、`OperatorAnalytics`、`HealthSummary`；新增 `AnalysisQueryService`，支持实时活跃大盘、单人漏斗/聊天/微信指标、健康指标和空数据稳定结构；查询结果默认不包含聊天正文、联系方式或微信账号。
- 改动文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/metrics.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/api/query_service.py`
  - `src/boss_analysis/api/__init__.py`
  - `tests/test_query_service.py`
- 验证结果：
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m unittest discover -s tests` 通过，27 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m compileall src` 通过。
- 风险/阻塞：当前是纯 Python 查询服务，尚未接 FastAPI、认证、真实导出任务、CLS 定时 SQL 读取或前端；回复率、首响时长等复杂口径还未实现，需要后续详细指标设计。
- 中断续写入口：第五模块可从配置读取、密钥脱敏、健康检查对象和敏感字段策略开始。

### 任务：实现事实投影模块

- 时间：2026-05-17 21:28
- 执行者：AI
- 状态：已完成
- 目标：实现第三模块 `03-fact-projection` 的核心事实模型、内存事实仓库和 projector，并补充单元测试。
- 当前理解：本阶段不做业务评分和复杂分析，只把 raw event 转成事实；覆盖候选人曝光、详情 opened/closed、打招呼 clicked/succeeded/failed、聊天事实和身份线索。事实写入以源事件 ID 幂等；低置信身份不做跨事件强合并。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/facts.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/storage/facts.py`
  - `src/boss_analysis/storage/__init__.py`
  - `src/boss_analysis/workers/fact_projector.py`
  - `src/boss_analysis/workers/__init__.py`
  - `tests/test_fact_projector.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改日志契约和模块设计文档
  - 不实现真实数据库、聚合 API、前端或策略评分
  - 不展示或保存聊天正文、完整简历正文、联系方式等敏感正文到事实表
- 验证计划：运行全部单元测试；运行 `python3 -m compileall src`。
- 下一步：进入第四模块 `04-aggregation-query-api`，基于 facts 实现聚合指标和查询服务。

#### 阶段记录：完成 fact projector 实现与测试

- 时间：2026-05-17 21:33
- 状态：已完成
- 已完成：新增事实模型 `CandidateIdentityFact`、`CandidateExposureFact`、`CandidateDetailSessionFact`、`CandidateGreetingFact`、`CandidateChatFact` 和 `FactProjectionResult`；新增 `InMemoryFactStore`；新增 `FactProjector`，支持候选人卡片曝光、详情打开/关闭回填、打招呼点击/成功/失败、聊天打开/快照/微信/失败事实投影，未知事件跳过，低置信身份使用 local key 不跨事件强合并，聊天事实只保存计数和状态不保存正文或账号。
- 改动文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/facts.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/storage/facts.py`
  - `src/boss_analysis/storage/__init__.py`
  - `src/boss_analysis/workers/fact_projector.py`
  - `src/boss_analysis/workers/__init__.py`
  - `tests/test_fact_projector.py`
- 验证结果：
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m unittest discover -s tests` 通过，21 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m compileall src` 通过。
- 风险/阻塞：当前仍是内存事实仓库，未实现真实事实表 schema；聊天和微信事实没有保存敏感正文或账号，只保存计数/状态，后续查询 API 需要继续保持默认隐藏敏感内容。
- 中断续写入口：第四模块可从 `InMemoryFactStore` 的 exposure/detail/greeting/chat facts 生成操作员、岗位、漏斗和数据健康聚合。

### 任务：实现存储与重放模块

- 时间：2026-05-17 21:24
- 执行者：AI
- 状态：已完成
- 目标：实现第二模块 `02-storage-replay` 的核心 repository 行为和重放筛选能力，并补充单元测试。
- 当前理解：当前不新增数据库依赖，不接真实 PostgreSQL；先以 domain 数据结构、repository 协议和内存实现固定 raw event 幂等保存、解析错误记录、投影错误记录、按条件重放这些行为，后续再替换为 PostgreSQL/SQLAlchemy 实现。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/storage.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/storage/raw_events.py`
  - `src/boss_analysis/storage/__init__.py`
  - `tests/test_storage_replay.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改日志契约和现有模块设计文档
  - 不实现真实 PostgreSQL、Alembic、Kafka consumer、事实投影或 API
  - 不新增依赖、不连接真实云资源
- 验证计划：运行全部单元测试；运行 `python3 -m compileall src`。
- 下一步：进入第三模块时从 `03-fact-projection` 开始，在 `RawEventRepository` 的重放结果上实现事实投影。

#### 阶段记录：完成 storage/replay 行为实现

- 时间：2026-05-17 21:27
- 状态：已完成
- 已完成：新增存储领域模型 `RawEventRecord`、`EventErrorRecord`、`RawEventSaveResult`、`ReplayFilter` 和 `RawEventRepository` 协议；新增 `InMemoryRawEventRepository`，支持 normalized event 幂等保存、缺失 `event_id` 错误记录、解析错误记录、投影/聚合/重放错误记录、按时间/事件类型/插件版本/解析状态筛选重放，并按发生时间稳定排序。
- 改动文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/storage.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/storage/raw_events.py`
  - `src/boss_analysis/storage/__init__.py`
  - `tests/test_storage_replay.py`
- 验证结果：
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m unittest discover -s tests` 通过，13 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m compileall src` 通过。
- 风险/阻塞：当前是无外部依赖的内存 repository，用于固定行为和测试；尚未实现 PostgreSQL schema、事务、Alembic migration 或真实持久化。缺失 `event_id` 的事件不会写入 raw event 主表，只记录错误，符合“缺失时进入错误记录，不猜测替代主键”的原则。
- 中断续写入口：第三模块可读取 `replay_raw_events()` 返回的 `RawEventRecord`，实现候选人曝光、详情、打招呼和聊天事实投影；真实数据库实现应保持本次 repository 协议行为一致。

### 任务：实现输入消费与标准化模块

- 时间：2026-05-17 21:11
- 执行者：AI
- 状态：已完成
- 目标：实现第一个模块 `01-ingestion-normalization` 的核心 normalizer 和内部事件模型，并添加离线单元测试。
- 当前理解：第一步不接真实 CLS Kafka，不写数据库；只把 CLS 扁平日志字典标准化为内部事件对象，覆盖 JSON 解析、时间解析、关键字段校验、未知事件类型兼容和 `boss_account_matched` 布尔兼容。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/events.py`
  - `src/boss_analysis/consumer/normalizer.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `tests/test_normalizer.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改日志契约和现有模块设计文档
  - 不实现 Kafka consumer、数据库 repository、事实投影或 API
  - 不新增依赖、不连接真实云资源
- 验证计划：运行 normalizer 单元测试；运行 `python3 -m compileall src`。
- 下一步：进入第二模块时从 `02-storage-replay` 开始，实现 `raw_events` 持久化和解析错误保存。

#### 阶段记录：完成 normalizer 实现与测试

- 时间：2026-05-17 21:15
- 状态：已完成
- 已完成：新增内部事件模型 `NormalizedEvent` / `ParseIssue`，实现 `normalize_cls_event`，支持 CLS 扁平字段清洗、ISO 8601 时间解析、`payload_json`/`context_json` 解析、`boss_account_matched` 布尔兼容、未知事件类型透传、关键字段失败状态和可恢复字段 partial 状态；新增 7 个单元测试覆盖模块文档要求的主要场景。
- 改动文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/events.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/consumer/normalizer.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `tests/test_normalizer.py`
- 验证结果：
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m unittest discover -s tests` 通过，7 个测试。
  - `PYTHONPATH=src PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m compileall src` 通过。
- 风险/阻塞：本机 `python3` 是 3.9，项目声明 Python 3.11+；本次实现使用 `from __future__ import annotations` 和 `timezone.utc`，已兼容本机验证。当前尚未实现 Kafka 消费确认、数据库写入和解析错误表，这些属于后续模块。
- 中断续写入口：下一步可接 `docs/modules/02-storage-replay.md`，将 `NormalizedEvent` 写入 `raw_events`，并保存 `parse_errors`。

### 任务：调研 CLS SQL 离线分析能力并补充 overview

- 时间：2026-05-17 20:56
- 执行者：AI
- 状态：已完成
- 目标：确认腾讯云 CLS 是否支持在平台上配置 SQL 分析/定时分析任务，并据此调整历史数据读取和离线聚合的 overview 设计。
- 当前理解：用户希望如果 CLS 平台能直接配置 SQL 分析任务，那么历史数据可以优先读取 CLS 离线分析产物，而不是全部由 analysis-system 自建历史聚合。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/overview-design.md`
  - 必要时 `docs/runtime-plan.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改日志契约
  - 不做详细表结构、具体 SQL 任务和代码实现
- 验证计划：查阅腾讯云官方文档；检查文档修改仍停留在 overview/运行方案级别；文档任务不运行代码测试。
- 下一步：后续详细设计时确定哪些指标走 CLS 定时 SQL、哪些指标由 analysis-system 自建事实表/聚合表计算。

#### 阶段记录：确认 CLS 定时 SQL 能力

- 时间：2026-05-17 20:58
- 状态：实现中
- 已完成：查阅腾讯云官方文档，确认 CLS 支持“定时 SQL 分析”：可在控制台创建，也有 `CreateScheduledSql` API；任务按调度范围、调度周期和 SQL 时间窗口周期性查询源日志主题，并将结果写入目标日志主题或指标主题。该能力适合把历史/长周期指标预聚合成可查询的离线汇总源。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：官方文档同时说明源日志主题需要开启键值索引；定时 SQL 结果可写目标日志主题/指标主题；指定时间范围任务可用于历史范围；存在任务数、并发、时间窗口和结果大小限制。
- 风险/阻塞：CLS 结果不是 PostgreSQL 表，而是目标日志主题或指标主题；如果前端需要关系型查询，analysis-system 仍需通过 API 读取或把结果同步入库。低频存储不支持 SQL 分析，只能对标准存储数据做定时 SQL。
- 中断续写入口：更新 `docs/overview-design.md` 和 `docs/runtime-plan.md`，把 CLS 定时 SQL 作为历史离线聚合源纳入架构。

#### 阶段记录：完成 overview 和运行方案补充

- 时间：2026-05-17 20:59
- 状态：已完成
- 已完成：已在 `docs/overview-design.md` 增加 CLS 定时 SQL 分析路径、离线汇总读取/同步、后端模块、数据处理原则、实现顺序和详细设计待定项；已在 `docs/runtime-plan.md` 增加 `summary-reader`、CLS 定时 SQL 资源、产品选型和使用原则。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/overview-design.md`
  - `docs/runtime-plan.md`
- 验证结果：`rg -n "定时 SQL|summary-reader|offline-summary|离线汇总|PostgreSQL 表|低频存储|指标主题|目标日志主题" docs/overview-design.md docs/runtime-plan.md` 已确认相关段落存在；文档明确 CLS 定时 SQL 结果是目标日志主题/指标主题，不是 PostgreSQL 表。
- 风险/阻塞：本次只做文档和官方能力确认，未实际创建腾讯云任务；如果后续操作真实 CLS 资源，需要先列出源主题、目标主题、SQL、调度范围、权限和费用风险并获得确认。
- 中断续写入口：从指标口径清单开始，逐项判断实时自建、CLS 定时 SQL、或两者结合。

### 任务：补充前后端 overview 模块设计

- 时间：2026-05-17 20:50
- 执行者：AI
- 状态：已完成
- 目标：根据用户提出的大盘实时活跃、单人详细数据分析、单人操作深度挖掘需求，先完成前后端 overview 级模块设计，不进入详细接口、表结构或算法设计。
- 当前理解：本次是分析系统文档设计任务，重点更新总览设计里的产品能力、前后端模块边界、数据链路和第一阶段实现顺序；仍需遵守只消费日志契约、不读取插件运行时、不修改父项目文件的边界。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/overview-design.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改 `../../docs/modules/12-log-specification.md`
  - 不写详细表结构、详细 API、具体算法和运行时代码
  - 不采集或展示未确认范围内的敏感正文
- 验证计划：检查总览文档与 `README.md`、`docs/boundary.md`、模块文档索引及日志契约边界一致；文档任务不运行代码测试。
- 下一步：可进入指标口径清单或模块详细设计，优先从活跃口径、漏斗关联和聊天回复口径开始。

#### 阶段记录：完成文档阅读与 overview 修改

- 时间：2026-05-17 20:52
- 状态：待验证
- 已完成：已阅读 `README.md`、`docs/boundary.md`、`docs/overview-design.md`、`docs/modules/*.md`、`../docs/modules/12-log-specification.md`、`pyproject.toml`、`src/boss_analysis/__init__.py` 和 `tests/README.md`；已把用户提出的大盘、单人详细分析、单人操作深度挖掘需求写入 overview 级前后端模块设计。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/overview-design.md`
- 验证结果：尚未验证；下一步检查文档 diff、链接路径、边界约束和是否误入详细设计。
- 风险/阻塞：聊天回复率、回复时长和微信获取率依赖后续详细指标口径；当前日志契约中的聊天快照是 `visible_dom`，可能不完整，已在 overview 中标注需要完整性提示。
- 中断续写入口：从检查 `docs/overview-design.md` diff 和文档一致性继续。

#### 阶段记录：完成 overview 验证

- 时间：2026-05-17 20:53
- 状态：已完成
- 已完成：检查更新后的 `docs/overview-design.md`，确认已覆盖大盘、单人详细数据分析、单人操作深度挖掘、后端模块、前端模块、数据主题、实现顺序和后续详细设计待定项；确认日志契约文件存在且本次未修改父项目文件。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/overview-design.md`
- 验证结果：`test -f ../docs/modules/12-log-specification.md` 通过；`rg -n "CREATE TABLE|GET /|POST /|SELECT |UPDATE |INSERT |performance score|候选人质量评分|员工绩效判断|话术质量结论" docs/overview-design.md` 只命中禁止把员工绩效、候选人质量和话术质量写死为结论的边界说明，未发现表结构、详细 API 或 SQL 设计。
- 风险/阻塞：本次是文档 overview 任务，未运行代码测试；父项目已有未提交改动且 `analysis-system/` 仍显示为未跟踪目录，本次没有处理这些 git 状态。
- 中断续写入口：下一步可进入指标口径清单或模块详细设计，优先从活跃口径、漏斗关联和聊天回复口径开始。

### 任务：生成分析系统独立协作文档

- 时间：2026-05-17 20:33
- 执行者：AI
- 状态：已完成
- 目标：参考父项目协作规范，为 `analysis-system/` 生成独立的模块设计、进度日志和相关接手文档。
- 当前理解：分析系统是独立后端子项目，只能读取父项目日志规范契约，不修改父项目文件；当前已有 `README.md`、`docs/boundary.md`、`docs/runtime-plan.md` 和基础源码目录，但缺少子项目自己的进度日志、总览设计和模块文档。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/overview-design.md`
  - `docs/modules/*.md`
  - 必要时更新 `README.md` 的目录说明
- 不修改范围：
  - 不修改 `analysis-system/` 之外的任何文件
  - 不修改父项目 `../docs/modules/12-log-specification.md`
  - 不实现运行时代码、不新增依赖、不连接真实云资源
- 验证计划：检查文档链接和目录结构；如有可用测试命令则运行轻量验证。
- 下一步：后续实现可从 normalizer 内部事件模型和离线样本测试开始。

#### 阶段记录：完成独立文档生成

- 时间：2026-05-17 20:34
- 状态：已完成
- 已完成：生成分析系统子项目自己的总览设计、模块文档索引、输入标准化、存储重放、事实投影、聚合查询 API、运行安全文档；更新 `README.md` 和 `AGENTS.md`，让后续 AI 先读并维护子项目自己的 `docs/ai-worklog.md`。
- 改动文件：
  - `AGENTS.md`
  - `README.md`
  - `docs/ai-worklog.md`
  - `docs/overview-design.md`
  - `docs/modules/README.md`
  - `docs/modules/01-ingestion-normalization.md`
  - `docs/modules/02-storage-replay.md`
  - `docs/modules/03-fact-projection.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `docs/modules/05-operations-security.md`
- 验证结果：`PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache python3 -m compileall src` 通过；`find docs -maxdepth 3 -type f -print` 确认新增文档存在。
- 风险/阻塞：当前仓库根目录已有父项目未提交改动，本次未修改 `analysis-system/` 之外的文件；`analysis-system/` 目录整体在 git 中仍显示为未跟踪。
- 中断续写入口：下一步如果进入代码实现，先读本日志最新记录，再从 `docs/modules/01-ingestion-normalization.md` 建立 normalizer 和离线样本测试。
