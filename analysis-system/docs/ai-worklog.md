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

### 任务：Task4 Offline Materials Integration

- 时间：2026-06-18 18:50 CST
- 执行者：AI
- 状态：已完成
- 目标：将三类离线材料（historical effects / operation overview / operation details）接入 `run_daily_analysis_generation`，并通过 CLI 文件参数读取后写入模型输入包及数据质量缺口。
- 当前理解：仅做材料入包，不进行模型结论生成；保持官方结果、行为摘要、job_actions 兼容；不修改分析逻辑口径。
- 计划修改文件：
  - `src/boss_analysis/ops/generate_daily_analysis.py`
  - `tests/test_generate_daily_analysis_command.py`
  - `docs/ai-worklog.md`
- 不修改范围：
  - `src/boss_analysis/domain/daily_analysis_materials.py`
  - `README.md`
  - `docs/modules/09-daily-analysis-llm-strategy.md`
  - 插件、frontend、父项目
- 验证计划：
  - `env PYTHONPATH=src python3 -m unittest tests.test_generate_daily_analysis_command -v`
  - `env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials tests.test_generate_daily_analysis_command -v`
  - `git diff --check -- src/boss_analysis/ops/generate_daily_analysis.py tests/test_generate_daily_analysis_command.py docs/ai-worklog.md`
- 下一步：补全并执行验证，回写完成状态与风险。

#### 阶段记录：完成 Task4 材料入包与 CLI 解析

- 时间：2026-06-18 19:24 CST
- 状态：已完成
- 已完成：
  - 在 `src/boss_analysis/ops/generate_daily_analysis.py` 新增三类材料输入参数，调用 `build_historical_effects_14d`、`build_operation_overview_14d`、`build_operation_details`，并写入 `model_input_packet.facts`。
  - 更新 `data_quality` 为基于材料 `source_state` 与 `operation_details.data_gaps` 的缺口清单，始终保留 `model_analysis`。
  - 新增 CLI 参数 `--daily-basic-source-file`、`--operation-overview-source-file`、`--operation-details-source-file`，并在 `main()` 中读取并透传。
  - 在 `tests/test_generate_daily_analysis_command.py` 新增 `test_generation_includes_historical_effects_operation_overview_and_details` 覆盖三类材料入包与 `data_quality.missing_fields`。
- 改动文件：
  - `src/boss_analysis/ops/generate_daily_analysis.py`
  - `tests/test_generate_daily_analysis_command.py`
- 验证结果：
  - `env PYTHONPATH=src python3 -m unittest tests.test_generate_daily_analysis_command -v`（通过）
  - `env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials tests.test_generate_daily_analysis_command -v`（通过）
  - `git diff --check -- src/boss_analysis/ops/generate_daily_analysis.py tests/test_generate_daily_analysis_command.py docs/ai-worklog.md`（通过）
- 风险/阻塞：
  - Operation overview / historical effects 的 `source_state` 为 `loaded` 依赖窗口覆盖完整，需在真实离线运行中保持输入数据齐全。
- 中断续写入口：如需扩展 CLI 输入文件格式，优先加独立单元测试验证读取分支。

### 任务：Task3 Operation Details Sanitizer 质量修复

- 时间：2026-06-18 11:30 CST
- 执行者：AI
- 状态：已完成
- 目标：修复 `build_operation_details` 与 `_sanitize_detail_item` 的质量缺口与字段透传问题，保证 Task4 前数据质量判定一致。
- 当前理解：当前实现对异常输入形态未统一记 `partial`，`timeline_windows` 对敏感嵌套字段未做白名单收紧，导致复核缺口统计与事实口径偏差。
- 计划修改文件：
  - `src/boss_analysis/domain/daily_analysis_materials.py`
  - `tests/test_daily_analysis_materials.py`
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改 Task4 文件
  - 不改动分析系统以外文件
  - 不新增依赖
- 验证计划：
  - `env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials -v`
  - `git diff --check -- src/boss_analysis/domain/daily_analysis_materials.py tests/test_daily_analysis_materials.py docs/ai-worklog.md`
- 下一步：执行测试并补齐未覆盖的细化断言。

#### 阶段记录：完成 Task3 质量修复

- 时间：2026-06-18 11:44 CST
- 状态：已完成
- 已完成：
  - 修复 `build_operation_details`：`value=None` 保持 `not_loaded`，非 `Mapping` 输入改为 `source_state="partial"`，并附带 `data_gaps=["operation_details"]`。
  - 非列表集合与集合内非 Mapping 条目均纳入质量缺口，不重复添加 gap，且当无有效保留条目时确保 `source_state="partial"`。
  - `_sanitize_detail_item` 增加 `operation_counts` 与 `source_event_ids` 收紧规则，避免嵌套对象/文本透传。
  - 新增/调整测试覆盖 `non-mapping value`、`all 非 mapping collection items`、`timeline_windows` 嵌套敏感字段脱敏。
- 改动文件：
  - `src/boss_analysis/domain/daily_analysis_materials.py`
  - `tests/test_daily_analysis_materials.py`
  - `docs/ai-worklog.md`
- 验证结果：
  - `env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials -v`（通过，57 tests）
- 风险/阻塞：
  - 仍沿用现有 `source_state` 只读规则；空输入映射（无任何 collection）保持空列表与 `loaded`（无已观测 source 项）行为，待后续任务确认是否收紧。
- 中断续写入口：从 `build_operation_details` 与相关 `test_operation_details_*` 用例继续验证。

### 任务：Task3 Operation Details Sanitizer 二次复核

- 时间：2026-06-18 17:20 CST
- 执行者：AI
- 状态：已完成
- 目标：处理 `timeline_windows` 日期过滤、`source_event_ids` 安全 ID 过滤与空输入空白口径，消除 Task3 剩余质量复核问题。
- 当前理解：
  - `timeline_windows` 日期判断必须优先 `window_start`；
  - `source_event_ids` 必须过滤非法 ID 字符串，避免 URL/中文等敏感文本落盘；
  - `value={}` 或全部 collection 空/缺失不能再返回 `loaded`。
- 计划修改文件：
  - `src/boss_analysis/domain/daily_analysis_materials.py`
  - `tests/test_daily_analysis_materials.py`
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不改 Task4 文件
  - 不新增依赖
  - 不跨项目修改文件
- 验证计划：
  - `env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials -v`
  - `git diff --check -- src/boss_analysis/domain/daily_analysis_materials.py tests/test_daily_analysis_materials.py docs/ai-worklog.md`
- 下一步：等待本轮测试通过并确认是否进入 Task4 接入。

#### 阶段记录：完成 Task3 二次复核

- 时间：2026-06-18 17:20 CST
- 状态：已完成
- 已完成：
  - `build_operation_details` 日期匹配改造为 collection 感知：`timeline_windows` 仅使用 `window_start`，其余 collection 使用 `occurred_at`。
  - 新增 `source_event_id` 白名单校验，允许 `[A-Za-z0-9_.:-]`、1..128 长度，并拒绝 `://`、空白、手机号样式长数字等非 ID 文本。
  - `value={}`、`value` 为全部空列表时返回 `source_state="not_loaded"` 且补齐 `operation_details` 缺口。
  - 当有源数据但未保留任何有效条目（人员过滤/日期过滤）仍保持 `partial`。
- 改动文件：
  - `src/boss_analysis/domain/daily_analysis_materials.py`
  - `tests/test_daily_analysis_materials.py`
  - `docs/ai-worklog.md`
- 验证结果：
  - `env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials -v`（通过，60 tests）
  - `git diff --check -- src/boss_analysis/domain/daily_analysis_materials.py tests/test_daily_analysis_materials.py docs/ai-worklog.md`（通过）
- 风险/阻塞：
  - `source_event_id` 白名单会继续拦截非 ASCII、含协议符、超长数字类字符串；如上游有合法异常格式需先行确认。
- 中断续写入口：如 `timeline_windows` 新增时间字段，补一条 collection-aware 的日期判定回归测试。

#### 阶段记录：完成 Task3 单值 source_event_id 安全口径小修

- 时间：2026-06-18 18:10 CST
- 状态：已完成
- 已完成：
  - 在 `_sanitize_detail_item` 中对白名单字段 `source_event_id` 使用 `_is_valid_source_event_id` 清洗，不合法值直接移除。
  - 在 `test_operation_details_filters_to_target_date_and_removes_sensitive_fields` 中覆盖 detail 事件，确认：
    - `source_event_id` 为 `evt_1` 保留；
    - `https://...`、`13800000000`、`聊天正文` 不出现在 JSON 输出；
    - 目标日内条目数量保持为 4 条（含无效 `source_event_id` 被清洗后的保留字段）。
- 改动文件：
  - `src/boss_analysis/domain/daily_analysis_materials.py`
  - `tests/test_daily_analysis_materials.py`
  - `docs/ai-worklog.md`
- 验证结果：
  - `env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials -v`（通过，60 tests）
  - `git diff --check -- src/boss_analysis/domain/daily_analysis_materials.py tests/test_daily_analysis_materials.py docs/ai-worklog.md`（通过）
- 风险/阻塞：
  - 无新增阻塞；继续进入 Task4 接入链路验证。
- 中断续写入口：Task4 继续消费 `build_operation_details` 结果。

## 当前任务

### 任务：用最新离线方式分析 2026-06-17 数据

- 时间：2026-06-18 14:16 CST
- 执行者：Codex
- 状态：已完成
- 目标：按当前离线日常分析入口生成并检查 2026-06-17 的分析结果，确认官方结果、14 天效果数据、操作概览和操作明细素材是否进入模型输入包。
- 当前理解：本地入口只生成事实证据包和 `model_input_packet`；归因、复盘优先级和 action 必须来自大模型输出。若本地缺少已批准素材文件或模型输出，应如实保留缺口，不通过 CLS Search/SearchLog 临时补齐。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `data/daily-analysis-results/2026-06-17.json`（如离线生成成功）
- 不修改范围：
  - 不修改业务代码、测试、前端、插件、父项目和 strategy
  - 不使用生产禁止的 CLS Search/SearchLog 作为数据源
- 验证计划：
  - 检查本地可用 source-file / 配置
  - 运行 `./generate-daily-analysis.sh 2026-06-17`
  - 回读输出 JSON 的 `sync_state`、`data_quality` 和 `model_input_packet.facts`
- 下一步：查找本地素材文件与运行配置，执行离线生成。

#### 阶段记录：完成 2026-06-17 离线生成与结果复核

- 时间：2026-06-18 14:25 CST
- 状态：已完成
- 已完成：
  - 确认本地只配置了 `BOSS_ANALYSIS_OPERATOR_CONFIG_FILE=config/operators.local.json`，未配置三类素材 source-file 路径。
  - 运行 `./generate-daily-analysis.sh 2026-06-17`，成功写出 `data/daily-analysis-results/2026-06-17.json`。
  - 回读输出 JSON，确认过滤后进入模型输入包的官方结果为 9 个操作员、29 条岗位结果；`model_state=model_output_required`。
  - 确认 `historical_effects_14d`、`operation_overview_14d`、`operation_details` 均为 `source_state=not_loaded`，`data_quality.missing_fields` 包含这三项和 `model_analysis`。
- 改动文件：
  - `docs/ai-worklog.md`
  - `data/daily-analysis-results/2026-06-17.json`
- 验证结果：
  - `./generate-daily-analysis.sh 2026-06-17`（通过）
  - Python 回读 `data/daily-analysis-results/2026-06-17.json`（通过）
- 风险/阻塞：
  - 本次未接入前 14 天效果数据、操作概览和操作明细；只能基于官方结果做受限复盘，不能声称已完成波动归因。
  - 本地离线入口仍未接入真实大模型调用，结果文件保留 pending LLM 状态。
- 中断续写入口：如需完整材料重跑，先准备 `--daily-basic-source-file`、`--operation-overview-source-file`、`--operation-details-source-file`，再重新执行同一入口。

### 任务：每日同步 BOSS 官方结果至飞书

- 时间：2026-06-18 05:00 CST
- 执行者：AI 自动化
- 状态：执行中
- 目标：按 Asia/Shanghai 当前日期前一天（2026-06-17）运行 `./sync-official-results.sh 2026-06-17`，采集 BOSS 官方结果并上传至飞书，再用 dry-run 验证幂等。
- 当前理解：本次仅运行既有同步脚本和幂等验证，不修改业务代码、不输出 app secret、tenant token、cookie、session、BOSS 登录态或记录明细。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `$CODEX_HOME/automations/boss/memory.md`
- 不修改范围：
  - 不修改分析系统业务代码、测试、配置模板
  - 不修改父项目、插件、strategy
- 验证计划：
  - `./sync-official-results.sh 2026-06-17`
  - `./sync-official-results.sh 2026-06-17 --dry-run` 并确认 `would_create=0`
- 下一步：执行同步脚本并记录汇总结果。

#### 阶段记录：完成 2026-06-17 官方结果同步

- 时间：2026-06-18 05:02 CST
- 状态：已完成
- 已完成：
  - 运行 `./sync-official-results.sh 2026-06-17`，采集并上传 2026-06-17 的 BOSS 官方结果。
  - 运行 `./sync-official-results.sh 2026-06-17 --dry-run` 做同日幂等验证。
- 改动文件：
  - `docs/ai-worklog.md`
  - `/Users/tiny/.codex/automations/boss/memory.md`
- 验证结果：
  - 实际同步：`operator_rows=11`，`job_rows=33`，总采集行数 44；`applied_create=44`，`applied_update=0`。
  - 幂等 dry-run：`would_create=0`，`would_update=44`，`applied_create=0`，`applied_update=0`。
- 风险/阻塞：
  - `unmatched_operator_count=5`，本次未展开记录明细，需如需处理映射时另行排查。
- 中断续写入口：下次自动化继续按统计日前一天执行同一脚本，并检查 dry-run 的 `would_create`。

### 任务：Task5 CLI Source-File Tests And Documentation

- 时间：2026-06-18 02:52 CST
- 执行者：AI
- 状态：已完成
- 目标：补齐 CLI source-file 集成测试、缺省缺口断言、必要的错误输入可观测性，并同步 README / LLM 策略文档。
- 当前理解：Task4 已接入三类材料，但还缺针对 `main()` 文件输入路径的覆盖、默认缺口回归和文档沉淀；允许小范围收紧 CLI 输入错误行为，不触碰 material builder。
- 计划修改文件：
  - `tests/test_generate_daily_analysis_command.py`
  - `src/boss_analysis/ops/generate_daily_analysis.py`
  - `README.md`
  - `docs/modules/09-daily-analysis-llm-strategy.md`
  - `docs/ai-worklog.md`
- 不修改范围：
  - `src/boss_analysis/domain/daily_analysis_materials.py`
  - 前端、插件、父项目、strategy
  - 不新增依赖
- 验证计划：
  - `env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials tests.test_generate_daily_analysis_command tests.test_daily_analysis -v`
  - `python3 -m py_compile src/boss_analysis/domain/daily_analysis_materials.py src/boss_analysis/ops/generate_daily_analysis.py`
  - `git diff --check -- src/boss_analysis/domain/daily_analysis_materials.py src/boss_analysis/ops/generate_daily_analysis.py tests/test_daily_analysis_materials.py tests/test_generate_daily_analysis_command.py README.md docs/modules/09-daily-analysis-llm-strategy.md docs/ai-worklog.md`
- 下一步：先扩展 `main()` 集成测试，再根据测试需要收紧 CLI 文件读取错误处理，最后回写文档和验证结果。

#### 阶段记录：完成 Task5 CLI 测试与文档同步

- 时间：2026-06-18 02:55 CST
- 状态：已完成
- 已完成：
  - 扩展 `test_main_reads_source_file_and_writes_result_summary`，通过临时 `daily-basic.json`、`operation-overview.json`、`operation-details.json` 覆盖 `main()` 的三类 source-file 输入，并回读输出 JSON 断言三类材料的 `source_state`。
  - 在默认未提供三类材料的回归测试中补齐 `historical_effects_14d`、`operation_overview_14d`、`operation_details` 缺口断言。
  - 收紧 CLI 顶层 JSON 形态校验：`--operation-overview-source-file` 非 list / `{rows:list}`、`--operation-details-source-file` 非 Mapping 时抛 `ValueError`，并新增 `main()` 退出码 2 测试。
  - 更新 `README.md` 的日常分析离线结果说明，补充三类素材文件示例、14 天窗口边界和生产禁止使用 CLS Search/SearchLog 的约束。
  - 更新 `docs/modules/09-daily-analysis-llm-strategy.md`，加入 `historical_effects_14d` 与 `operation_overview_14d` 的 fact-only 输入说明。
- 改动文件：
  - `tests/test_generate_daily_analysis_command.py`
  - `src/boss_analysis/ops/generate_daily_analysis.py`
  - `README.md`
  - `docs/modules/09-daily-analysis-llm-strategy.md`
  - `docs/ai-worklog.md`
- 验证结果：
  - `env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials tests.test_generate_daily_analysis_command tests.test_daily_analysis -v`（通过，73 tests）
  - `python3 -m py_compile src/boss_analysis/domain/daily_analysis_materials.py src/boss_analysis/ops/generate_daily_analysis.py`（通过）
  - `git diff --check -- src/boss_analysis/domain/daily_analysis_materials.py src/boss_analysis/ops/generate_daily_analysis.py tests/test_daily_analysis_materials.py tests/test_generate_daily_analysis_command.py README.md docs/modules/09-daily-analysis-llm-strategy.md docs/ai-worklog.md`（通过）
- 风险/阻塞：
  - CLI 现在会对两类顶层 JSON 形态直接失败关闭；如果历史脚本依赖旧的静默降级行为，需要同步调整调用侧文件格式。
- 中断续写入口：如后续还要增强 source-file 兼容性，优先从 `tests/test_generate_daily_analysis_command.py` 的 `test_main_rejects_invalid_*` 两个用例和 `src/boss_analysis/ops/generate_daily_analysis.py` 的文件读取 helper 继续。

#### 阶段记录：接手 Task5 复核修复

- 时间：2026-06-18 02:58 CST
- 状态：实现中
- 已完成：
  - 读取 `docs/ai-worklog.md`、`README.md`、`docs/boundary.md`、`docs/overview-design.md`、`docs/modules/09-daily-analysis-llm-strategy.md`、`../docs/modules/12-log-specification.md`，确认本轮只处理 Task5 复核问题。
  - 检查 `git status --short` 与相关 diff，确认工作区存在大量其他模块改动，本轮仅修改允许文件：`tests/test_generate_daily_analysis_command.py`、`docs/modules/09-daily-analysis-llm-strategy.md`、`docs/ai-worklog.md`；仅当合法空形态测试确有必要时才触碰 `src/boss_analysis/ops/generate_daily_analysis.py`。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：
  - 尚未执行；下一步先补 `model_analysis` 缺口断言与 `--operation-overview-source-file` 合法空形态测试，确认红灯。
- 风险/阻塞：
  - 当前 Task5 已有“invalid shape 直接失败关闭”实现，需确认顶层 `[]` 与 `{ "rows": [] }` 是否被误伤，同时保持其他非法形态继续失败关闭。
- 中断续写入口：从 `tests/test_generate_daily_analysis_command.py` 继续，优先检查默认缺口断言与 `main()` source-file 测试。

#### 阶段记录：完成 Task5 复核修复

- 时间：2026-06-18 03:03 CST
- 状态：已完成
- 已完成：
  - 在 `tests/test_generate_daily_analysis_command.py` 为默认输入、三类材料 loaded/partial 场景补齐 `data_quality.missing_fields` 必含 `model_analysis` 的断言，锁定该缺口不会被后续回归删除。
  - 新增 `main()` 表驱动测试，确认 `--operation-overview-source-file` 同时接受顶层 `[]` 与 `{ "rows": [] }` 两种合法空形态；两种输入都返回 0，且输出中的 `operation_overview_14d.source_state` 为 `not_loaded`，缺口仍落在 `data_quality`。
  - 更新 `docs/modules/09-daily-analysis-llm-strategy.md` 输入约束，明确生产链路禁止通过 CLS Search/SearchLog 补齐 `historical_effects_14d`、`operation_overview_14d`、`operation_details`，只能使用已批准同步结果、文件、数据库或指标 topic 路径。
  - 确认本轮无需修改 `src/boss_analysis/ops/generate_daily_analysis.py`；合法空形态兼容已由现有 helper 满足，问题是测试缺口。
- 改动文件：
  - `tests/test_generate_daily_analysis_command.py`
  - `docs/modules/09-daily-analysis-llm-strategy.md`
  - `docs/ai-worklog.md`
- 验证结果：
  - `env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials tests.test_generate_daily_analysis_command tests.test_daily_analysis -v`（通过，74 tests）
  - `python3 -m py_compile src/boss_analysis/domain/daily_analysis_materials.py src/boss_analysis/ops/generate_daily_analysis.py`（通过）
  - `git diff --check -- src/boss_analysis/domain/daily_analysis_materials.py src/boss_analysis/ops/generate_daily_analysis.py tests/test_daily_analysis_materials.py tests/test_generate_daily_analysis_command.py README.md docs/modules/09-daily-analysis-llm-strategy.md docs/ai-worklog.md`（通过）
- 风险/阻塞：
  - 本轮只锁住 `operation_overview` 的合法空形态；若后续还要扩大其他 source-file 的空输入兼容范围，应先定义对应 `source_state` 口径再补测试。
- 中断续写入口：如继续复核 source-file 兼容性，从 `test_main_accepts_empty_operation_overview_source_file_shapes` 和策略文档的生产边界段落继续。

#### 阶段记录：完成最终验证

- 时间：2026-06-18 03:03 CST
- 状态：已完成
- 已完成：
  - 按计划执行最终验证，覆盖日常分析材料、离线生成器、API 读取、dev server、官方结果同步命令和官方结果同步逻辑。
  - 执行目标 Python 文件编译检查。
  - 执行前端生产构建。
  - 执行目标改动文件 diff whitespace 检查。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：
  - `env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials tests.test_generate_daily_analysis_command tests.test_daily_analysis tests.test_dev_server tests.test_sync_official_results_command tests.test_official_results_sync -v`（通过，113 tests）
  - `python3 -m py_compile src/boss_analysis/domain/daily_analysis_materials.py src/boss_analysis/ops/generate_daily_analysis.py`（通过）
  - `cd frontend && npm run build`（通过）
  - `git diff --check -- src/boss_analysis/domain/daily_analysis_materials.py src/boss_analysis/ops/generate_daily_analysis.py tests/test_daily_analysis_materials.py tests/test_generate_daily_analysis_command.py README.md docs/modules/09-daily-analysis-llm-strategy.md docs/ai-worklog.md`（通过）
- 风险/阻塞：
  - 无新增阻塞；工作区仍有大量历史未提交改动，未在本轮回滚或整理。
- 中断续写入口：下一步可接真实大模型调用和模型输出校验；如要放宽 source-file 兼容性，先补测试再改 CLI helper。

### 任务：运营总览 14 天材料构建

- 时间：2026-06-18 10:08 CST
- 执行者：Codex
- 状态：已完成
- 目标：为 `build_operation_overview_14d` 补齐纯事实运营概览构建能力，支持14天窗口过滤、算子匹配、字段归一化与滚动汇总。
- 当前理解：仅处理配置算子和输入行，不新增策略/建议/归因逻辑，输出结构需包含 `source_state/window/operator_daily_rows/operator_rollups`，并按既有匹配规则复用 `operator_profile_index`。
- 计划修改文件：
  - `src/boss_analysis/domain/daily_analysis_materials.py`
  - `tests/test_daily_analysis_materials.py`
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改分析系统以外文件
  - 不新增依赖
  - 不改动前端/插件/策略库代码
- 验证计划：先补充导入与新用例确认红灯，再实现函数并运行 `env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials -v`
- 下一步：保持 Task 1 历史相关测试通过，确认 `source_state` 与覆盖率口径。

#### 阶段记录：完成 Task 2 代码与测试补全

- 时间：2026-06-18 10:26 CST
- 状态：已完成
- 已完成：
  - 在 `src/boss_analysis/domain/daily_analysis_materials.py` 新增 `OPERATION_OVERVIEW_FIELDS` 与 `build_operation_overview_14d`。
  - 新增 `datetime/字符串日期容忍解析`、`_to_int`、`_profile_for_operation_row`、`_operation_overview_row`、`_rollup_rows`。
  - 将 `_rollup_daily_rows` 委托到通用 `_rollup_rows`，并保持历史行为不变。
  - 在 `tests/test_daily_analysis_materials.py` 新增 `build_operation_overview_14d` 的完整测试集合，覆盖已配置算子筛选、窗口外过滤、14天覆盖、fallback 匹配、歧义匹配、禁用算子排除与字段整数化。
- 改动文件：
  - `src/boss_analysis/domain/daily_analysis_materials.py`
  - `tests/test_daily_analysis_materials.py`
  - `docs/ai-worklog.md`
- 验证结果：
  - `env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials -v` 全量通过（45 个测试）。
- 风险/阻塞：
  - 当前 `build_operation_overview_14d` 未接入调用方。
- 中断续写入口：如需后续，请在上层组装逻辑 `src/boss_analysis/domain/daily_analysis.py` 中接入。

#### 阶段记录：完成 Task 2 质量修复回归

- 时间：2026-06-18 10:51 CST
- 状态：已完成
- 已完成：
  - 为运营总览同日同算子重复行补充去重逻辑，按确定性优先级：`source_event_count`、字段和、稳定字段元组。
  - 增补运营总览 `active_date` 边界容错测试（None/空字符串/非法字符串），确保源行异常日期被容忍并从窗口过滤，不影响 source_state 与结果空行为。
- 改动文件：
  - `src/boss_analysis/domain/daily_analysis_materials.py`
  - `tests/test_daily_analysis_materials.py`
  - `docs/ai-worklog.md`
- 验证结果：
  - `env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials -v` 全量通过。
- 风险/阻塞：
  - 同日去重规则按事实值确定，不改变字段口径与调用方边界。
- 中断续写入口：待接入上层模块时使用当前返回结构；当前模块行为已完成验证。

#### 阶段记录：完成 Task 2 Z 时间戳与回归加固

- 时间：2026-06-18 11:07 CST
- 状态：已完成
- 已完成：
  - 为运营总览日期解析补充 RFC3339 风格 `Z` 后缀兼容，`2026-06-02T08:00:00Z` 及时区偏移字符串可被正确纳入窗口。
  - 强化 `_rollup_rows` 的 `display_name` 兜底字段，避免键缺失导致回滚异常。
  - 增加完全重复行顺序无关回归：同一输入集合在不同排序下，`operator_daily_rows` 与 `operator_rollups` 完全一致。
- 改动文件：
  - `src/boss_analysis/domain/daily_analysis_materials.py`
  - `tests/test_daily_analysis_materials.py`
  - `docs/ai-worklog.md`
- 验证结果：
  - `env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials -v` 全量通过（45 个测试）。
- 风险/阻塞：
  - 当前 `_rollup_rows` 回退仅针对 `display_name`，不改变事实口径。
- 中断续写入口：该阶段任务范围已闭环；进入上层接入时沿用当前返回结果。

#### 阶段记录：完成 Task 2 单次消费与 source_state 去重修复

- 时间：2026-06-18 11:18 CST
- 状态：已完成
- 已完成：
  - 将 `build_operation_overview_14d` 改为单次迭代 rows 处理：边走边过滤匹配并统计 `source_count`，避免事先 `tuple(rows)`；`source_state` 继续基于实际 source 行数。
  - 补充同日重复行的 `source_state` 去重优先级：`loaded > partial > not_loaded > unknown/blank`，并保持字段数值与展示字段为最终事实选择条件。
  - 增加非重入可迭代输入回归测试（一次性 row 容器），覆盖生成器/单次消费场景；确认在有效输入下输出仍正确。
  - 补充 `source_state` 并列场景回归测试（`loaded` 与 `partial` 字段完全一致时优先 `loaded`）。
  - 继续沿用 `_rollup_rows` 的 `display_name` 回退默认策略；本阶段未修改 `src/boss_analysis/domain/__init__.py`，因其不在 Task 2 允许文件范围内。
- 改动文件：
  - `src/boss_analysis/domain/daily_analysis_materials.py`
  - `tests/test_daily_analysis_materials.py`
  - `docs/ai-worklog.md`
- 验证结果：
  - `env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials -v` 全量通过（45 个测试）。
- 风险/阻塞：
  - 仍需上层业务组装调用 `build_operation_overview_14d`；当前模块内行为已就位。
- 中断续写入口：该阶段任务范围闭环，后续直接进入 Task 3 的集成与接入验证。

#### 阶段记录：完成 Task 2 `source_state` 空白去重复核修复

- 时间：2026-06-18 11:23 CST
- 状态：已完成
- 已完成：
  - 保留 `_operation_overview_row()` 对 `source_state` 的原始清洗值，不再将空白映射为 `"loaded"`，避免空值在同日同人去重时被错误提升。
- 改动文件：
  - `src/boss_analysis/domain/daily_analysis_materials.py`
  - `tests/test_daily_analysis_materials.py`
  - `docs/ai-worklog.md`
- 验证结果：
  - `env PYTHONPATH=src python3 -m unittest tests.test_daily_analysis_materials -v`
- 风险/阻塞：
  - 去重仍按现有多因子排序口径：`source_event_count`、`field_sum`、`source_state_rank`、稳定字段。
- 中断续写入口：继续执行 Task3 集成链路评审。

### 任务：只读验证远程 CLS 连接

- 时间：2026-05-19 18:27
- 执行者：AI
- 状态：已完成
- 目标：在用户明确授权读取 `analysis-system/` 后，查看远程 CLS 读取相关代码和配置，并做一次本地开发/排障性质的只读连接测试，方便后续离线分析读取数据。
- 当前理解：本轮只做读取和测试，不把 SearchLog 接入生产链路，不修改云端配置，不输出敏感候选人正文、联系方式、聊天正文或完整 URL 参数。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改 `analysis-system/` 运行时代码、SQL、前端或测试代码
  - 不修改 `analysis-system/` 之外文件
  - 不修改远程 CLS Topic、定时 SQL 或权限配置
- 验证计划：阅读 README、边界文档、概览和 CLS 相关模块/源码；优先运行离线单元测试；如本地环境已有凭据，再执行最小只读 smoke 查询并记录结果。
- 下一步：定位 CLS Search 配置和 smoke 查询入口，确认环境变量是否齐备后执行测试。

#### 阶段记录：完成 CLS 只读 smoke

- 时间：2026-05-19 18:32
- 状态：已完成
- 已完成：阅读 `README.md`、`docs/boundary.md`、`docs/overview-design.md`、CLS 汇总/API/运维/日志健康模块文档，以及 `cls_search.py`、`summary_reader.py`、`dev_data.py`、`dev_server.py` 和相关测试；确认本地排障可以只读调用 SearchLog，普通 dev 数据源仍禁用 raw SearchLog，只读取汇总 topic。加载 `.env.local` 后确认分钟汇总、日级汇总、10 分钟质量 topic 和腾讯云凭据均已配置。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：`PYTHONPATH=src python3 -m unittest discover tests` 通过，106 tests。首次远程查询在沙箱内因网络权限失败，授权后最小只读 smoke 通过：`CLS_SUMMARY_TOPIC_ID` 今天窗口返回 50 条可解析分钟汇总，其中 43 条推断为 `boss_minute_operator_funnel`、7 条推断为 `boss_minute_chat`，时间范围 UTC `2026-05-19T09:35:00+00:00` 至 `2026-05-19T10:29:00+00:00`；`create_dev_dataset(data_source="summary")` 可装载 50 条分钟汇总，raw 原始事件为 0，符合 summary 模式。`CLS_DAILY_SUMMARY_TOPIC_ID` 和 `CLS_LOG_QUALITY_TOPIC_ID` 连接成功，但今天窗口 smoke 返回 0 条原始记录。
- 风险/阻塞：本轮没有单独 raw 原始事实 topic 配置，只验证了已配置的汇总/日级/质量 topic；分钟汇总 topic 返回行未显式带 `metric_name`，当前解析器依赖字段集合推断 funnel/chat 类型。SearchLog 调用仅用于本地开发/排障，未接入生产链路。
- 中断续写入口：后续离线分析可优先用 `iter_minute_summaries_from_search()` 读取分钟汇总；若需要 raw 事件级分析，需要用户另行提供或确认原始事实 topic 配置，并继续按只读排障方式运行。

### 任务：核对详情候选人去重 key 是否稳定

- 时间：2026-05-19 18:00
- 执行者：AI
- 状态：已完成
- 目标：用户补充当事人常在详情内点击“下一个”，详情容器不关闭但候选人切换；需要解释高重复率，并说明此前按什么去重，检查去重 key 是否可能把不同候选人误归为同一候选人。
- 当前理解：此前 raw 计算使用 `candidateId` 优先，其次 `stableId`、`exposureKey` 的候选人 key；如果详情内“下一个”导致插件沿用旧卡片/旧候选人身份，可能会把真实不同候选人算成重复，造成重复率过高。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改运行时代码、SQL 或云端配置
  - 不修改 `analysis-system/` 之外文件
  - 不打印候选人姓名、简历正文、聊天正文、联系方式或完整 URL 参数
- 验证计划：只读 raw detail opened，统计候选人 key 来源、同一 key 下 profile 指纹/detailProfile 指纹数量、exposure/link 数量和 detectedBy 分布，判断重复率是实际同人多次打开还是 key 被复用/误连。
- 下一步：若要继续修复，优先在插件端提升详情内“下一个”的身份识别和 opened 幂等；分析侧把 `candidateId(text_fingerprint)` 标注为低置信去重口径。

#### 阶段记录：完成去重 key 稳定性核对

- 时间：2026-05-19 18:04
- 状态：已完成
- 已完成：只读 raw detail opened，核对此前去重 key 和 profile 哈希稳定性。此前去重优先使用 `payload.candidate.candidateId`，其次才是 `stableId`、`exposureKey`；本次数据 372 条全部命中 `candidateId`，但 `stableIdSource` 全部是 `text_fingerprint`，不是 BOSS 原生稳定 ID。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证结果：按此前 candidateId 去重，当日候选人为 96，分钟候选人求和为 253；按不输出明文的 profile-with-name 哈希口径，当日为 116，分钟求和为 269。未发现同一 candidateId 下出现多个 displayName 哈希，但有 16 个 candidateId 下 profile 结构哈希变化，说明 candidateId 口径可能低估真实候选人，但主因仍是 poll/canvas 路径在详情容器内多次上报 opened。
- 风险/阻塞：profile 哈希只用于排障估算，不能直接作为生产身份字段；需要插件端拿到更稳定的候选人 ID 或在详情内切换时建立明确 switch/close 语义。
- 中断续写入口：修复方向是：同一详情容器内 candidate key/profile fingerprint 未变化时不重复发 opened；candidate key/profile fingerprint 变化时先结束上一详情会话再发下一条 opened；并在日志质量里标记 `stableIdSource=text_fingerprint` 的详情去重低置信。

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
### 任务：排查打招呼统计翻倍

- 时间：2026-05-20 13:05
- 执行者：AI
- 状态：已完成
- 目标：排查用户提供的 profile 导出中，操作员实际打了 7 个招呼但统计显示 14 个的原因。
- 当前理解：本次是分析系统/统计口径排查任务，需要先基于离线导出 JSON 定位 14 的来源，再检查统计实现是否重复计数、混用了发送事件和状态事件，或把同一候选人的多条事实事件叠加。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - 如确认代码缺陷，可能修改 `src/boss_analysis/` 下相关统计逻辑和对应 `tests/`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改父项目日志契约 `../docs/modules/12-log-specification.md`
  - 不连接真实 CLS、不读取插件运行时、不引入生产 SearchLog 路径
- 验证计划：检查导出 JSON 中事件类型、事件 ID、候选人维度和时间线；阅读统计相关源码与测试；如修改代码，运行相关测试或 `pytest`。
- 当前状态：已阅读最新工作日志、`git status --short` 和 `AGENTS.md`；下一步读取 README、边界、overview、相关模块文档、日志契约、源码和 profile 样本。

#### 阶段记录：定位翻倍高风险来源

- 时间：2026-05-20 13:16
- 状态：实现中
- 已完成：已阅读 README、边界、overview、事实投影、聚合/API、CLS 定时 SQL 文档、日志契约中打招呼事件定义、统计源码和前端展示代码；已检查用户提供的 profile JSON。
- 改动文件：
  - `docs/ai-worklog.md`
- 当前验证结果：profile 中 `runtime.recentEvents` 只保留最近 50 条，其中打招呼为 1 条 `candidate_greeting.clicked` 和 1 条 `candidate_greeting.succeeded`；`productionStats.candidate_greeting.producedCount=137` 是插件模块累计产量，不是本轮 14。分析系统的单人漏斗优先读取 `boss_minute_operator_funnel`，当前直接累加所有分钟汇总行。
- 发现原因：CLS 分钟任务配置为每 1 分钟执行，SQL 时间窗口为 `@m-3m,@m-1m`，窗口会重叠；目标 topic 是追加写而非 upsert。如果同一个 `metric_name + minute + operator_id + job_id` 被连续两次任务写入，当前 query service 会把两条汇总都相加，导致 7 个打招呼显示为 14。
- 中断续写入口：在 `MinuteSummaryRecord` 增加 `recorded_at`，解析 CLS 目标日志写入时间；在 query service 对分钟汇总按稳定键取最新/最高信号一条后再聚合；补充重复 summary 不翻倍的单元测试。

#### 阶段记录：完成分钟汇总去重修复

- 时间：2026-05-20 13:27
- 状态：已完成
- 已完成：已在分钟汇总模型中保留 `recorded_at`，解析 `calculated_at`、`recorded_at` 或 CLS `__TIMESTAMP__`；单人统计从分钟汇总生成漏斗和分钟趋势前，先按 `metric_name + minute + operator_id + raw_operator_id + job_id` 折叠重复快照，有写入时间时取最新，没有写入时间时取信号计数更完整的一条；补充重叠窗口重复 summary 不翻倍的单元测试；同步更新聚合/API 模块文档。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `src/boss_analysis/domain/summary.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/api/query_service.py`
  - `tests/test_query_service.py`
  - `tests/test_summary_reader.py`
- 验证结果：`pytest tests/test_query_service.py tests/test_summary_reader.py` 失败，因为本机未安装 pytest；`python3 -m pytest ...` 同样缺 pytest 模块；已改用 `PYTHONPATH=src python3 -m unittest tests.test_query_service tests.test_summary_reader`，29 tests 通过；`PYTHONPATH=src python3 -m unittest discover -s tests`，107 tests 通过。
- 风险/阻塞：用户提供的 profile 只含最近 50 条事件和模块累计统计，无法单独还原“7 个招呼”的完整原始事件明细；本次修复针对已确认的汇总 topic 重叠窗口追加写翻倍风险。若线上仍显示异常，需要再用当天分钟汇总 topic 中该操作员的重复 key 行做只读核对。
- 中断续写入口：如继续核对线上数据，读取 `boss_summary_minute_prod` 中目标操作员当天 `boss_minute_operator_funnel` 记录，按 `metric_name + minute + operator_id + job_id` 分组查看是否同一 key 出现 2 条或多条。
### 任务：修正前端主漏斗打招呼展示口径

- 时间：2026-05-20 14:05
- 执行者：AI
- 状态：已完成
- 目标：用户重新启动后仍看到“打招呼 15”，需要把分析系统前端主漏斗的“打招呼”从点击次数改为更符合业务理解的成功招呼次数。
- 当前理解：分析系统后端同时保留 `greeting_clicked` 和 `greeting_succeeded`。当前前端主漏斗 `FunnelCell label="打招呼"` 使用的是点击数，容易被理解为 BOSS 实际打招呼成功数；应将主漏斗显示改为成功数，并把点击数保留在详细指标中用于排查。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `frontend/src/App.tsx`
  - 可能同步 `src/boss_analysis/dev_server.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改 CLS SQL
  - 不修改插件事件生成逻辑和日志契约
- 验证计划：检索前端所有 `greeting_clicked` 展示点；修改主漏斗和趋势标签；运行分析系统单元测试，并尽量运行前端 build。
- 当前状态：准备修改前端展示口径。

#### 完成记录：主漏斗改为成功招呼口径

- 时间：2026-05-20 14:10
- 状态：已完成
- 已完成：前端单人主漏斗将“打招呼”卡片改为“招呼成功”，数值使用 `greeting_succeeded`；分钟趋势线也从 `greeting_clicked` 改为 `greeting_succeeded` 并标为“招呼成功”；详细条形指标中仍保留“打招呼点击”和“打招呼成功”两个数用于排查点击重复和成功确认差异；同步更新旧 dev server 内嵌页面的主漏斗口径。
- 改动文件：
  - `docs/ai-worklog.md`
  - `frontend/src/App.tsx`
  - `src/boss_analysis/dev_server.py`
- 验证结果：`PYTHONPATH=src python3 -m unittest discover -s tests` 通过，107 tests；`npm --prefix frontend run build` 通过。
- 风险/阻塞：后端仍保留 click/success 两个事实计数；如果用户仍在“打招呼点击”明细里看到 15，那表示点击事实确实有 15，需要进一步查原始点击事件是否重复触发或是否跨时间窗/岗位累计。
- 中断续写入口：若需要继续查“点击 15”的来源，按 raw `candidate_greeting.clicked` 事件 ID、candidate key、occurred_at、job_id 分组确认是否是重复点击、跨岗位累计或采集侧重复上报。

### 任务：增加单人明细统计起点过滤

- 时间：2026-05-20 14:24
- 执行者：AI
- 状态：已完成
- 目标：用户仍看到招呼成功 13，需要区分“今日全量”和“本轮/指定起点后”的统计口径，让单人明细可以按统计起点过滤。
- 当前理解：本地 API 当前按当天最新本地日期汇总，`zhouxinyu` 今日全量招呼成功为 13；按 2026-05-20 12:00 后过滤时为 7。系统没有 run_id，因此不应把 12:00 之类业务假设硬编码为默认口径，应提供明确的时间起点过滤。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/api/query_service.py`
  - `src/boss_analysis/dev_server.py`
  - `frontend/src/api.ts`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `tests/test_query_service.py`
  - 可能补充 `tests/test_dev_server.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改 CLS SQL 或云端配置
  - 不修改插件事件采集逻辑
- 验证计划：补充 query service 时间过滤单测；运行分析系统单元测试；运行前端 build；如可行，用本地 API 只读验证 since 参数。
- 当前状态：已确认问题来源是默认今日全量，准备接入 `since` 查询参数和前端筛选控件。

#### 完成记录：单人明细支持时间范围

- 时间：2026-05-20 14:44
- 状态：已完成
- 已完成：单人明细后端查询支持 `since` 和 `until` 时间范围；本地 dev server 将查询参数解析为 Asia/Shanghai 本地时间；前端单人明细增加“统计起点/统计终点”控件，并提供“今天 12:00”“截至现在”“今日全量”快捷按钮；测试覆盖 summary 时间过滤和 dev app 参数透传。
- 改动文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/api/query_service.py`
  - `src/boss_analysis/dev_server.py`
  - `frontend/src/api.ts`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `tests/test_query_service.py`
  - `tests/test_dev_server.py`
- 验证结果：`PYTHONPATH=src python3 -m unittest discover -s tests` 通过，110 tests；`npm --prefix frontend run build` 通过；`git diff --check -- ...` 通过。已重启本地 8765 后端；只读调用 `/api/operator/zhouxinyu` 时实时今日全量已变为招呼成功 17、点击 26，调用 `since=2026-05-20T12:00&until=2026-05-20T15:13` 返回招呼成功 7、点击 9。
- 风险/阻塞：当前系统仍没有 run_id，只能用明确时间范围切分某一轮操作；如果希望自动识别“本轮”，需要采集侧或自动化侧上报运行开始/结束事实，不能在分析侧硬编码时间。
- 中断续写入口：若用户希望默认显示本轮，下一步应先定义 run/session 边界事件，再在前端提供运行维度选择，而不是继续用固定时间假设。

### 任务：撤回时间窗口改动并继续排查今日全量异常

- 时间：2026-05-20 14:49
- 执行者：AI
- 状态：实现中
- 目标：用户明确指出不要用时间窗口让数据对上，需要回到“今天全量”口径，继续排查今日招呼统计与实际操作不一致的根因。
- 当前理解：刚才新增的时间范围筛选属于错误方向，应撤回前端/API 时间窗口能力；保留已经确认有价值的分钟汇总去重和主漏斗成功口径，再从今日全量数据本身查是否仍存在汇总重复、采集侧重复上报、点击/成功语义误读或跨账号/岗位混算。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `frontend/src/App.tsx`
  - `frontend/src/api.ts`
  - `frontend/src/styles.css`
  - `src/boss_analysis/api/query_service.py`
  - `src/boss_analysis/dev_server.py`
  - `tests/test_query_service.py`
  - `tests/test_dev_server.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改 CLS SQL 或云端资源
  - 不修改插件采集代码，除非后续明确定位为采集侧缺陷
- 验证计划：撤回时间窗口相关代码后运行单元测试和前端 build；只读分析今日全量分钟汇总，按操作员、分钟、职位和写入快照分组查多计来源。
- 当前状态：准备先撤回时间窗口 UI/API，再继续定位今日全量异常。

#### 阶段记录：时间窗口已撤回并定位到采集侧过报

- 时间：2026-05-20 15:06
- 状态：已完成
- 已完成：撤回单人明细 `since/until` API、前端时间控件和相关测试，恢复只看当天全量的产品口径；保留分钟汇总重复快照去重和主漏斗“招呼成功”展示口径。通过本地排障只读 raw CLS 检索确认：2026-05-20 `zhouxinyu` 的 raw 里已有多条 `candidate_greeting.clicked/succeeded`，且同一候选人哈希存在重复 click/success，说明分析系统展示的是已写入的事实事件，不是前端时间窗口导致。
- 改动文件：
  - `docs/ai-worklog.md`
  - `frontend/src/App.tsx`
  - `frontend/src/api.ts`
  - `frontend/src/styles.css`
  - `src/boss_analysis/api/query_service.py`
  - `src/boss_analysis/dev_server.py`
  - `tests/test_query_service.py`
  - `tests/test_dev_server.py`
- 验证结果：`PYTHONPATH=src python3 -m unittest discover -s tests` 通过，107 tests；`npm --prefix frontend run build` 通过；`git diff --check -- ...` 通过；确认代码中不再存在 `operatorSince`、`operatorUntil`、`OperatorTimeFilter`、`_parse_query_datetime` 等时间窗口实现。
- 发现原因：采集侧 `greeting-probe` 会把“已打招呼”等包含“打招呼”的状态文本识别为新的打招呼动作，导致用户点到已发送状态时仍产生新的 clicked/succeeded 事实事件。该缺陷已转到父项目插件修复。
- 风险/阻塞：2026-05-20 已写入 CLS 的历史脏事件缺少 actionText 字段，无法可靠回溯区分真实点击和“已打招呼”状态误记；修复插件后只能保证后续不再新增这类误记，历史当天数据若要校正需要另行人工指定剔除规则或重算来源。
- 中断续写入口：后续检查父项目 `extension/src/content/greeting-probe.js` 和 `test/greeting-probe.test.js` 的状态文本排除规则；如需历史修正，先不要写自动规则，需用户确认可接受的剔除口径。

### 任务：排查小图图 operator_id 前台无数据

- 时间：2026-05-23 13:03
- 执行者：AI
- 状态：排查中
- 目标：排查用户反馈“小图图”这个 `operator_id` 在 CLS 中有数据，但分析系统前台拉不到的原因。
- 当前理解：分析系统本地前台默认从分钟汇总 topic 读取当天全量数据，且操作员展示依赖本地 `config/operators.local.json` 与汇总里的 `operator_id` 精确匹配；需要确认问题发生在操作员配置、summary 读取窗口、任务名/字段解析、API 过滤或前端展示层。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - 视排查结果可能修改 `src/boss_analysis/consumer/summary_reader.py`
  - 视排查结果可能修改 `src/boss_analysis/api/query_service.py`
  - 视排查结果可能修改前端相关文件
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改 CLS SQL、云端资源或生产配置
  - 不读取或依赖插件 debug 页、Chrome storage、DOM 规则
- 验证计划：阅读相关设计与代码；查看本地配置和 API 行为；如有真实 CLS 配置，仅以本地开发/排障目的只读检查 summary 数据；根据定位结果运行相关单元测试和前端 build。
- 当前状态：已读取最新工作日志、README 和边界说明，准备继续阅读 overview、相关模块文档和 summary/API 代码。

#### 完成记录：定位并修复中文 operator_id URL 解码问题

- 时间：2026-05-23 13:18
- 状态：已完成，待用户确认是否允许重启真实数据 dev server
- 已完成：确认 `config/operators.local.json` 已配置 `operatorId: "小图图"`，summary/API 层按字符串精确匹配没有特殊排除中文；根因是 React 前端请求 `/api/operator/${encodeURIComponent(operatorId)}` 后，本地后端直接使用 URL path 末段，未对 `%E5%B0%8F%E5%9B%BE%E5%9B%BE` 做 `unquote`，导致查询服务收到编码字符串而不是 `小图图`，所以单人详情匹配不到 CLS 汇总数据。
- 改动文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/dev_server.py`
  - `tests/test_dev_server.py`
- 验证结果：`PYTHONPATH=src python3 -m unittest tests.test_dev_server tests.test_query_service tests.test_summary_reader` 通过，40 tests；`PYTHONPATH=src python3 -m unittest discover -s tests` 通过，108 tests；`npm --prefix frontend run build` 通过；`git diff --check -- src/boss_analysis/dev_server.py tests/test_dev_server.py docs/ai-worklog.md` 通过。
- 风险/阻塞：尝试重启本地真实数据 dev server 时，沙箱内因网络/端口权限失败；再次以提权方式启动被审批器拒绝，因为会只读访问已配置的真实 CLS 汇总 topic，当前用户尚未明确授权本轮真实云资源访问。需要用户明确允许后，再运行 `./dev.sh` 重启并用真实数据验证 `/api/operator/%E5%B0%8F%E5%9B%BE%E5%9B%BE`。
- 中断续写入口：获得用户明确授权后，从 `analysis-system/` 运行 `./dev.sh`，再访问 `http://127.0.0.1:5173/` 或后端 `/api/operator/%E5%B0%8F%E5%9B%BE%E5%9B%BE` 验证前台详情数据。

### 任务：排查活跃列表职位全是未关联职位

- 时间：2026-05-23 14:09
- 执行者：AI
- 状态：排查中
- 目标：排查用户反馈当前前台活跃操作员的职位全部显示“未关联职位”的原因。
- 当前理解：前端“未关联职位”来自 dashboard API 的 `active_operators[].job_id` 为空；需要确认是 CLS 分钟汇总没有 `job_id`、summary reader 解析丢失、dashboard 最后活跃动作选择逻辑覆盖了岗位，还是前端展示层误用字段。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - 视排查结果可能修改 `src/boss_analysis/api/query_service.py`
  - 视排查结果可能补充 `tests/test_query_service.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改 CLS SQL、云端资源或生产配置
  - 不读取或依赖插件 debug 页、Chrome storage、DOM 规则
- 验证计划：用本地构造 summary 复现 dashboard `job_id` 为空；若定位为代码问题，补单测并运行相关 Python 测试和前端 build。
- 当前状态：已查看最新工作日志、当前 diff 和 `job_id` 展示/查询链路，准备复现 dashboard 选择逻辑。

#### 完成记录：修复日级活跃覆盖分钟岗位的问题

- 时间：2026-05-23 14:18
- 状态：已完成
- 已完成：用本地最小样本复现 dashboard 活跃列表显示“未关联职位”：同一操作员同时有 `boss_daily_operator_active_duration` 和最新分钟汇总时，日级记录先进入 `latest_by_operator`，且 `last_active_minute` 与分钟汇总相同；旧逻辑只在候选记录时间更大时替换，所以带 `job_id` 的分钟汇总无法覆盖无岗位维度的日级记录。已调整 dashboard 活动选择逻辑：时间相同时，优先使用非日级活跃记录，并用带 `job_id` 的记录补齐岗位；日级活跃时长仍保留用于时长展示和没有分钟数据时的活跃兜底。
- 改动文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/api/query_service.py`
  - `tests/test_query_service.py`
- 验证结果：本地复现脚本修复前输出 `boss_daily_operator_active_duration None`，修复后输出 `boss_minute_operator_funnel job_from_minute`；`PYTHONPATH=src python3 -m unittest tests.test_query_service tests.test_summary_reader tests.test_dev_server` 通过，41 tests；`PYTHONPATH=src python3 -m unittest discover -s tests` 通过，109 tests；`npm --prefix frontend run build` 通过；`git diff --check -- docs/ai-worklog.md src/boss_analysis/api/query_service.py src/boss_analysis/dev_server.py tests/test_query_service.py tests/test_dev_server.py` 通过。
- 风险/阻塞：本轮未重启真实数据 dev server，也未访问真实 CLS；如果线上 summary 本身的 `job_id` 字段全部是 `<missing>`，前台仍会显示“未关联职位”，那就需要在获得用户明确授权后只读检查 `boss_summary_minute_prod` 中 `job_id` 分布和原始事实 topic 索引/字段。
- 中断续写入口：如用户授权真实云只读验证，重启 `./dev.sh` 后检查 `/api/dashboard` 的 `active_operators[].job_id`；若仍为空，读取分钟汇总中 `metric_name + operator_id + minute + job_id` 分布确认是否源数据缺岗位。

### 任务：给职位 ID 增加名称关联展示

- 时间：2026-05-23 14:48
- 执行者：AI
- 状态：实现中
- 目标：回应用户希望当前前台职位不要只显示 ID，而是能关联显示职位名称。
- 当前理解：日志契约当前只采集 `jobId/jobStatus`，明确不包含职位名称或职位描述正文；分析系统不能从现有 summary 自动还原名称。可行方案是在分析系统本地维护 `job_id -> display_name` 展示配置，API 返回 `job_name`，前端优先显示名称并保留 ID 作为次级信息。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/metrics.py`
  - 新增或修改岗位配置读取模块
  - `src/boss_analysis/api/query_service.py`
  - `src/boss_analysis/dev_server.py`
  - `frontend/src/types.ts`
  - `frontend/src/App.tsx`
  - `tests/` 中相关测试
  - 可能新增 `config/jobs.example.json`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改日志契约、插件采集、CLS SQL 或真实云资源
- 不把职位名称写成事实字段或分析结论
- 验证计划：补充配置解析和 dashboard job name 单测；运行相关 Python 测试、全量单元测试、前端 build 和 diff check。
- 当前状态：已确认日志契约无职位名称字段，准备实现本地岗位展示配置。

#### 完成记录：本地岗位名称映射已接入前台

- 时间：2026-05-23 15:01
- 状态：已完成
- 已完成：新增 `JobProfile` 和 `JobConfigProvider`，支持读取 `config/jobs.local.json` 或 `BOSS_ANALYSIS_JOB_CONFIG_FILE` 中的 `jobId -> displayName` 展示映射；dev server 构建 query service 时注入岗位配置；dashboard API 的活跃操作员行新增 `job_name`；React 前端活跃列表优先显示职位名称，没有映射时继续显示原始 `job_id`；补充 `config/jobs.example.json` 和 README 使用说明；`dev.sh` 已传入默认岗位配置路径。
- 改动文件：
  - `.gitignore`
  - `README.md`
  - `dev.sh`
  - `docs/ai-worklog.md`
  - `config/jobs.example.json`
  - `frontend/src/App.tsx`
  - `frontend/src/types.ts`
  - `src/boss_analysis/domain/jobs.py`
  - `src/boss_analysis/job_config.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/domain/metrics.py`
  - `src/boss_analysis/api/query_service.py`
  - `src/boss_analysis/dev_server.py`
  - `tests/test_job_config.py`
  - `tests/test_query_service.py`
- 验证结果：`PYTHONPATH=src python3 -m unittest tests.test_job_config tests.test_query_service tests.test_dev_server` 通过，34 tests；`PYTHONPATH=src python3 -m unittest discover -s tests` 通过，113 tests；`npm --prefix frontend run build` 通过；`git diff --check -- .` 通过。
- 风险/阻塞：现有日志和分钟汇总不包含职位名称，必须人工或后续后台能力维护映射；未配置映射的 `job_id` 会继续显示 ID，避免错误猜测。若希望自动采集职位名称，需要先改日志契约和插件采集范围，再更新 CLS SQL/分析系统。
- 中断续写入口：把真实岗位映射写入 git ignore 的 `config/jobs.local.json` 后刷新页面；如果页面仍显示 ID，检查 `/api/dashboard` 的对应 `active_operators[].job_name` 是否为空。

### 任务：撤回本地岗位映射并改用线上上报字段

- 时间：2026-05-23 14:53
- 执行者：AI
- 状态：实现中
- 目标：按用户要求撤回本地维护岗位名称的方案，改为只使用线上日志或汇总中上报的岗位名称字段。
- 当前理解：日志契约当前明确只有 `jobId/jobStatus`，没有职位名称；但如果线上实际已经上报 `job_name`、`jobName`、`jobTitle` 等字段，分析系统应直接透传展示。不能用本地 `job_id -> displayName` 映射，也不能猜测职位名。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - 撤回 `.gitignore`、`README.md`、`dev.sh` 中本地岗位配置改动
  - 删除 `config/jobs.example.json`、`src/boss_analysis/domain/jobs.py`、`src/boss_analysis/job_config.py`、`tests/test_job_config.py`
  - 修改 `src/boss_analysis/domain/summary.py`
  - 修改 `src/boss_analysis/consumer/summary_reader.py`
  - 修改 `src/boss_analysis/api/query_service.py`
  - 修改相关测试和前端类型/展示
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改日志契约、插件采集、CLS SQL 或真实云资源
- 不新增任何本地岗位名称映射配置
- 验证计划：补充 summary/raw 线上字段透传测试；运行相关 Python 测试、全量测试、前端 build 和 diff check。
- 当前状态：准备撤回本地配置实现并改成线上字段透传。

#### 完成记录：已改为只透传线上岗位名称字段

- 时间：2026-05-23 15:07
- 状态：已完成
- 已完成：撤回本地岗位映射方案，删除本地岗位配置相关文件和脚本/文档改动；`MinuteSummaryRecord` 支持 `job_name`；summary reader 会解析线上汇总中的 `job_name/jobName/job_title/jobTitle/position_name/positionName`；dashboard 最近活动会携带线上 `job_name`，并在同一时间优先保留带 `job_name` 的记录；raw 事件路径会从根字段、`context_json.jobContext` 或 `payload_json` 中提取同类岗位名称字段；前端继续优先显示 `job_name`，否则回退 `job_id`。
- 改动文件：
  - `docs/ai-worklog.md`
  - `frontend/src/App.tsx`
  - `frontend/src/types.ts`
  - `src/boss_analysis/api/query_service.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/dev_server.py`
  - `src/boss_analysis/domain/metrics.py`
  - `src/boss_analysis/domain/summary.py`
  - `tests/test_query_service.py`
  - `tests/test_summary_reader.py`
- 验证结果：`PYTHONPATH=src python3 -m unittest tests.test_query_service tests.test_summary_reader tests.test_dev_server` 通过，43 tests；`PYTHONPATH=src python3 -m unittest discover -s tests` 通过，111 tests；`npm --prefix frontend run build` 通过；`git diff --check -- .` 通过。
- 风险/阻塞：本轮未访问真实 CLS。按当前日志契约，正式字段只有 `job_id/job_status`，没有职位名称；如果线上 summary/raw 没有额外上报上述名称字段，前端仍只能显示 ID。要完全“直接用线上上报数据”显示名称，需要上游插件和 CLS 定时 SQL 把岗位名称字段写入 raw/summary。
- 中断续写入口：若用户授权真实云只读验证，检查 `boss_summary_minute_prod` 或 raw topic 中是否存在 `job_name/jobName/jobTitle/positionName`；如果不存在，下一步应改插件日志契约和 CLS 汇总 SQL，而不是分析侧本地维护。

### 任务：分钟汇总 SQL 模板透传职位名称

- 时间：2026-05-23 16:15
- 执行者：AI
- 状态：实现中
- 目标：配合上游插件新增 `job_name` raw 扁平字段，更新 CLS 定时 SQL 文档模板，让 `boss_minute_operator_funnel` 和 `boss_minute_chat` 输出职位名称，避免前台只能显示 `job_id`。
- 当前理解：分析系统代码已经兼容 summary/raw 中的 `job_name` 等字段；本次只修改分析系统内的 SQL/汇总契约文档，不改 Python/前端代码，不访问真实 CLS，不维护本地 `job_id -> 职位名称` 映射。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/boundary.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改分析系统运行代码或测试代码
  - 不修改真实 CLS SQL 任务或云端资源
  - 不新增本地岗位名称映射
- 验证计划：仅做文档模板修改；运行 `git diff --check -- docs/ai-worklog.md docs/boundary.md docs/modules/04-aggregation-query-api.md docs/modules/07-cls-scheduled-sql-tasks.md`。
- 当前状态：已按子项目规范读取最新工作日志、README、boundary、overview、汇总 API 文档、定时 SQL 文档和根日志契约，准备更新 SQL 文档模板。

#### 完成记录：SQL 模板已增加 job_name

- 时间：2026-05-23 16:15
- 状态：已完成
- 时间补正：本条最初误写为 `2026-05-23 16:22`，与本机实际时间不符；已按 `date` 输出校正。
- 已完成：在分析系统边界文档中把 `job_name` 加入 CLS raw 扁平字段；更新汇总 API 文档，明确 `boss_minute_operator_funnel` 和 `boss_minute_chat` 的关键字段包含 `job_name`，重复快照折叠键包含 `job_name`；更新 CLS 定时 SQL 文档模板，raw 与 summary 索引建议增加 `job_name`，两个分钟任务均从 raw `job_name` 或 `context_json.jobContext.jobName` 取职位名，输出 `job_name` 并按 `minute + operator_id + job_id + job_name` 分组。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/boundary.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
- 验证结果：`git diff --check -- analysis-system/docs/ai-worklog.md analysis-system/docs/boundary.md analysis-system/docs/modules/04-aggregation-query-api.md analysis-system/docs/modules/07-cls-scheduled-sql-tasks.md` 通过。
- 风险/阻塞：本次只更新文档模板，未访问或修改真实 CLS 定时 SQL 任务；线上需要按模板更新云端任务后，`boss_summary_minute_prod` 才会实际产生 `job_name`。
- 中断续写入口：如果继续上线云端 SQL，需要由用户明确授权真实 CLS 控制台/云资源操作；否则只把本文档中的两个 SQL 模板复制到 CLS 定时任务配置中。

### 任务：分钟汇总同分钟多职位取最后职位名

- 时间：2026-05-23 17:18
- 执行者：AI
- 状态：实现中
- 目标：按用户确认的口径调整分钟级职位名称聚合：同一操作员同一分钟如果操作了多个 `jobName`，分钟汇总只保留最后一次上报的职位名称。
- 当前理解：当前 SQL 文档模板把 `job_name` 加入 `group by minute, operator_id, job_id, job_name`，这会在同一分钟多职位名时产出多条岗位维度行；用户现在希望分钟级只取最后一个 `jobName`，因此应调整 CLS 定时 SQL 模板和查询侧去重键，必要时在本地查询兼容多条 summary 快照时选择最后职位名。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
  - `src/boss_analysis/api/query_service.py`
  - `tests/test_query_service.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实 CLS 定时任务或云资源
  - 不新增本地岗位名称映射
  - 不读取插件 debug 页、Chrome storage 或 BOSS DOM
- 验证计划：补充同一分钟多 `jobName` 的本地单测；运行相关 Python 测试、全量测试、前端 build 和 diff check。
- 当前状态：已查看最新工作日志、当前 diff、README、边界/总览、聚合 API 文档、CLS SQL 模板和根日志契约，准备修改 SQL 模板与查询折叠口径。

#### 阶段记录：已调整分钟职位口径

- 时间：2026-05-23 17:21
- 状态：待验证
- 已完成：更新聚合 API 文档和 CLS 定时 SQL 模板，明确分钟汇总不按 `job_id/job_name` 拆行，同一 `operator_id + minute` 内多个职位时用 `max_by(job_id/job_name, event_at)` 取 `__TIMESTAMP__` 最大的事件上下文；更新查询侧分钟 summary 折叠键为 `metric_name + minute + operator_id + raw_operator_id`，dashboard 读取折叠后的分钟记录，避免重复快照或多职位行影响前台职位展示；新增同一分钟多职位快照时取最新职位上下文的单测。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
  - `src/boss_analysis/api/query_service.py`
  - `tests/test_query_service.py`
- 当前验证结果：尚未运行。
- 中断续写入口：运行 `PYTHONPATH=src python3 -m unittest tests.test_query_service tests.test_summary_reader tests.test_dev_server`，再运行全量测试、前端 build 和 `git diff --check -- .`。

#### 完成记录：分钟多职位取最后职位名已完成

- 时间：2026-05-23 17:22
- 状态：已完成
- 已完成：按新口径更新分钟汇总链路。CLS SQL 模板不再按 `job_id/job_name` 分组，而是在 `minute + operator_id` 粒度汇总整分钟计数，并用 `max_by(job_id, event_at)`、`max_by(job_name, event_at)` 取该分钟最后一次上报的职位上下文；SQL 输入同时兼容 raw 扁平 `job_name` 和插件 camelCase `jobName`，目标汇总统一输出 `job_name`；查询侧按 `metric_name + minute + operator_id + raw_operator_id` 折叠追加型 summary 快照，dashboard 读取折叠后的分钟记录；新增同一分钟多职位快照取最新岗位的回归测试。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/boundary.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
  - `src/boss_analysis/api/query_service.py`
  - `tests/test_query_service.py`
- 验证结果：`PYTHONPATH=src python3 -m unittest tests.test_query_service tests.test_summary_reader tests.test_dev_server` 通过，44 tests；`PYTHONPATH=src python3 -m unittest discover -s tests` 通过，112 tests；`npm --prefix frontend run build` 通过；`git diff --check -- .` 通过。
- 风险/阻塞：本次仍只修改本地分析系统代码和 SQL 文档模板，未修改真实 CLS 定时 SQL 任务；线上 `boss_summary_minute_prod` 需要按新模板更新后，前台才会稳定拿到分钟内最后职位名。
- 中断续写入口：若要上线，复制 `docs/modules/07-cls-scheduled-sql-tasks.md` 中 `boss_minute_operator_funnel` 和 `boss_minute_chat` 的最新 SQL 到 CLS 定时任务；如需我直接操作云端，需用户明确授权真实 CLS 资源修改。

#### 阶段记录：补充 SQL 发送前字段引用校正

- 时间：2026-05-23 17:26
- 状态：已完成
- 已完成：用户要求输出具体 SQL 前，复核插件上报字段为 camelCase `jobName`；为避免 SQL 引擎把大小写字段名规整成小写，将 SQL 模板中的兼容字段引用从 `jobName` 改为 `"jobName"`，目标汇总字段仍统一输出 `job_name`。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
- 当前验证结果：`git diff --check -- .` 通过。
- 中断续写入口：直接把最新 SQL 复制给用户或更新到 CLS 定时 SQL；若 CLS 控制台不接受双引号字段名，再改回控制台实际支持的字段引用形式。

### 任务：排查最新数据前台仍未显示 jobName

- 时间：2026-05-23 17:37
- 执行者：AI
- 状态：排查中
- 目标：排查用户反馈最新数据已经上来后，前台界面仍没有显示 `jobName` 的原因，确认是否取错字段。
- 当前理解：前台展示读取 dashboard API 的 `active_operators[].job_name`；分析系统代码已兼容 summary 中的 `job_name/jobName`，但上一版能成功执行的 CLS SQL 只从 `context_json.jobContext.jobName` 取值。如果插件实际把职位名称上报到 raw 顶层 `jobName`，且源 topic 尚未为 `jobName` 建可分析索引，那么分钟汇总可能仍输出空 `job_name`，前台自然不会显示名称。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - 视排查结果可能修改 `docs/modules/07-cls-scheduled-sql-tasks.md`
  - 视排查结果可能补充 `tests/test_summary_reader.py` 或 `tests/test_query_service.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不读取或修改真实 CLS，除非用户明确授权本轮真实云只读排查
  - 不新增本地岗位名称映射
- 验证计划：先静态检查前端字段、API 序列化、summary reader 和 SQL 模板；如需要确认最新真实数据字段分布，再请求用户明确授权只读访问 CLS 或由用户贴一条 summary/raw 样本。
- 当前状态：已查看最新工作日志、当前 diff 和本机时间，准备检查相关代码路径。

#### 阶段记录：静态链路确认前台读取 job_name

- 时间：2026-05-23 17:42
- 状态：需要真实数据验证
- 已完成：静态检查前端 `OperatorRow`、内联 dev server 页面、dashboard API 序列化、query service 和 summary reader，确认前台展示读取的是 API 的 `active_operators[].job_name`，后端会从 summary 的 `job_name/jobName` 解析并透传；因此界面没有显示名称不太像前端字段名错误，更可能是 `boss_summary_minute_prod` 中对应行的 `job_name` 为空，或日级活跃记录覆盖了尚未加载到的分钟岗位上下文。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
- 当前验证结果：尝试只读请求本地 `/api/dashboard` 被审批器拒绝，因为该 dev server 以 summary 模式运行，请求会触发真实 CLS 读取，而本轮用户尚未明确授权真实云资源访问；已按更安全方式停止，不绕行。
- 发现/判断：用户之前执行 SQL 报 `Column 'jobName' cannot be resolved`，说明源 topic 顶层 `jobName` 当前不是可 SQL 引用字段。已把文档模板回退为只从 `context_json.jobContext.jobName` 提取，避免给出会编译失败的 SQL；如果最新插件只把职位名放在顶层 `jobName`，而没有写进 `context_json.jobContext.jobName` 或没有为顶层 `jobName` 建索引，那么分钟汇总仍会输出空 `job_name`。
- 中断续写入口：需要用户明确授权本轮只读 CLS 排查后，请求 `/api/dashboard` 或读取 summary 样本，检查 `active_operators[].job_name`、summary 行的 `job_name`、raw 行的 `context_json.jobContext.jobName` 和顶层 `jobName` 分布。

### 任务：查看昨日 daily 级别统计数据

- 时间：2026-05-24 14:47
- 执行者：AI
- 状态：排查中
- 目标：按用户要求查看昨日（Asia/Shanghai 自然日 2026-05-23）的 daily 级别统计数据，并汇总可读结果。
- 当前理解：本轮是只读数据核对；优先读取已配置的日级 summary/指标输出，必要时用开发排障方式读取 CLS 定时 SQL 目标 topic，不修改真实 CLS 任务、云资源或生产链路。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实 CLS 定时 SQL 任务或云资源
  - 不读取插件 debug 页、Chrome storage 或 BOSS DOM
  - 不把 CLS SearchLog 接入生产链路
- 验证计划：检查本地配置与 reader 能力；只读读取昨日 daily summary 数据，若没有日级数据则说明缺口并酌情检查分钟 summary 兜底可用性。
- 当前状态：已查看最新工作日志、`git status --short` 和 README，准备读取日级 summary 配置并执行只读查询。

#### 完成记录：昨日 daily 数据只读核对

- 时间：2026-05-24 14:49
- 状态：已完成
- 已完成：用本地 `.env.local` 中已配置的日级 summary 入口只读查询最近 48 小时，并筛选 `active_date=2026-05-23`；配置的日级 topic 返回 0 行。随后只读读取分钟汇总 topic 最近 48 小时，按 Asia/Shanghai 自然日筛选 2026-05-23，并在本地按 `operator_id + minute` 去重 rollup 出昨日 daily 近似口径。
- 改动文件：
  - `docs/ai-worklog.md`
- 当前验证结果：日级 topic：`raw_rows_returned=0`、`yesterday_rows_returned=0`；分钟汇总兜底：原始返回 301 行，昨日过滤 127 行，去重后 104 行，其中 `boss_minute_operator_funnel=93`、`boss_minute_chat=11`，操作员 2 个，合计活跃 93 分钟、卡片曝光 1112、详情打开 208、打招呼点击 39、打招呼成功 25、聊天打开 30、聊天快照 42、微信获取 0。
- 风险/阻塞：本次展示的是分钟汇总 rollup 的 daily 口径，不是新建 raw CLS 日级任务的直接输出；配置的日级 topic 当前没有可读快照，需确认真实日级任务是否已写入该 topic，或 `.env.local` 的 `CLS_DAILY_SUMMARY_TOPIC_ID` 是否指向了正确目标。
- 中断续写入口：如需继续排查日级任务，先确认 CLS 控制台中新 daily 任务的目标 topic/指标主题，再读取对应 topic 的 `metric_name`、`active_date`、`operator_id` 字段样本。

### 任务：核对 5 个 CLS topic 与本地配置数量

- 时间：2026-05-24 14:55
- 执行者：AI
- 状态：已完成
- 目标：回应用户指出“现在已有 5 个日志 topic，但配置里好像只有 3 个”的疑问，核对当前 `.env*`、文档和代码支持的 topic 配置边界。
- 当前理解：用户新增了日级 raw 基础统计相关 topic 后，真实 CLS topic 数量可能已从原先的原始 + 分钟 + 日级活跃 + 健康，增加为 5 个；当前 analysis-system 只显式读取分钟汇总、日级活跃和日志质量 3 类目标 topic，原始 topic 仅作为 Kafka/生产摄取规划项，新增日级基础统计 topic 尚无专门 reader。
- 已完成：静态查看 `.env.example`、`.env.local` 的 topic 配置键，以及 `docs/modules/07-cls-scheduled-sql-tasks.md` 的 topic 清单；确认当前本地读配置包括 `CLS_SUMMARY_TOPIC_ID`、`CLS_DAILY_SUMMARY_TOPIC_ID`、`CLS_LOG_QUALITY_TOPIC_ID`，另有 `CLS_KAFKA_TOPIC` 作为原始 topic 规划配置但本地 `.env.local` 未填；没有 `boss_daily_operator_basic_stats` 单独 topic 的配置键。
- 改动文件：
  - `docs/ai-worklog.md`
- 当前验证结果：未访问真实 CLS；仅做本地配置和文档静态核对。
- 中断续写入口：如果用户希望第五个 topic 被页面/API 使用，需要先决定是把 `boss_daily_operator_basic_stats` 写入既有 `boss_summary_daily_prod`，还是新增独立配置如 `CLS_DAILY_BASIC_SUMMARY_TOPIC_ID` 并实现 reader/domain/API 展示。

### 任务：新增第五个 CLS topic 配置

- 时间：2026-05-24 14:58
- 执行者：AI
- 状态：已完成
- 目标：按用户要求在分析系统配置中新增第五个 CLS topic 配置，用于已配置好的日级基础统计 topic。
- 当前理解：第五个 topic 对应 raw CLS 日级基础统计任务 `boss_daily_operator_basic_stats` 的独立目标 topic；本轮先补环境变量模板和配置 loader，不改真实 CLS 云资源，不读取或写入生产数据。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `.env.example`
  - `.env.local`
  - `README.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
  - `src/boss_analysis/consumer/cls_search.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `tests/test_cls_search.py`
  - `tests/test_summary_reader.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不访问或修改真实 CLS 任务
  - 不把新 topic 接入生产 SearchLog 链路
  - 不实现业务展示口径扩展，除非配置 loader 需要
- 验证计划：运行相关配置 loader 测试；执行 `git diff --check` 覆盖本轮文件。
- 当前状态：已查看最新工作日志、当前 dirty worktree、`.env.example` 和现有 CLS config loader，准备小步补配置。

#### 完成记录：第五个 topic 配置已补齐

- 时间：2026-05-24 15:02
- 状态：已完成
- 已完成：新增 `CLS_DAILY_BASIC_SUMMARY_*` 配置组，用于独立的 `boss_daily_operator_basic_stats` 日级基础统计 topic；`.env.example` 已补模板，`.env.local` 已补本地配置块；新增 `load_cls_daily_basic_summary_search_config()` 并从 `boss_analysis.consumer` 导出；README 和 CLS 定时 SQL 任务清单已补第五个 topic 的说明。
- 改动文件：
  - `docs/ai-worklog.md`
  - `.env.example`
  - `.env.local`
  - `README.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
  - `src/boss_analysis/consumer/cls_search.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `tests/test_cls_search.py`
  - `tests/test_summary_reader.py`
- 当前验证结果：`PYTHONPATH=src python3 -m unittest tests.test_cls_search tests.test_summary_reader` 通过，23 tests；`git diff --check -- .env.example README.md docs/modules/07-cls-scheduled-sql-tasks.md src/boss_analysis/consumer/cls_search.py src/boss_analysis/consumer/__init__.py tests/test_cls_search.py tests/test_summary_reader.py docs/ai-worklog.md` 通过。
- 风险/阻塞：本轮只补配置和 loader，页面/API 还不会展示 `boss_daily_operator_basic_stats` 指标；后续需要新增 parser/domain/API 映射后才能消费该 topic 的业务字段。
- 中断续写入口：下一步如果要读取第五个 topic 数据，先实现 `boss_daily_operator_basic_stats` 的记录模型与 parser，再在 dev dataset 和 query service 中接入。

### 任务：验证昨日第五个 daily 基础统计 topic 数据

- 时间：2026-05-24 15:05
- 执行者：AI
- 状态：已完成
- 目标：按用户要求验证昨日（Asia/Shanghai 自然日 2026-05-23）的日级统计数据，优先读取新配置的第五个 `boss_daily_operator_basic_stats` topic。
- 当前理解：第五个 topic 已在 `.env.local` 配置；本轮只做只读排障查询，不修改真实 CLS 任务或云资源，不把 SearchLog 接入生产链路。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实 CLS 定时 SQL 任务或云资源
  - 不读取插件 debug 页、Chrome storage 或 BOSS DOM
  - 不实现页面/API 消费逻辑
- 验证计划：用 `CLS_DAILY_BASIC_SUMMARY_*` 配置只读查询最近 48 小时，筛选 `active_date=2026-05-23`，按 `metric_name + active_date + operator_id` 取最新快照并汇总关键指标；如无数据，回报 topic/任务写入缺口。
- 当前状态：已查看最新工作日志、`git status --short` 和第五个 topic 本地配置，准备执行只读查询。

#### 完成记录：第五个 topic 无昨日可检索数据，分钟汇总兜底可用

- 时间：2026-05-24 15:09
- 状态：已完成
- 已完成：使用 `CLS_DAILY_BASIC_SUMMARY_*` 第五个 topic 配置只读查询最近 48 小时并筛选 `active_date=2026-05-23`，返回 0 行；再扩大到最近 7 天查询，仍返回 0 行。随后读取分钟汇总 topic 最近 48 小时，按 Asia/Shanghai 自然日筛选 2026-05-23 并本地去重 rollup，验证昨日统计仍可由分钟汇总兜底得到。
- 改动文件：
  - `docs/ai-worklog.md`
- 当前验证结果：第五个 topic：最近 48 小时 `raw_rows_returned=0`、昨日 `target_date_rows_returned=0`；最近 7 天 `raw_rows_returned=0`。分钟汇总兜底：原始返回 290 行，昨日过滤 127 行，去重后 104 行，其中 `boss_minute_operator_funnel=93`、`boss_minute_chat=11`，操作员 2 个，合计活跃 93 分钟、卡片曝光 1112、详情打开 208、打招呼点击 39、打招呼成功 25、聊天打开 30、聊天快照 42、微信获取 0。
- 风险/阻塞：第五个 topic 的 SearchLog 请求没有报 topic 不存在或权限错误，但没有任何可检索日志；需要在 CLS 控制台确认 `boss_daily_operator_basic_stats` 任务的目标 topic 是否为 `.env.local` 中的第五个 topic、目标 topic 是否开启索引、任务是否已成功写入日志。
- 中断续写入口：如果要继续排查云端任务，先在 CLS 控制台查看 `boss_daily_operator_basic_stats` 最近实例的输入/输出行数和目标主题；若目标 topic 不一致，更新 `CLS_DAILY_BASIC_SUMMARY_TOPIC_ID` 后重试只读查询。

### 任务：排查日级基础统计任务产出 3 条但本地读 0 条

- 时间：2026-05-24 15:12
- 执行者：AI
- 状态：已完成
- 目标：按用户反馈，排查 `boss_daily_operator_basic_stats` 生产任务昨日已产出 3 条但本地第五个 topic 读取为 0 的原因，并查看这 3 条日级产物内容。
- 当前理解：日级统计是严谨回溯口径，不允许用分钟汇总 fallback；本轮只排查日级任务产物和 topic/索引/时间窗口/配置差异，不再用分钟汇总结果替代。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实 CLS 任务、topic 或索引配置
  - 不读取插件 debug 页、Chrome storage 或 BOSS DOM
  - 不用分钟汇总兜底回答日级统计
- 验证计划：只读调用 CLS API 列出可见 topic，确认本地第五个配置指向的 topic 名称；对可疑日级 topic 直接 SearchLog 宽窗口查询，输出聚合产物的字段和值；若 SearchLog 仍为 0，则定位为 topic 配置、目标类型、索引或写入时间差异。
- 当前状态：已查看最新工作日志、`git status --short` 和第五个 topic 配置，准备执行只读 CLS API 排查。

#### 完成记录：按指标 topic 查到 3 条日级基础统计

- 时间：2026-05-24 15:20
- 状态：已完成
- 已完成：确认第五个 topic 是指标 topic，不应使用 `SearchLog`；改用 CLS 指标接口 `GetMetricLabelValues` 和 `QueryRangeMetric` 查询。指标 topic 中存在 `active_minutes`、`total_events`、`card_exposed` 等 metric，`operator_id` 标签有 `shenlingnuo`、`zhouxinyu`、`小图图`。按所有日级基础统计 metric 拼出 3 条记录。
- 改动文件：
  - `docs/ai-worklog.md`
- 当前验证结果：3 条记录的 `active_date` 均为 `2026-05-22`，不是 `2026-05-23`；三条分别为 `shenlingnuo`、`zhouxinyu`、`小图图`。关键值：`shenlingnuo active_minutes=3 total_events=21 card_exposed=4 chat_opened=5 snapshot_captured=6`；`zhouxinyu active_minutes=100 total_events=1656 card_exposed=844 detail_opened=256 greeting_clicked=58 greeting_succeeded=42 chat_opened=19 snapshot_captured=26`；`小图图 active_minutes=56 total_events=1611 card_exposed=1053 detail_opened=146 greeting_clicked=35 greeting_succeeded=22 greeting_failed=1 chat_opened=8 snapshot_captured=7`。
- 风险/阻塞：用户期望“昨天”即 2026-05-23 的日级统计，但指标 topic 当前查到的 3 条 active_date 是 2026-05-22，说明定时 SQL 的时间窗口、输出时间戳或 active_date 计算可能偏到前一天；需要继续检查云端任务调度窗口和 SQL 中 active_date 的生成逻辑。
- 中断续写入口：下一步查看或让用户贴 `boss_daily_operator_basic_stats` 当前 SQL 与调度窗口，重点核对是否使用 `@d-1d,@d`、`@d,@m-1m`、`current_date` 或从 `__TIMESTAMP__`/`occurred_at` 取日期。

### 任务：验证新建任务产出的 2026-05-23 日级基础统计

- 时间：2026-05-24 15:31
- 执行者：AI
- 状态：已完成
- 目标：按用户说明“建完了”，只读查看第五个指标 topic 中 `active_date=2026-05-23` 的日级基础统计产物。
- 当前理解：用户已新建对齐目标日期的 CLS 定时 SQL 任务；本轮只读读取指标 topic，不修改任务、topic 或索引，不使用分钟汇总 fallback。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实 CLS 任务、topic 或索引配置
  - 不读取插件 debug 页、Chrome storage 或 BOSS DOM
  - 不用分钟汇总兜底回答日级统计
- 验证计划：使用 `QueryRangeMetric` 查询第五个指标 topic 的日级基础统计 metrics，按 `active_date=2026-05-23` 和 `operator_id` 拼出记录内容；若没有记录则报告指标 topic 中可见的 `active_date` 标签。
- 当前状态：准备按指标 topic 读取。

#### 完成记录：2026-05-23 series 已出现但暂无可查询数值样本

- 时间：2026-05-24 15:40
- 状态：已完成
- 已完成：只读查询第五个 CLS 指标 topic。`GetMetricLabelValues` 能看到 `active_date=2026-05-23`，`operator_id` 只看到 `zhouxinyu` 和 `小图图`；`GetMetricSeries` 能列出 `active_minutes{active_date="2026-05-23"}` 对应的两个 series，标签包含首末活跃时间：`zhouxinyu 2026-05-23 13:59~17:30`、`小图图 2026-05-23 11:02~18:18`。
- 改动文件：
  - `docs/ai-worklog.md`
- 当前验证结果：对 `active_minutes`、`total_events`、`card_exposed` 等 metric 使用 `QueryRangeMetric` 查询 `active_date="2026-05-23"`，返回 0 个数值 series；对 2026-05-23 00:00 到 2026-05-25 00:00 按小时 `QueryMetric` 扫描，也没有非空瞬时值。宽窗口 `QueryRangeMetric active_minutes` 仍只返回 `active_date=2026-05-22` 的 3 个有值 series。
- 风险/阻塞：新任务已经在指标 topic 中创建了 2026-05-23 的 series 元数据，但指标数值样本暂不可查；这不同于“没有 topic/没有 label”。需要在 CLS 控制台查看新任务最近实例的“写目标主题成功行数/失败行数”和指标转换状态，确认是否只是指标写入延迟，还是输出到指标 topic 时数值字段没有成功落成样本。
- 中断续写入口：如继续排查，优先查看 CLS 定时 SQL 调度详情中 2026-05-24 00 点后的实例：输入行数、输出行数、写目标成功/失败行数；同时在指标 topic 查询界面直接查 `active_minutes{active_date="2026-05-23"}` 验证控制台是否也无数值。

### 任务：新增历史数据页面并接入日级指标库

- 时间：2026-05-24 15:47
- 执行者：AI
- 状态：进行中
- 目标：为分析系统前台新增《历史数据》页面，支持按人查看和按日期查看历史数据；数据源必须来自 `CLS_DAILY_BASIC_SUMMARY_*` 指标库，不允许从分钟级汇总累加。
- 当前理解：需要新增后端指标 topic reader 和 API，再新增前端页面/筛选控件。历史数据只展示 `boss_daily_operator_basic_stats` 指标库中的日级基础统计；如果指标值暂不可查，应明确显示缺数据/写入异常，不回退到分钟汇总。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/consumer/cls_search.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/domain/summary.py`
  - `src/boss_analysis/domain/metrics.py`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `src/boss_analysis/api/query_service.py`
  - `frontend/src/types.ts`
  - `frontend/src/App.tsx`
  - 相关测试文件
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实 CLS 任务、topic 或索引配置
  - 不使用分钟汇总作为历史数据 fallback
  - 不展示聊天正文、联系方式或完整简历正文
- 验证计划：补充 reader/API 单测；运行相关 Python 测试、全量测试、前端 build 和 `git diff --check`。
- 当前状态：已明确数据源边界，准备阅读现有前后端 API 和页面结构。

#### 接手记录：继续实现历史数据页面

- 时间：2026-05-24 16:02
- 状态：进行中
- 已完成：按续写要求查看最新工作日志、`git status --short` 和历史数据相关文件 diff；确认当前已有改动包含前一轮配置/指标 topic loader 以及若干 `job_name` 展示修正，历史数据页面和 API 尚未接入。
- 改动文件：
  - `docs/ai-worklog.md`
- 当前验证结果：尚未运行验证。
- 下一步：阅读 `summary_reader`、`dev_data`、`query_service`、`dev_server`、前端 `App`/API/types 的现有模式，新增只读指标 topic reader、后端 `/api/history` 和前端《历史数据》标签页；严格禁止从分钟级汇总累加历史数据。

#### 完成记录：历史数据页面接入日级基础指标库

- 时间：2026-05-24 16:29
- 状态：已完成
- 已完成：新增 `DailyBasicStatsRecord`、CLS 指标 topic 读取 helper、日级基础指标 parser 和 metric series 重组逻辑；新增 dev dataset 的 `daily_basic_summaries` 与 `daily_basic_summary_source`；新增查询服务 `history()` 和 dev server `/api/history`。真实 metric topic 模式下，`/api/history` 会按筛选的 `active_date/operator_id` 即时读取 `CLS_DAILY_BASIC_SUMMARY_*` 指标库，避免只依赖启动时的默认窗口；前端新增《历史数据》导航页，可按日期和人筛选，并展示日期、操作员、账号、活跃分钟、曝光/详情、招呼、聊天、微信、总事件和数值状态。本页明确标注“来源：CLS 日级基础指标库；本页不使用分钟汇总累加”，且对 `GetMetricSeries` 有 metadata 但 `QueryRangeMetric` 无数值样本的记录显示 `指标值暂不可查`。
- 改动文件：
  - `docs/ai-worklog.md`
  - `README.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
  - `src/boss_analysis/domain/summary.py`
  - `src/boss_analysis/domain/metrics.py`
  - `src/boss_analysis/domain/__init__.py`
  - `src/boss_analysis/consumer/cls_search.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `src/boss_analysis/api/query_service.py`
  - `frontend/src/types.ts`
  - `frontend/src/api.ts`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `tests/test_summary_reader.py`
  - `tests/test_query_service.py`
  - `tests/test_dev_server.py`
- 当前验证结果：
  - `PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest tests.test_summary_reader tests.test_query_service tests.test_dev_server` 通过，49 tests。
  - `PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest discover -s tests` 通过，118 tests。
  - `npm --prefix frontend run build` 通过。
  - `git diff --check -- ...` 通过。
  - 本地新版后端已在 `http://127.0.0.1:8766` 启动，前端已在 `http://127.0.0.1:5174` 启动并代理到 8766；`GET /api/history?active_date=2026-05-23` 返回稳定空结构（demo 数据无日级基础指标）。
- 风险/后续：本地 demo 模式没有真实日级基础指标；若要直接看 2026-05-23 真实指标，需要用 `BOSS_ANALYSIS_DATA_SOURCE=summary` 并确保 `CLS_DAILY_BASIC_SUMMARY_TOPIC_ID` 和腾讯云凭据可用。历史页没有分钟汇总 fallback；真实 topic 若继续只有 series metadata 而无数值样本，页面会显示 `指标值暂不可查`，用于提示继续排查 CLS 指标写入。

### 任务：确认 2026-05-23 日级基础指标数值暂不可查原因

- 时间：2026-05-24 16:36
- 执行者：AI
- 状态：进行中
- 目标：按用户反馈“原始数字里面应该是有的”，只读确认第五个 CLS 指标 topic 中 2026-05-23 的日级基础统计数值为什么前台显示暂不可查。
- 当前理解：前台已经能读到 `active_date=2026-05-23` 的 2 条 series metadata，但 `QueryRangeMetric` 未返回数值样本；需要区分是查询表达式/时间范围问题，还是 CLS 指标 topic 实际只落了 label、未落数值样本。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改真实 CLS 任务、topic、索引或云资源
  - 不使用分钟级汇总 fallback
  - 不修改 `analysis-system/` 之外文件
- 验证计划：使用 `CLS_DAILY_BASIC_SUMMARY_*` 配置只读调用 `GetMetricSeries`、`QueryRangeMetric`，对 `active_minutes`、`card_exposed`、`total_events` 做不同时间范围和表达式查询；必要时查询 label 维度，确认数值是否存在、时间戳是否落在查询窗口内、表达式是否需要调整。
- 当前状态：准备执行只读 CLS 指标 API 排查。

#### 完成记录：确认是查询窗口错过指标样本时间戳

- 时间：2026-05-24 16:41
- 状态：已完成
- 已完成：只读查询第五个 CLS 指标 topic。确认 `active_date=2026-05-23` 的 `active_minutes`、`card_exposed`、`total_events` 等数值样本实际存在；样本时间戳落在 `2026-05-22T16:00:00+00:00` 到 `2026-05-22T16:05:00+00:00`，即 Asia/Shanghai 的 `2026-05-23 00:00` 附近。此前页面显示“指标值暂不可查”的原因是 dev dataset 启动加载按默认 `today` 窗口读取（2026-05-24 当天窗口），`GetMetricSeries` 还能列到 2026-05-23 的 series metadata，但 `QueryRangeMetric` 的窗口没有覆盖 2026-05-23 00:00 的数值 sample。
- 改动文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/dev_server.py`
  - `src/boss_analysis/consumer/cls_search.py`
- 当前验证结果：更新后的 `iter_daily_basic_summaries_from_metric_topic(active_date="2026-05-23")` 返回 2 条有值记录：`zhouxinyu/谢女士 active_minutes=21 card_exposed=211 detail_opened=13 total_events=295`；`小图图/伍先生 active_minutes=66 card_exposed=1077 detail_opened=214 total_events=1714`。本机现有 `http://127.0.0.1:8765/api/history?active_date=2026-05-23` 已返回 `status=ok` 和上述完整数值。`PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest discover -s tests` 通过，118 tests。
- 后续：已改 `/api/history`，在真实 metric topic source 下会按筛选的 `active_date/operator_id` 即时查对应日期窗口，不再只依赖启动时默认窗口。现有运行中的 8765/5173 服务如果仍是旧进程，需要重启后前台才会显示数值。

### 任务：调整历史数据查询交互和操作员详情子页面

- 时间：2026-05-24 17:30
- 执行者：AI
- 状态：进行中
- 目标：按用户要求为历史数据页增加显式“查询”按钮和 loading 状态；操作员增加查询详情子页面，展示该操作员每天的详细日级基础统计；同时在开发规范中补充任何 loading 都必须有明确状态。
- 当前理解：历史数据页当前会随筛选条件变化自动查询，需要改为用户点击查询后触发；查询中按钮和页面区域都要有可见 loading 状态。操作员详情子页面应继续只读 `CLS_DAILY_BASIC_SUMMARY_*` 指标库，不使用分钟汇总。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `AGENTS.md`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/dev_server.py`
  - `frontend/src/App.tsx`
  - `frontend/src/api.ts`
  - `frontend/src/styles.css`
  - `frontend/src/types.ts`
  - 相关测试文件
- 不修改范围：
  - 不修改真实 CLS 任务、topic、索引或云资源
  - 不修改 `analysis-system/` 之外文件
  - 不从分钟级汇总累加历史数据
- 验证计划：补充或调整后端 reader/API 单测；运行相关 Python 测试、全量 Python 测试、前端 build 和 `git diff --check`。
- 当前状态：准备阅读当前历史页实现并修改交互。

#### 完成记录：历史页改为手动查询并增加操作员详情

- 时间：2026-05-24 18:01
- 状态：已完成
- 已完成：历史数据页增加显式“查询”按钮，筛选条件变化后不再立即请求；按钮、筛选区和结果区域都有 `loading/ready/error` 状态提示。操作员行新增“查询详情”按钮，进入操作员历史详情子页面，按操作员查询最近 31 天的日级基础指标并展示每天详细数据。后端指标 reader 支持 `lookback_days`，`/api/history?operator_id=...&days=31` 会从 `CLS_DAILY_BASIC_SUMMARY_*` 指标库读取多日记录。`AGENTS.md` 已补充前端任何 loading 都必须由明确状态字段驱动并在界面显示。
- 改动文件：
  - `AGENTS.md`
  - `docs/ai-worklog.md`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/dev_server.py`
  - `frontend/src/App.tsx`
  - `frontend/src/api.ts`
  - `frontend/src/styles.css`
  - `tests/test_summary_reader.py`
- 当前验证结果：
  - `PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest tests.test_summary_reader tests.test_dev_server tests.test_query_service` 通过，50 tests。
  - `PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest discover -s tests` 通过，119 tests。
  - `npm --prefix frontend run build` 通过。
  - `git diff --check -- ...` 通过。
  - 本地服务已恢复：前端 `http://127.0.0.1:5173`，后端 `http://127.0.0.1:8765`；`/api/history?operator_id=zhouxinyu&days=31` 通过前端代理返回 2026-05-22 和 2026-05-23 两天数据。
- 后续：当前操作员详情默认最近 31 天，如要做日期范围选择，可在详情页继续增加起止日期筛选。

### 任务：单人明细展示当前操作员插件版本号

- 时间：2026-05-25 13:05
- 执行者：AI
- 状态：进行中
- 目标：在单人明细/操作员详情页展示当前操作员的插件版本号。
- 当前理解：上一轮已新增操作员详情子页面，本轮应优先复用已有历史明细数据源中携带的 operator/plugin 维度；如果后端已有版本字段，仅补前端展示；如果缺少字段，再在分析系统内部补 API/type 映射，不修改插件和父项目文件。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `frontend/src/App.tsx`
  - `frontend/src/types.ts`
  - `frontend/src/styles.css`
  - 必要时补充 `src/boss_analysis/` 或测试文件中的字段传递
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实 CLS 任务、topic、索引或云资源
  - 不从插件端采集新增业务判断，只展示已有事实字段
- 验证计划：阅读详情页和 API 数据结构，按实际改动运行相关 Python 测试或前端 build，并执行 `git diff --check`。
- 当前状态：准备阅读 README、边界/设计文档、日志契约和相关前后端代码。

#### 阶段记录：完成插件版本字段接入

- 时间：2026-05-25 13:09
- 状态：待验证
- 已完成：阅读当前“单人明细”前端组件、`/api/operator/:id` 查询服务和日志契约；确认插件版本号已经是原始日志契约字段，且 10 分钟质量汇总也按 `plugin_version` 聚合。本轮新增 `OperatorAnalytics.plugin_version` 和 `plugin_version_observed_at`，查询侧优先从该操作员 raw events 和 10 分钟质量汇总中取最近观测版本；前端单人明细顶部统计区新增“插件版本”展示。
- 改动文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/metrics.py`
  - `src/boss_analysis/api/query_service.py`
  - `tests/test_query_service.py`
  - `frontend/src/types.ts`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
- 当前验证结果：尚未运行。
- 中断续写入口：从运行 `tests.test_query_service` 和前端 build 开始；若真实 summary 模式缺少 log quality topic，则版本号会显示 `--`，因为分钟汇总本身没有插件版本维度。

#### 完成记录：单人明细已展示插件版本号

- 时间：2026-05-25 13:10
- 状态：已完成
- 已完成：`/api/operator/:id` 返回 `plugin_version` 与 `plugin_version_observed_at`；查询服务从该操作员原始日志和 10 分钟质量汇总里选择最近一次可用插件版本。前端“单人明细”的顶部统计区新增“插件版本”格，展示版本号和最近观测时间；没有可用版本时显示 `--`。
- 改动文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/metrics.py`
  - `src/boss_analysis/api/query_service.py`
  - `tests/test_query_service.py`
  - `frontend/src/types.ts`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
- 当前验证结果：
  - `PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest tests.test_query_service` 通过，25 tests。
  - `PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest discover -s tests` 通过，121 tests。
  - `npm --prefix frontend run build` 通过。
  - `git diff --check -- src/boss_analysis/domain/metrics.py src/boss_analysis/api/query_service.py tests/test_query_service.py frontend/src/types.ts frontend/src/App.tsx frontend/src/styles.css docs/ai-worklog.md` 通过。
  - 本机已有开发服务进程：后端 `http://127.0.0.1:8765`（pid 21881），前端 `http://127.0.0.1:5173`（pid 21883）。尝试另起 demo 服务后进程很快退出，已把 `.dev/*.pid` 恢复到现有服务进程。
- 后续：如果只启动分钟汇总而没有 raw events 或 `boss_10min_log_quality` 数据源，单人明细会显示插件版本为 `--`；这是当前数据源不携带版本维度导致的可见缺口。

### 任务：排查当前 CLS 查询变慢原因

- 时间：2026-05-25 13:09
- 执行者：AI
- 状态：进行中
- 目标：按用户反馈“现在 CLS 的查询很慢”，排查分析系统当前 CLS 查询链路慢的原因，区分是前端触发方式、后端串行查询、CLS Search/Metric 接口耗时、时间窗口过大、还是本地服务状态问题。
- 当前理解：本轮先做只读排查和代码路径分析，不修改真实 CLS 任务、topic、索引或云资源；如果需要验证真实 CLS，只使用本地开发/排障用途的只读接口，并记录范围。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实 CLS 任务、topic、索引或云资源
  - 不把 SearchLog 写入生产默认链路
  - 不读取插件 debug 页、Chrome storage 或 BOSS DOM
- 验证计划：阅读当前 README、边界/设计文档、CLS 相关模块和 API 路径；查看本地服务/API 查询耗时；必要时用只读 CLS 接口测量不同接口和查询窗口耗时；最终给出原因、影响范围和建议修复方向。
- 当前状态：已查看最新工作日志和 `git status --short`，发现工作区有大量未提交改动；准备只读阅读 CLS 查询相关代码与配置。

#### 完成记录：定位为日级基础指标读取串行放大

- 时间：2026-05-25 13:18
- 状态：已完成
- 已完成：阅读 CLS 查询实现、dev server 刷新逻辑和前端轮询逻辑；使用项目现有只读 CLS client 对真实配置做分段计时。确认慢点不是分钟汇总 `SearchLog`，而是新增的 `CLS_DAILY_BASIC_SUMMARY_TOPIC_ID` 指标 topic 读取：`iter_daily_basic_summaries_from_metric_topic()` 会对每个日级基础指标字段逐个调用 `QueryRangeMetric`，当前 35 个字段加 1 次 `GetMetricSeries`，全部串行执行。
- 改动文件：
  - `docs/ai-worklog.md`
- 当前验证结果：
  - `/api/history?active_date=2026-05-23` 等价的日级基础指标查询：35 次 `QueryRangeMetric` + 1 次 `GetMetricSeries`，总耗时约 14.8 秒，返回 2 条记录。
  - dev dataset 默认 summary 刷新分段计时：分钟汇总 `SearchLog` 0.395 秒、日级活跃 `SearchLog` 0.632 秒、日级基础指标 metric 默认窗口 12.741 秒、10 分钟质量 `SearchLog` 0.749 秒。
  - 当前后端 `refresh_seconds=15`，前端大盘、单人详情、质量页也按 15 秒轮询；因此只要触发后端真实数据刷新，就会被日级基础指标的 12 到 15 秒串行请求拖慢，甚至与下一轮前端请求重叠。
- 结论：当前“CLS 查询很慢”的主要原因是分析系统本地请求链路把日级历史指标的 35 个 metric 字段逐个串行查 CLS 指标接口，并且把这段读取放进 dev server 的通用刷新路径；不是 raw `SearchLog` 慢，也不是分钟汇总 topic 慢。
- 建议下一步：把日级基础指标从大盘通用刷新里移除或懒加载；历史页只在用户点击查询时查，并加后端缓存；进一步优化可把 35 个指标合并为更少的 CLS 查询、或改读日级基础统计日志 topic/同步缓存，而不是请求期逐字段扫 metric topic。

### 任务：确认 metric 查询方式引入来源

- 时间：2026-05-25 13:16
- 执行者：AI
- 状态：进行中
- 目标：确认 `CLS_DAILY_BASIC_SUMMARY_TOPIC_ID` 的 metric 查询方式是否是在历史数据/历史大盘实现时引入，以及此前是否一直使用日志 topic 的 `SearchLog` 查询方式。
- 当前理解：需要通过当前 diff、代码路径和工作日志确认演变，不修改真实 CLS 任务、topic 或索引，不改变代码实现。
- 计划修改文件：
  - `docs/ai-worklog.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改查询代码或前端代码
  - 不访问或修改真实云资源
- 验证计划：查看 `summary_reader`、`cls_search`、`dev_data`、`dev_server` 的当前 diff 和历史任务日志，确认 metric helper 与历史页面/API 的引入点；必要时对比 HEAD 版本。
- 当前状态：准备只读比对相关文件 diff。

#### 完成记录：确认 metric 方式是在历史数据链路中固化

- 时间：2026-05-25 13:16
- 状态：已完成
- 已完成：对比当前 diff 与 HEAD 版本。HEAD 中 `cls_search.py` 只有 `search_cls_log_values()`/`SearchLog`，`summary_reader.py` 只有分钟汇总、日级活跃和质量汇总的 SearchLog reader，没有 `QueryRangeMetric`、`GetMetricSeries`、`DailyBasicStatsRecord` 或 `/api/history`。当前 diff 新增 `query_cls_metric_range()`、`get_cls_metric_series()`，并由 `iter_daily_basic_summaries_from_metric_topic()`、`_load_daily_basic_summaries()` 和 `history_payload()` 调用。
- 改动文件：
  - `docs/ai-worklog.md`
- 当前验证结果：确认 metric 接口最早先在“第五个 topic 读取为 0”的排障中被临时使用，因为该 topic 实际是指标 topic，`SearchLog` 查不到；随后在“新增历史数据页面并接入日级指标库”任务中被写成正式的历史数据读取实现。此前本地 summary/daily/quality 链路一直是通过 `SearchLog` 读取目标日志 topic。
- 结论：用户判断正确。metric 方式不是原有通用查询方式，而是为了历史数据/日级基础统计接入第五个指标 topic 时引入并固化的；如果要恢复“日志方式查询”，需要让 `boss_daily_operator_basic_stats` 输出到日志 topic，或在分析系统侧改回读取日级基础统计日志 topic/同步缓存。

### 任务：将历史数据查询从 metric 改回日志 topic 查询

- 时间：2026-05-25 13:19
- 执行者：AI
- 状态：进行中
- 目标：按用户要求，把当前历史数据/日级基础统计查询从 CLS metric 接口改回日志 topic `SearchLog` 读取方式，避免 35 个 metric 字段串行查询导致性能过差。
- 当前理解：原有分钟汇总、日级活跃、质量汇总均走日志 topic SearchLog；本轮应让 `CLS_DAILY_BASIC_SUMMARY_TOPIC_ID` 也按日级基础统计日志 topic 读取。若云端当前第五个 topic 仍是指标 topic，则代码会恢复为日志 topic 预期，但真实数据需要把 `boss_daily_operator_basic_stats` 输出到日志 topic 或配置正确日志 topic ID。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `README.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
  - `src/boss_analysis/consumer/cls_search.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `tests/test_cls_search.py`
  - `tests/test_summary_reader.py`
  - `tests/test_dev_data.py`
  - `tests/test_dev_server.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实 CLS 任务、topic、索引或云资源
  - 不从分钟级汇总累加历史数据
  - 不恢复 raw 原始日志 SearchLog 生产链路
- 验证计划：补充/调整 SearchLog 日级基础统计 reader 测试；运行相关 Python 测试、全量 Python 测试、前端 build 和 `git diff --check`。
- 当前状态：准备修改 reader 和 dev server 调用链路。

#### 完成记录：历史数据查询已改回 SearchLog 日志 topic

- 时间：2026-05-25 13:19
- 状态：已完成
- 已完成：移除请求链路中的 CLS metric API 读取方式，`/api/history` 和 dev dataset 的日级基础统计读取改为 `iter_daily_basic_summaries_from_search()`，只通过 `SearchLog` 读取 `CLS_DAILY_BASIC_SUMMARY_TOPIC_ID` 指向的日级基础统计日志 topic。`SearchLog` helper 支持显式 `start_at/end_at`，因此历史页按日期/操作员筛选时仍可即时查询对应日期窗口或最近 N 天窗口；查询结果在本地按 `active_date/operator_id` 过滤。同步更新 README 和 CLS 任务文档，明确该配置应指向日志 topic，若仍指向指标 topic 会读不到记录。
- 改动文件：
  - `docs/ai-worklog.md`
  - `README.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
  - `src/boss_analysis/consumer/cls_search.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `src/boss_analysis/domain/summary.py`
  - `tests/test_cls_search.py`
  - `tests/test_summary_reader.py`
  - `tests/test_dev_data.py`
  - `tests/test_dev_server.py`
- 当前验证结果：
  - `PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest tests.test_cls_search tests.test_summary_reader tests.test_dev_data tests.test_dev_server` 通过，54 tests。
  - `PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest discover -s tests` 通过，125 tests。
  - `npm --prefix frontend run build` 通过。
  - `git diff --check -- ...` 通过。
  - `rg -n "QueryRangeMetric|GetMetricSeries|iter_daily_basic_summaries_from_metric_topic|query_cls_metric_range|get_cls_metric_series|build_metric_range_payload|build_get_metric_series_payload|metric-topic|真实 metric topic|指标 topic reader" src tests README.md docs/modules/07-cls-scheduled-sql-tasks.md -S` 无命中。
- 注意事项：本轮没有修改真实 CLS 资源。当前 `.env.local` 若仍把 `CLS_DAILY_BASIC_SUMMARY_TOPIC_ID` 指向第五个指标 topic，改回 SearchLog 后会查不到历史记录；需要把 `boss_daily_operator_basic_stats` 输出到日志 topic `boss_summary_daily_basic_prod`，或把该环境变量改为正确的日志 topic ID。

### 任务：排查当日实时数据查询链路

- 时间：2026-05-25 13:27
- 执行者：AI
- 状态：进行中
- 目标：按用户要求，完整排查当日实时数据查询链路，包括前端轮询接口、后端刷新逻辑、CLS topic 读取、查询窗口、接口耗时和是否仍存在 metric 慢查询路径。
- 当前理解：当日实时数据主要对应实时大盘 `/api/dashboard`、单人明细 `/api/operator/:id` 和数据质量 `/api/log-quality`；历史页 `/api/history` 已改回日志 topic，但需要确认它不会拖慢当日实时链路。本轮只做只读排查和必要的代码路径修正，不修改真实 CLS 任务、topic、索引或云资源。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - 如发现运行链路仍有性能问题，可能修改 `src/boss_analysis/dev_data.py` 或 `src/boss_analysis/dev_server.py`
  - 如涉及前端轮询行为，可能修改 `frontend/src/App.tsx`
  - 相关测试文件
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实 CLS 任务、topic、索引或云资源
  - 不恢复 raw 原始日志 SearchLog 生产链路
  - 不从分钟级汇总临时拼历史数据
- 验证计划：阅读前端 API/轮询、dev server 刷新、dev dataset 加载和 summary reader；用只读 CLS client 对当前 summary 配置分段计时；确认实时接口是否仍触发日级基础历史查询；根据发现运行相关 Python 测试、前端 build 和 diff check。
- 当前状态：准备阅读当日实时数据相关代码路径。

#### 阶段记录：实时刷新链路已拆出历史日级基础查询

- 时间：2026-05-25 13:32
- 状态：已完成，继续排查前端轮询
- 已完成：确认前端当日实时链路是 `/api/dashboard` 与 `/api/operator/:id` 每 15 秒轮询，`/api/log-quality` 只在质量页轮询；后端通用刷新原本会一起加载分钟汇总、日级活跃、日级基础历史和 10 分钟质量。已将 `CLS_DAILY_BASIC_SUMMARY_TOPIC_ID` 的记录加载改为可跳过，并让 dev server 的通用刷新只保留实时所需数据；历史页 `/api/history` 仍按筛选条件按需读取日级基础日志 topic 或文件。另给刷新入口加锁，减少大盘和单人明细轮询并发时的重复刷新。
- 改动文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `tests/test_dev_data.py`
  - `tests/test_dev_server.py`
- 当前验证结果：`PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest tests.test_dev_data tests.test_dev_server` 通过，30 tests。
- 中断续写入口：继续运行全量测试、前端 build 和 diff check；如需真实 CLS 计时，只做只读 SearchLog 分段计时。

#### 阶段记录：前端实时轮询已按 tab 收敛

- 时间：2026-05-25 13:35
- 状态：已完成
- 已完成：发现 React 页面切到历史或质量 tab 后，dashboard 与 operator detail 仍在后台每 15 秒请求。已拆分操作员配置加载和 dashboard 实时轮询：操作员配置仍启动时加载一次；`/api/dashboard` 与 `/api/operator/:id` 只在 dashboard tab 轮询；`/api/log-quality` 仍仅在质量 tab 轮询；历史页保持按需查询、不设 interval。
- 改动文件：
  - `docs/ai-worklog.md`
  - `frontend/src/App.tsx`
- 当前验证结果：
  - `PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest discover -s tests` 通过，128 tests。
  - `npm --prefix frontend run build` 通过。
- 中断续写入口：继续执行 diff check 和任务完成记录。

#### 完成记录：当日实时数据查询链路排查完成

- 时间：2026-05-25 13:35
- 状态：已完成
- 已完成：完整排查当日实时链路。前端轮询现状已收敛为 dashboard tab 才轮询 `/api/dashboard` 与 `/api/operator/:id`，quality tab 才轮询 `/api/log-quality`，history tab 按需查询 `/api/history`；后端通用刷新不再预取日级基础历史 topic，`CLS_DAILY_BASIC_SUMMARY_TOPIC_ID` 仅保留 source 元信息，历史页打开或筛选时再读取；刷新入口已加锁，避免并发请求重复触发同一轮 CLS 刷新。静态扫描确认运行代码中无 `QueryRangeMetric` / `GetMetricSeries` / metric reader 残留。
- 真实 CLS 只读计时：
  - `CLS_SUMMARY_TOPIC_ID` 分钟汇总 SearchLog：0.398s，58 条。
  - `CLS_DAILY_SUMMARY_TOPIC_ID` 日级活跃 SearchLog：0.757s，0 条。
  - `CLS_LOG_QUALITY_TOPIC_ID` 10 分钟质量 SearchLog：0.772s，0 条。
  - 后端一次实时刷新（跳过 daily basic 预取）：2.033s，minute=58，daily_active=0，daily_basic_prefetched=0，log_quality=0。
- 改动文件：
  - `docs/ai-worklog.md`
  - `frontend/src/App.tsx`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `tests/test_dev_data.py`
  - `tests/test_dev_server.py`
- 当前验证结果：
  - `PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest tests.test_dev_data tests.test_dev_server` 通过，30 tests。
  - `PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest discover -s tests` 通过，128 tests。
  - `npm --prefix frontend run build` 通过。
  - `git diff --check -- frontend/src/App.tsx src/boss_analysis/dev_data.py src/boss_analysis/dev_server.py tests/test_dev_data.py tests/test_dev_server.py docs/ai-worklog.md` 通过。
  - `rg -n "QueryRangeMetric|GetMetricSeries|query_cls_metric|metric_range|metric_topic|iter_daily_basic_summaries_from_metric" src tests README.md docs/modules -S` 无命中。
- 注意事项：本轮没有修改真实 CLS topic、定时 SQL 或索引。真实计时显示当日实时慢点已不在 metric API；当前 `daily_active` 与 `log_quality` 今日查询返回 0 条，如果业务预期应该有值，需要另查对应定时 SQL 是否产出或目标 topic/env 是否正确。

### 任务：单人明细优先使用分钟汇总插件版本

- 时间：2026-05-25 13:21
- 执行者：AI
- 状态：进行中
- 目标：按用户提醒，单人明细的插件版本号优先从分钟级汇总数据读取。
- 当前理解：分钟级汇总真实数据中可能已带 `plugin_version`，但当前 `MinuteSummaryRecord` 和 parser 尚未建模该字段，导致 `/api/operator/:id` 只能从 raw events 或 10 分钟质量汇总推导。应补分钟汇总字段传递，并将其作为最近版本优先来源。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/summary.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/api/query_service.py`
  - `tests/test_summary_reader.py`
  - `tests/test_query_service.py`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实 CLS 任务、topic、索引或云资源
  - 不调整前端布局，除非类型必须同步
- 验证计划：补充分钟汇总 parser 和单人查询单测；运行 `tests.test_summary_reader`、`tests.test_query_service`、全量 Python 测试、前端 build 和 `git diff --check`。
- 当前状态：准备补分钟汇总 `plugin_version` 字段。

#### 阶段记录：分钟汇总插件版本字段已接入

- 时间：2026-05-25 13:23
- 状态：待验证
- 已完成：`MinuteSummaryRecord` 新增 `plugin_version`；分钟汇总 parser 支持 `plugin_version` / `pluginVersion`；`AnalysisQueryService.operator_analytics()` 查询插件版本时优先使用该操作员分钟汇总中的最新分钟版本，再回退 raw events 和 10 分钟质量汇总。补充 parser 单测和“分钟汇总优先于 raw”单测。
- 改动文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/summary.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/api/query_service.py`
  - `tests/test_summary_reader.py`
  - `tests/test_query_service.py`
- 当前验证结果：尚未运行。
- 中断续写入口：从 `PYTHONPATH=src python3 -m unittest tests.test_summary_reader tests.test_query_service` 开始验证。

### 任务：CLS 分钟生产任务增加插件版本维度

- 时间：2026-05-25 13:18
- 执行者：AI
- 状态：进行中
- 目标：按用户要求，在 CLS 分钟级生产汇总任务产物中增加插件版本号汇总维度，使单人明细可直接从分钟汇总读取当前操作员插件版本。
- 当前理解：代码侧已准备接收 `MinuteSummaryRecord.plugin_version`，但生产 CLS 定时 SQL 任务如果不输出 `plugin_version`，页面仍拿不到该字段。需要至少调整 `boss_minute_operator_funnel` 和 `boss_minute_chat` 的输出字段、内层 select 和 group by；实际修改云端生产任务属于真实云资源变更，执行前需要明确列出资源和风险并得到确认。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
  - 必要时同步 `docs/modules/04-aggregation-query-api.md` 或 README
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 未经确认不调用腾讯云 API 修改真实 CLS 生产任务
  - 不改变事件采集契约，不新增插件端字段
- 验证计划：静态检查 SQL 文档中目标字段、SQL select 和 group by 均包含 `plugin_version`；运行相关单测和 `git diff --check`。
- 当前状态：准备修改 CLS 定时 SQL 文档。

#### 完成记录：分钟任务 SQL 模板已补插件版本

- 时间：2026-05-25 13:22
- 状态：已完成
- 已完成：在 `boss_summary_minute_prod` 的两条分钟任务模板中补充 `plugin_version` 输出。`boss_minute_operator_funnel` 和 `boss_minute_chat` 均在内层读取 `plugin_version`，外层使用 `max_by(plugin_version, event_at)` 输出该操作员该分钟最后一条事件版本；`group by` 仍保持 `minute, operator_id`，避免同一分钟跨版本时拆分计数。同步更新分钟汇总 topic 索引建议、聚合查询文档和 README。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `README.md`
  - `src/boss_analysis/domain/summary.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/api/query_service.py`
  - `tests/test_summary_reader.py`
  - `tests/test_query_service.py`
- 当前验证结果：
  - `PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest tests.test_summary_reader tests.test_query_service` 通过，41 tests。
  - `PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest discover -s tests` 通过，122 tests。
  - `npm --prefix frontend run build` 通过。
  - `rg -n "plugin_version|group by minute, operator_id|max_by\\(plugin_version" docs/modules/07-cls-scheduled-sql-tasks.md docs/modules/04-aggregation-query-api.md README.md` 已确认两条分钟 SQL 均有 `max_by(plugin_version, event_at)` 且仍按 `minute, operator_id` 分组。
  - `git diff --check -- ...` 通过。
- 后续/风险：本轮没有调用腾讯云 API 修改真实生产定时 SQL 任务。若要直接更新云端 `boss_minute_operator_funnel` 和 `boss_minute_chat` 生产任务，需要先确认目标 CLS region/topic/task，并接受短时间任务输出字段变化风险；更新后还要确认目标 topic 已为 `plugin_version` 开启键值索引和统计分析。当前工具启动的本地 dev 后台进程未能稳定存活，已清理 stale `.dev/*.pid`。

### 任务：补充 SQL 修改输出协作规则

- 时间：2026-05-25 13:24
- 执行者：AI
- 状态：进行中
- 目标：按用户要求，后续修改 SQL 时除了沉淀到相关设计文件，还必须把完整 SQL 直接发到对话框方便复制；本轮也需要把刚修改的分钟汇总 SQL 直接发给用户。
- 当前理解：需要修改 `analysis-system/AGENTS.md` 的协作规范，并在最终回复中贴出 `boss_minute_operator_funnel` 与 `boss_minute_chat` 两段完整 SQL。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `AGENTS.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实 CLS 生产任务或云资源
  - 不改 SQL 模板内容本身，除非发现刚才沉淀内容有明显错误
- 验证计划：运行 `git diff --check -- AGENTS.md docs/ai-worklog.md`；最终回复直接贴 SQL。
- 当前状态：准备补充 `AGENTS.md` 规则。

#### 完成记录：SQL 输出规则已加入 AGENTS

- 时间：2026-05-25 13:25
- 状态：已完成
- 已完成：在 `AGENTS.md` 新增“SQL 修改输出规则”，要求后续修改 SQL 时必须同步沉淀相关设计文件，并在最终回复中直接贴出完整 SQL；多段 SQL 需按任务名分别贴出，并说明是否已实际更新云端生产任务。
- 改动文件：
  - `docs/ai-worklog.md`
  - `AGENTS.md`
- 当前验证结果：
  - `git diff --check -- AGENTS.md docs/ai-worklog.md` 通过。
- 后续：本轮最终回复需要直接贴出 `boss_minute_operator_funnel` 和 `boss_minute_chat` 两段 SQL；真实 CLS 云端任务仍未修改。

### 任务：补充 CLS 与本地分析分层设计规则

- 时间：2026-05-25 13:36
- 执行者：AI
- 状态：进行中
- 目标：按用户要求，在开发约定中加入方案设计/功能升级时必须评估数据分析应落在 CLS 层还是本地代码层的规则。
- 当前理解：近期性能问题暴露出方案设计容易默认在本地代码层做分析；需要把“从合理性和性能综合评估 CLS 预聚合、CLS 定时 SQL、下游同步、本地二次分析”的决策要求写入协作规范，避免把长周期或高频聚合放进 API 请求链路。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `AGENTS.md`
  - `README.md`
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改运行代码、测试代码或真实 CLS 云资源
  - 不改既有 SQL 模板和查询口径
- 验证计划：运行 `git diff --check -- AGENTS.md README.md docs/ai-worklog.md`。
- 当前状态：准备补充开发约定规则。

#### 完成记录：CLS/本地分析分层规则已加入开发约定

- 时间：2026-05-25 13:37
- 状态：已完成
- 已完成：在 `AGENTS.md` 的实现规则中加入方案设计/功能升级必须评估数据分析落点的协作约束；在 `README.md` 的“开发约定”中同步加入同类规则，明确高频、长周期、SQL 可稳定表达的预聚合优先放 CLS 定时 SQL 或已批准下游同步链路，本地代码只做权限过滤、跨主题组合、查询范围内 rollup、离线重放校验和探索性补充。
- 改动文件：
  - `docs/ai-worklog.md`
  - `AGENTS.md`
  - `README.md`
- 当前验证结果：
  - `git diff --check -- AGENTS.md README.md docs/ai-worklog.md` 通过。
- 后续：本轮未修改运行代码、测试代码、SQL 模板或真实 CLS 云资源。

### 任务：历史数据查询无结果排查

- 时间：2026-05-25 13:40
- 执行者：AI
- 状态：进行中
- 目标：排查用户反馈的“历史数据查不出来数据了”，定位是前端请求、后端 `/api/history`、本地/CLS 数据源、时间范围或字段解析导致无结果。
- 当前理解：上一轮刚调整过实时刷新链路，使日级基础历史数据改为按需读取；历史页无结果很可能与 `/api/history` 的查询路径、环境变量、时间范围或 source 记录加载变化有关。需先只读排查，不修改真实 CLS topic、定时 SQL 或索引。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - 如定位为代码回归，可能修改 `src/boss_analysis/dev_data.py`、`src/boss_analysis/dev_server.py`、`src/boss_analysis/api/query_service.py` 或前端历史页相关文件
  - 相关测试文件
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实 CLS 任务、topic、索引或云资源
  - 不恢复正式环境 raw 原始日志 SearchLog 作为历史数据源
  - 不引入新的业务判断或候选人质量分析
- 验证计划：阅读历史查询 API 和数据加载链路；检查当前 diff 与环境变量；用本地测试或 dev server 直接调用 `/api/history` 复现；必要时只读验证 CLS 日级基础 summary topic 返回；补测试并运行相关 Python 测试、前端 build 和 diff check。
- 当前状态：准备阅读分析系统基础文档、历史查询代码和现有未提交 diff。

#### 完成记录：定位为日级基础 topic 类型/配置与当前读取方式不匹配

- 时间：2026-05-25 13:44
- 状态：已完成
- 已完成：阅读历史查询链路和前序日志，确认当前 `/api/history` 已按上一轮要求改为只通过 `SearchLog` 读取 `CLS_DAILY_BASIC_SUMMARY_TOPIC_ID` 指向的日级基础统计日志 topic，不再走 `QueryRangeMetric/GetMetricSeries`，也不从分钟汇总临时拼历史。检查 `.env.local` 后确认该配置仍存在；本地 dev server 可正常读取分钟汇总。
- 只读复现：
  - `GET /api/dashboard` 返回分钟汇总 `summary_record_count=63`，说明实时分钟汇总链路有数据。
  - `GET /api/history?active_date=2026-05-24` 返回 `status=empty`、`record_count=0`、`source_record_count=0`。
  - `GET /api/history?active_date=2026-05-23` 返回 `status=empty`、`record_count=0`、`source_record_count=0`。
  - 直接对分钟汇总 topic 做 `SearchLog`，最近 3 天返回 415 条。
  - 直接对 `CLS_DAILY_BASIC_SUMMARY_TOPIC_ID` 做 `SearchLog`，2026-05-23、2026-05-24、2026-05-25 和最近 180 天均返回 0 条，且 CLS 无错误、`ListOver=True`。
- 结论：历史数据查不出来的直接原因是当前后端期待 `CLS_DAILY_BASIC_SUMMARY_TOPIC_ID` 指向“日级基础统计日志 topic”，但当前配置对应的 topic 没有可被 `SearchLog` 读取的日志记录。结合前序日志，该 topic 大概率仍是此前的第五个指标 topic，或 `boss_daily_operator_basic_stats` 尚未输出到新的日志 topic。当前代码行为符合上一轮“从 metric 改回日志 topic 查询”的改动。
- 改动文件：
  - `docs/ai-worklog.md`
- 当前验证结果：未修改运行代码；本轮只做只读接口/CLS 查询和日志记录。
- 后续：需要在 CLS 侧把 `boss_daily_operator_basic_stats` 输出到日志 topic `boss_summary_daily_basic_prod`，并把 `.env.local` 的 `CLS_DAILY_BASIC_SUMMARY_TOPIC_ID` 改为该日志 topic ID；或明确选择重新走指标 topic/同步缓存方案，但不建议恢复请求期串行 metric 查询。

#### 接手记录：用户截图确认 topic 中存在指标样本

- 时间：2026-05-25 13:46
- 状态：进行中
- 已完成：用户贴图显示当前 topic 中确有 `boss_daily_operator_basic_stats` 相关数据，行形态包含 `Time`、`__name__=session_count`、`active_date`、`boss_account_matched`、`boss_account_name`、`first_active_minute`、`last_active_minute`、`metric_name`、`operator_account_name` 等列；这更符合 CLS 指标 topic 的样本/标签表，而不是 SearchLog 返回的普通日志行。
- 当前理解：上一条结论“topic 没有可被 SearchLog 读取的日志记录”仍成立，但表述为“topic 没数据”不准确。实际问题是 `/api/history` 当前只实现了日志 topic `SearchLog` 读取，而用户当前可见的数据在指标 topic 查询视图里；需要确认是否应恢复/优化指标 topic reader，或把定时 SQL 输出切到日志 topic。
- 改动文件：
  - `docs/ai-worklog.md`
- 验证计划：只读检查当前代码中是否还保留 metric API helper；必要时恢复指标读取路径并补测试，但避免再次把 35 个字段串行查询挂到实时刷新链路上。

#### 阶段记录：确认配置指向指标 topic

- 时间：2026-05-25 13:48
- 状态：实现中
- 已完成：用户确认配置里的 ID 就是 `CLS_DAILY_BASIC_SUMMARY_TOPIC_ID`。结合截图中的 `__name__` 列，判断当前配置不是错配到别的 topic，而是这个配置当前实际指向 CLS 指标 topic；历史页无数据是因为上一轮把读取方式切到了 SearchLog 日志 topic。
- 当前计划：恢复日级基础统计的 CLS metric topic 读取能力，并只在 `/api/history` 按需查询时调用；实时刷新仍跳过日级基础记录，避免重复引入 35 个 metric 查询拖慢实时接口。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/consumer/cls_search.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `tests/test_cls_search.py`
  - `tests/test_summary_reader.py`
  - `tests/test_dev_data.py`
  - `tests/test_dev_server.py`
- 当前验证结果：尚未修改代码。

#### 完成记录：历史数据已恢复按 CLS 指标 topic 读取

- 时间：2026-05-25 15:11
- 状态：已完成
- 已完成：恢复 `CLS_DAILY_BASIC_SUMMARY_TOPIC_ID` 的指标 topic 读取路径。新增 `QueryRangeMetric` helper，并让日级基础统计 reader 用单次 PromQL label selector `{metric_name="boss_daily_operator_basic_stats", ...}` 读取目标日期/操作员范围内所有指标样本，再按 `active_date + operator_id` 重组为 `DailyBasicStatsRecord`。`SearchLog` 日志 topic 读取仍保留，可通过 `CLS_DAILY_BASIC_SUMMARY_SOURCE=log` 显式启用；默认 `metric` 与当前真实 topic 匹配。实时刷新仍 `include_daily_basic_summaries=False`，不会预取历史指标 topic。
- 真实只读验证：
  - `iter_daily_basic_summaries_from_metric_topic(active_date="2026-05-23")` 返回 2 条：`zhouxinyu`、`小图图`。
  - `iter_daily_basic_summaries_from_metric_topic(active_date="2026-05-24")` 返回 1 条：`zhouxinyu`。
  - 前台运行后端时，`GET /api/history?active_date=2026-05-23` 返回 `status=ok`、`record_count=2`；`GET /api/history?active_date=2026-05-24` 返回 `status=ok`、`record_count=1`。
- 改动文件：
  - `docs/ai-worklog.md`
  - `.env.example`
  - `README.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
  - `src/boss_analysis/consumer/cls_search.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/consumer/__init__.py`
  - `src/boss_analysis/dev_data.py`
  - `src/boss_analysis/dev_server.py`
  - `tests/test_cls_search.py`
  - `tests/test_summary_reader.py`
  - `tests/test_dev_data.py`
  - `tests/test_dev_server.py`
- 当前验证结果：
  - `PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest tests.test_cls_search tests.test_summary_reader tests.test_dev_data tests.test_dev_server` 通过，62 tests。
  - `PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest discover -s tests` 通过，133 tests。
  - `npm --prefix frontend run build` 通过。
  - `git diff --check -- ...` 通过。
- 注意事项：本轮没有修改真实 CLS 任务、topic、索引或云资源。曾尝试用 `dev.sh` 后台启动本地服务，但该工具环境下后台进程没有稳定保留；前台启动后端验证接口可正常返回历史数据，验证后已停止临时进程并清理 stale dev 进程。

### 任务：单日历史统计增加对话回复分析

- 时间：2026-05-26 14:47
- 执行者：AI
- 状态：计划中
- 目标：在单日级别历史数据统计中增加三类对话分析：候选人向 BOSS 打招呼后的双方第一轮对话中 BOSS 回复率、回复间隔中位数和平均值；全轮对话中 BOSS 作为最后发言人的比例；全轮对话中 BOSS 对候选人回复间隔的中位数和平均值。
- 当前理解：这是分析系统历史日级统计能力，不应改插件端采集逻辑；需要先确认当前日级历史 API、日级基础 summary 数据结构、前端历史表格/明细和聊天事件/汇总字段的既有口径，再决定指标落在 CLS 预聚合、现有日级记录读取，还是本地按已同步汇总二次计算。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `src/boss_analysis/domain/summary.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/api/query_service.py`
  - `frontend/src/types.ts`
  - `frontend/src/App.tsx`
  - 相关测试文件
  - 如需修改日级 SQL，则同步 `docs/modules/07-cls-scheduled-sql-tasks.md` 和相关模块文档
- 不修改范围：
  - 不修改 `analysis-system/` 之外文件
  - 不修改真实 CLS 任务、topic、索引或云资源
  - 不读取或输出聊天正文、联系方式、完整简历正文等敏感内容
  - 不把候选人质量、员工绩效或话术评价写进插件端或分析指标
- 验证计划：阅读 README、边界、概览、历史/聚合/聊天相关模块文档和当前代码；补充日级统计 parser/API/前端展示相关测试；运行相关 Python 单测、前端 build 和 `git diff --check`。
- 当前状态：准备阅读基础文档和定位历史统计实现。

#### 阶段记录：完成代码阅读和落点确认

- 时间：2026-05-26 15:03
- 状态：实现中
- 已完成：阅读 `README.md`、`docs/boundary.md`、`docs/overview-design.md`、聚合/API、CLS 定时 SQL、事实投影、日志规范中聊天快照字段，以及当前历史页、`DailyBasicStatsRecord`、summary reader、query service 和相关测试。确认历史数据页面只消费 `boss_daily_operator_basic_stats` 日级基础统计，不从分钟汇总或 raw 日志临时拼接；聊天快照消息包含 `direction`、`messageAt`、`fingerprint`，可在 CLS 日级任务中只输出计数和耗时指标，不输出聊天正文。
- 改动文件：
  - `docs/ai-worklog.md`
- 当前验证结果：尚未修改运行代码，尚未运行测试。
- 风险/阻塞：真实 CLS 任务不在本轮直接更新；需要把新增字段沉淀到 `docs/modules/07-cls-scheduled-sql-tasks.md` 并在最终回复贴完整 SQL，用户之后再更新云端任务。
- 中断续写入口：从扩展 `DailyBasicStatsRecord` 与 `DAILY_BASIC_METRIC_FIELDS` 开始，再补 parser/API/前端展示和测试。

#### 完成记录：日级历史对话指标已接入

- 时间：2026-05-26 15:22
- 状态：已完成
- 已完成：`DailyBasicStatsRecord` 新增首轮候选人发起数、首轮 BOSS 回复数、首轮回复中位数/平均值、可解析会话数、BOSS 结束会话数、全轮 BOSS 回复数、全轮回复中位数/平均值；summary reader 支持日志 topic 和 metric topic 两种读取形态；历史表新增“首轮回复 / BOSS 结束 / 全轮回复”展示。`docs/modules/07-cls-scheduled-sql-tasks.md` 已补 `boss_daily_operator_basic_stats` 完整 SQL 模板和字段说明，`docs/modules/04-aggregation-query-api.md` 已补历史日级对话分析口径。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
  - `src/boss_analysis/domain/summary.py`
  - `src/boss_analysis/consumer/summary_reader.py`
  - `src/boss_analysis/api/query_service.py`
  - `frontend/src/types.ts`
  - `frontend/src/App.tsx`
  - `frontend/src/styles.css`
  - `tests/test_summary_reader.py`
  - `tests/test_query_service.py`
- 当前验证结果：
  - `PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest tests.test_summary_reader tests.test_query_service` 通过，43 tests。
  - `PYTHONPYCACHEPREFIX=/private/tmp/boss-analysis-pycache PYTHONPATH=src python3 -m unittest discover -s tests` 通过，133 tests。
  - `npm --prefix frontend run build` 通过。
  - `git diff --check -- ...` 通过。
- 风险/阻塞：本轮没有修改真实 CLS 云端定时 SQL 任务、topic 或索引；新增指标需要用户把文档中的 `boss_daily_operator_basic_stats` SQL 更新到云端任务后，历史页才会出现非零值。已存在的本地 dev 进程显示 Vite 在跑，但后端接口 curl 时连接拒绝/历史日志里有 CLS 超时和 broken pipe，本轮未重启这些既有进程。
- 中断续写入口：若继续上线，下一步是按最终回复中的完整 SQL 更新云端 `boss_daily_operator_basic_stats` 任务，并确认目标指标 topic 能看到新增 `__name__` 字段。

### 任务：拆分日级聊天分析 SQL 避免 CLS 长度限制

- 时间：2026-05-26 15:01
- 执行者：AI
- 状态：实现中
- 目标：用户在 CLS 控制台粘贴上一版合并 SQL 后遇到 `param query must less than 12000`，需要把新增聊天回复分析 SQL 缩短到限制内，并保持历史页面可读取新增字段。
- 当前理解：现有后端 metric topic reader 会把同一 `metric_name="boss_daily_operator_basic_stats"`、`active_date + operator_id` 下的多个 `__name__` 指标字段拼成一条历史记录。因此可以保留原日级基础统计任务不变，新增一个短的日级聊天回复分析任务，输出同一 `metric_name` 标签和新增字段，写入同一个日级基础统计指标 topic。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
- 不修改范围：
  - 不修改真实 CLS 任务、topic、索引或云资源
  - 不修改运行代码和前端代码
  - 不输出聊天正文、联系方式或完整简历正文
- 验证计划：用本地字符数检查确认新增短 SQL 小于 12000；运行 `git diff --check` 覆盖本轮文件。
- 当前状态：准备在 SQL 文档中新增短任务 SQL，并把上一版合并 SQL 标注为不要直接创建。

#### 完成记录：新增短 SQL 任务

- 时间：2026-05-26 15:06
- 状态：已完成
- 已完成：在 `docs/modules/07-cls-scheduled-sql-tasks.md` 新增任务 6 `boss_daily_operator_chat_reply_stats`，输出同一 `metric_name='boss_daily_operator_basic_stats'` 和新增聊天回复字段，写入同一个日级基础统计指标 topic；文档已标注上一版合并 SQL 超过 CLS 12000 字符限制，不要直接创建任务。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
- 当前验证结果：
  - `awk ... | wc -c` 检查任务 6 SQL 为 4295 字符。
  - `git diff --check -- docs/ai-worklog.md docs/modules/07-cls-scheduled-sql-tasks.md` 通过。
- 风险/阻塞：本轮没有修改真实 CLS 云端任务。新增任务适配当前 metric topic 读取方式；如果未来把日级基础统计切成日志 topic SearchLog 方式，需要在同步/读取层合并同一日期和操作员的多条局部记录。
- 中断续写入口：到 CLS 控制台新建任务 6，目标 topic 选择 `boss_summary_daily_basic_prod`，时间窗口跟随任务 5。

### 任务：修复聊天分析 SQL 的 CLS CTE 语法不兼容

- 时间：2026-05-26 15:01
- 执行者：AI
- 状态：实现中
- 目标：用户截图显示 `with s as (...)` 在 CLS 控制台报 `no viable alternative at input 's as'`，需要改成 CLS 管道可接受的不使用 CTE 的 SQL。
- 当前理解：CLS 定时 SQL 在 `* |` 后不支持 `with` CTE；应把任务 6 改写为嵌套子查询版本，同时继续保持单条 SQL 小于 12000 字符。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
- 不修改范围：
  - 不修改真实 CLS 任务、topic、索引或云资源
  - 不修改运行代码和前端代码
  - 不输出聊天正文、联系方式或完整简历正文
- 验证计划：检查任务 6 SQL 字符数低于 12000；确认 SQL 中没有 `with`；运行 `git diff --check`。
- 当前状态：准备改写任务 6 SQL。

#### 完成记录：任务 6 改为无 CTE 嵌套查询

- 时间：2026-05-26 15:08
- 状态：已完成
- 已完成：把任务 6 SQL 从 `with s as (...)` CTE 写法改为 `from (...)` 嵌套子查询写法；同时移除 `with ordinality`，避免 CLS 解析器继续在 `with` 关键字处报错。SQL 仍输出同一组日级聊天回复字段。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
- 当前验证结果：
  - 任务 6 SQL 字符数为 4832，低于 12000。
  - `rg "\bwith\b|\bs as \("` 检查任务 6 SQL 无命中。
  - `git diff --check -- docs/ai-worklog.md docs/modules/07-cls-scheduled-sql-tasks.md` 通过。
- 风险/阻塞：未连接真实 CLS 验证语法；如果 CLS 继续对 `first_value/last_value` 或 `cross join unnest` 报方言错误，需要继续按报错位置降级。
- 中断续写入口：使用最终回复中的无 CTE SQL 覆盖任务 6。

#### 阶段记录：缩短外层间隔表达式

- 时间：2026-05-26 15:01
- 状态：已完成
- 已完成：根据用户截图中 `date_diff('millisecond', lm, nfm limit 10000` 的报错，把任务 6 外层超长 `date_diff` 表达式改成内层 `reply_ms` / `first_reply_ms` 字段，外层只做 `approx_percentile(reply_ms)` 和 `avg(reply_ms)`，减少复制或控制台默认 limit 拼接时的断点风险。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
- 当前验证结果：
  - 任务 6 SQL 字符数为 4718，低于 12000。
  - 任务 6 SQL 中无 `with` CTE。
  - `git diff --check -- docs/ai-worklog.md docs/modules/07-cls-scheduled-sql-tasks.md` 通过。
- 风险/阻塞：未连接真实 CLS 验证；如继续报错，优先按报错行检查是否是控制台自动追加 `limit` 或 CLS 不支持某个窗口函数。
- 中断续写入口：使用最终回复中的新版任务 6 SQL 覆盖当前控制台内容，并确保从第一行 `* |` 到最后一行 `limit 10000` 完整复制。

### 任务：修复任务 6 SQL 同层别名引用

- 时间：2026-05-26 17:55
- 执行者：AI
- 状态：实现中
- 目标：用户反馈 CLS 报 `Column 'nd' cannot be resolved`，需要修复任务 6 SQL 中同一层 `select` 先引用 `nd/nfm` 再定义别名的问题。
- 当前理解：CLS/Presto 语法不允许在同一个 select 列表里引用同层别名；需要把 `lead(...) as nd/nfm` 的窗口函数放入内层子查询，再由外层计算 `reply_ms` 和 `first_reply_ms`。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
- 不修改范围：
  - 不修改真实 CLS 任务、topic、索引或云资源
  - 不修改运行代码和前端代码
  - 不输出聊天正文、联系方式或完整简历正文
- 验证计划：确认任务 6 SQL 字符数低于 12000、无 CTE，并运行 `git diff --check`。
- 当前状态：准备给任务 6 SQL 增加一层子查询。

#### 完成记录：别名引用已下沉到外层

- 时间：2026-05-26 17:55
- 状态：已完成
- 已完成：任务 6 SQL 增加一层子查询，先在内层生成 `fd/ld/nd/nfm`，再在外层计算 `reply_ms/first_reply_ms`，避免同层 select 引用 `nd` alias 导致 CLS 报 `Column 'nd' cannot be resolved`。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
- 当前验证结果：
  - 任务 6 SQL 字符数为 4746，低于 12000。
  - 任务 6 SQL 中无 `with` CTE。
  - `git diff --check -- docs/ai-worklog.md docs/modules/07-cls-scheduled-sql-tasks.md` 通过。
- 风险/阻塞：未连接真实 CLS 验证语法；如果继续报错，优先按报错字段检查是否仍有同层别名或窗口函数方言问题。
- 中断续写入口：使用最终回复中的新版任务 6 SQL 覆盖当前控制台内容。

### 任务：排查任务 6 近 3 天无结果

- 时间：2026-05-26 18:13
- 执行者：AI
- 状态：排查中
- 目标：用户反馈任务 6 SQL 查询最近 3 天一条数据都查不出来，需要判断是源事件不存在、字段过滤过严、时间字段解析失败，还是 `payload.chat.messages` 数组解析导致结果被过滤。
- 当前理解：上一轮 SQL 已解决语法错误，但真实 CLS 结果为空。需要先提供分层探针 SQL，让用户在原始事实日志主题上确认 `candidate_chat.snapshot_captured`、`payload_json`、`payload.chat.messages` 和消息方向/时间字段是否存在，再决定是否改生产 SQL。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - 如确认 SQL 过滤条件需要调整，再修改 `docs/modules/07-cls-scheduled-sql-tasks.md`
- 不修改范围：
  - 不修改真实 CLS 任务、topic、索引或云资源
  - 不修改运行代码和前端代码
  - 不修改 `analysis-system` 外部文件
- 验证计划：本地只做 SQL 文档和字符检查；真实数据可用性需要用户在 CLS 控制台运行探针 SQL 确认。
- 当前状态：准备阅读任务 6 SQL 和日志契约字段，给出最小探针查询。

#### 阶段记录：给出空结果分层排查口径

- 时间：2026-05-26 18:13
- 状态：待用户在 CLS 控制台验证
- 已完成：对照任务 6 SQL、任务清单和日志契约，判断“最近 3 天 0 条”首先要确认查询是否跑在原始事实 topic；任务 6 的源主题必须是原始 `boss` 事实日志，目标才是 `boss_summary_daily_basic_prod`。若在目标 topic 上执行包含 `event_type = 'candidate_chat.snapshot_captured'` 的 SQL，会查不到源事件。已准备源事件计数、payload 覆盖和 messages 展开三条探针 SQL。
- 改动文件：
  - `docs/ai-worklog.md`
- 当前验证结果：本轮未访问真实 CLS 云资源；只做本地文档阅读和排障口径整理。
- 中断续写入口：等待用户把三条探针 SQL 的结果或报错贴回；若探针 1 有 `snapshot_captured > 0` 但任务 6 仍为空，下一步优先改任务 6 的日期字段 `d` 为基于 `histogram(__TIMESTAMP__, interval 1 day)` 的日志日期，或按具体失败层继续收窄过滤条件。

#### 阶段记录：源快照和 messages 已确认存在

- 时间：2026-05-26 18:47
- 状态：继续排查
- 已完成：用户贴回第二条探针结果：`snapshot_rows=490`、`payload_empty=0`、`messages_present=490`、`visible_message_count=3170`、`conversation_count=238`。这说明原始事实 topic 中最近 3 天存在聊天快照，且 `payload.chat.messages` 覆盖正常；任务 6 返回 0 更可能发生在日期 `d`、操作员过滤、messages 展开、消息时间或方向解析层。
- 改动文件：
  - `docs/ai-worklog.md`
- 当前验证结果：真实数据计数由用户截图确认；本地未访问 CLS。
- 中断续写入口：让用户运行下一条分层探针，确认 `d_not_null`、`valid_operator_rows`、`message_rows`、`message_time_ok` 和 `direction_ok` 哪个阶段归零。

#### 阶段记录：定位到日期和方向解析不兼容

- 时间：2026-05-26 19:49
- 状态：继续排查
- 已完成：用户反馈分层探针中 `direction_ok=0`、`d_from_timestamp_ok=0`。这说明任务 6 当前 SQL 中日期解析不能依赖 `from_iso8601_date(substr(cast(__TIMESTAMP__ as varchar), 1, 10))`，方向枚举也不能只认 `candidate/geek/recruiter/boss`。下一步需要读取真实 `messages[].direction` 分布和 `__TIMESTAMP__` 可格式化方式，再更新任务 6 SQL 文档。
- 改动文件：
  - `docs/ai-worklog.md`
- 当前验证结果：真实数据问题由用户截图/反馈确认；本地未访问 CLS。
- 中断续写入口：让用户运行方向分布与时间格式探针；根据返回值扩展方向映射，并把日期改为 `histogram(__TIMESTAMP__, interval 1 day)` 或 CLS 实测可用的日期表达式。

#### 阶段记录：真实 direction 全为 unknown

- 时间：2026-05-26 20:12
- 状态：继续排查
- 已完成：用户贴回方向分布探针：`histogram(__TIMESTAMP__, interval 1 day)` 可以正常产生日桶；所有消息 `direction_value` 均为 `unknown`，`senderType/role/from/side` 均为空。日期问题可通过日桶修复，但当前 raw payload 尚未提供可直接区分候选人/BOSS 的消息方向字段。
- 改动文件：
  - `docs/ai-worklog.md`
- 当前验证结果：真实数据由用户反馈确认；本地未访问 CLS。
- 中断续写入口：继续用不输出聊天正文的字段覆盖探针检查 message JSON 是否存在 `isSelf`、`sender`、`className` 等其它可映射字段；若没有，任务 6 的回复率/回复间隔无法从历史快照可靠回算，需要先修复插件采集方向后再统计新增数据。

#### 阶段记录：用户授权直接只读查询 raw CLS

- 时间：2026-05-26 20:14
- 状态：排查中
- 已完成：用户明确要求“你自己直接调用 raw 的 CLS 数据跑”。本轮将以本地开发/一次性排障方式只读查询 raw CLS，不接入生产链路；查询内容限制为事件计数、消息结构字段、方向枚举和时间字段，不输出聊天正文、联系方式或完整候选人敏感信息。
- 改动文件：
  - `docs/ai-worklog.md`
- 当前验证结果：尚未开始真实 CLS 调用。
- 中断续写入口：先检查本地 CLS 配置和 `src/boss_analysis/consumer/cls_search.py` 用法；若沙箱网络阻断，按用户授权申请提权运行只读探针。

#### 阶段记录：raw CLS 只读排障完成并更新 SQL 文档

- 时间：2026-05-26 20:14
- 状态：已完成
- 已完成：使用用户授权的真实 raw CLS 只读查询完成排障。先通过 `DescribeTopics` 找到原始事实 topic `boss`；再用 `SearchLog` 查询 `candidate_chat.snapshot_captured`。最近窗口内 raw 结果为 370 条快照、178 个会话、2449 条消息；所有消息非正文字段只有 `direction/fingerprint/messageAt/messageIndex`，其中 `direction=unknown` 为 2449/2449，`messageAt` 和 `messageIndex` 均存在。按日期/操作员聚合也显示所有操作员的 `known_direction=0`。因此当前历史数据无法可靠回算候选人/BOSS 方向相关指标。已把任务 6 的日期表达式从不可解析的 `from_iso8601_date(substr(cast(__TIMESTAMP__ ...)))` 改为 `histogram(__TIMESTAMP__, interval 1 day)` 并输出 `YYYY-MM-DD`，避免后续方向采集修复后仍被日期解析卡住；同时在文档中记录历史 `direction=unknown` 的不可回算风险。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/modules/04-aggregation-query-api.md`
  - `docs/modules/07-cls-scheduled-sql-tasks.md`
- 当前验证结果：
  - 真实 CLS 只读排障已完成；未输出聊天正文。
  - 任务 6 SQL 字符数为 4679，低于 CLS 12000 限制。
  - 任务 6 SQL 不包含 `with` CTE，包含 `histogram(__TIMESTAMP__, interval 1 day)`。
  - `git diff --check -- docs/ai-worklog.md docs/modules/04-aggregation-query-api.md docs/modules/07-cls-scheduled-sql-tasks.md` 通过。
- 中断续写入口：最终回复需说明真实 raw 结果，并按 SQL 修改输出规则贴出完整任务 6 SQL；如果要让后续新数据产生回复指标，需要修复采集侧 `messages[].direction`，历史 `unknown` 数据不能可靠回算。

### 任务：招聘人级官方曝光归因指标设计

- 时间：2026-06-18 14:46 CST
- 执行者：Codex
- 状态：文档设计中
- 目标：根据用户确认的口径，沉淀“BOSS 官方后台每天给出的岗位在候选人侧曝光数”作为核心归因指标，并明确主粒度为招聘人级、岗位级只做拆解。
- 当前理解：
  - 用户要分析的是 BOSS 官方后台曝光，不是插件采集的 `candidate_list.card_exposed`。
  - 官方曝光含义是岗位在候选人侧被展示的次数，属于平台供给/分发侧指标。
  - 因岗位之间可能有关联，且平台可能存在账号维度控制，第一版主指标应按招聘人每天聚合，岗位维度只用于贡献拆解和证据。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/superpowers/specs/2026-06-18-recruiter-official-exposure-attribution-design.md`
- 不修改范围：
  - 不修改运行代码、测试、生产 SQL、CLS 任务、飞书表结构或 Chrome 插件。
  - 不读取或修改 `analysis-system` 之外文件。
  - 不把本地规则写成确定性归因、绩效判断或候选人质量评分。
- 验证计划：
  - 文档自查：确认没有 TODO/TBD、没有把官方曝光和插件卡片曝光混用、没有生产 SearchLog 路径。
  - `git diff --check -- docs/ai-worklog.md docs/superpowers/specs/2026-06-18-recruiter-official-exposure-attribution-design.md`
- 当前状态：准备新增设计文档。

#### 阶段记录：官方曝光归因指标设计已沉淀

- 时间：2026-06-18 14:52 CST
- 状态：已完成
- 已完成：
  - 新增 `docs/superpowers/specs/2026-06-18-recruiter-official-exposure-attribution-design.md`，明确主指标为招聘人级官方岗位曝光 `official_recruiter_job_exposure_count`，岗位级 `official_job_exposure_count` 只做拆解和证据。
  - 区分 BOSS 官方候选人侧曝光与插件 `candidate_list.card_exposed`，避免后续训练标签混用。
  - 定义招聘人日级训练样本、岗位日级拆解结构、前置特征边界、解释逻辑、建模建议和非目标。
  - 明确本地系统第一版只生成事实、基线、波动和证据包，不输出确定性归因、绩效判断或候选人质量评分。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/superpowers/specs/2026-06-18-recruiter-official-exposure-attribution-design.md`
- 当前验证结果：
  - 文档自查通过：未发现 TODO/TBD；官方曝光与插件卡片曝光已明确区分；生产 SearchLog 只出现在禁止条款。
  - `git diff --check -- docs/ai-worklog.md docs/superpowers/specs/2026-06-18-recruiter-official-exposure-attribution-design.md` 通过。
- 风险/阻塞：
  - BOSS 官方接口中曝光字段的真实源字段名尚未确认；本轮不修改飞书表结构、同步代码或生产任务。
  - 当前工作区已有大量无关未提交改动，本轮未提交 commit，避免混入其它任务变更。
- 中断续写入口：下一步如果进入实现，应先确认官方岗位曝光字段名和粒度，再设计同步字段映射、训练样本构建计划和测试。

### 任务：招聘人级官方曝光实现计划

- 时间：2026-06-18 15:02 CST
- 执行者：Codex
- 状态：计划编写中
- 目标：基于已确认的招聘人级官方曝光设计，产出可执行实现计划，覆盖官方曝光字段接入、日常分析输入材料、训练样本构建、测试和文档边界。
- 当前理解：
  - 用户已同意继续推进，但在实现前需要先形成 task-by-task 计划。
  - 第一实现阶段不应直接训练复杂模型，而应先把官方曝光事实和可验证的训练样本/证据包链路打通。
  - 计划需要沿用现有官方结果同步、日常分析材料和操作员白名单边界。
- 计划修改文件：
  - `docs/ai-worklog.md`
  - `docs/superpowers/plans/2026-06-18-recruiter-official-exposure-attribution.md`
- 不修改范围：
  - 不修改运行代码、测试、生产 SQL、CLS 任务、飞书表结构或 Chrome 插件。
  - 不读取或修改 `analysis-system` 之外文件。
  - 不把本地规则写成确定性归因或绩效判断。
- 验证计划：
  - 对照设计文档做计划自查，确认实现任务覆盖主指标、岗位拆解、数据源、训练样本、输出边界和非目标。
  - `git diff --check -- docs/ai-worklog.md docs/superpowers/plans/2026-06-18-recruiter-official-exposure-attribution.md`
- 当前状态：准备阅读相关代码和测试后写计划。

#### 阶段记录：实现计划已完成

- 时间：2026-06-18 15:14 CST
- 状态：已完成
- 已完成：
  - 阅读官方结果同步、日常分析生成、日常分析材料构建和相关测试，确认实现应复用 `OfficialResultsBatch`、`model_input_packet`、`data_quality.missing_fields` 和现有 source-file 输入模式。
  - 新增 `docs/superpowers/plans/2026-06-18-recruiter-official-exposure-attribution.md`，计划分为官方曝光纯函数构建、日常分析输入包接入、14 天历史与训练特征、文档和最终验证四个任务。
  - 计划明确第一阶段只接入 fact-only 材料和训练样本，不修改飞书表结构、官方同步字段映射、生产 SQL、CLS 任务或插件。
  - 自查并修正计划里的模板化时间和省略写法，避免执行者读到占位符。
- 改动文件：
  - `docs/ai-worklog.md`
  - `docs/superpowers/plans/2026-06-18-recruiter-official-exposure-attribution.md`
- 当前验证结果：
  - `rg -n "TODO|TBD|implement later|fill in|appropriate|Similar to|YYYY|\\.\\.\\." docs/superpowers/plans/2026-06-18-recruiter-official-exposure-attribution.md` 只命中 Python 类型注解中的 `...`，未发现计划占位符。
  - `git diff --check -- docs/ai-worklog.md docs/superpowers/plans/2026-06-18-recruiter-official-exposure-attribution.md` 通过。
- 风险/阻塞：
  - 计划尚未执行；业务代码、测试和文档策略文件还未按计划修改。
  - 当前工作区已有大量无关未提交改动，本轮未提交 commit。
- 中断续写入口：按计划文件从 Task 1 开始执行，执行前继续先查看 `docs/ai-worklog.md` 和相关 diff。
