# 招聘人级官方曝光归因指标设计

## 背景

本设计沉淀“平台给的候选人曝光”口径。这里的曝光不是插件在候选人列表中观察到的卡片曝光，而是 BOSS 官方后台每天给出的岗位在候选人侧曝光次数。

这个指标位于招聘链路最上游，表达平台给某个招聘账号及其岗位组合分配了多少候选人侧展示机会。它应作为供给和分发侧核心指标，不应和招聘人主动浏览候选人列表的行为指标混用。

## 已确认决策

- 主指标使用招聘人级官方曝光，而不是岗位级作为第一归因主粒度。
- 岗位之间可能互相影响，平台也可能存在账号维度控制，因此第一版先看账号/招聘人整体曝光池。
- 岗位级数据保留为拆解维度，用于解释招聘人总曝光变化由哪些岗位贡献。
- 插件侧 `candidate_list.card_exposed` 只表示招聘人看到了多少候选人卡片，可作为行为链路或日志健康证据，不能替代官方曝光标签。

## 指标定义

### 主指标

```text
metric_name: official_recruiter_job_exposure_count
grain: date + operator_id
source: BOSS 官方后台日结果
meaning: 某招聘人在某天名下所有岗位在候选人侧获得的官方曝光总次数
```

`operator_id` 来自分析系统操作员配置与官方结果中的 BOSS 姓名、账号名、手机号或别名映射。无法稳定映射的官方结果不得进入训练样本。

### 岗位拆解指标

```text
metric_name: official_job_exposure_count
grain: date + operator_id + job_id/job_key
source: BOSS 官方后台岗位日结果
meaning: 某招聘人名下某岗位在某天获得的官方候选人侧曝光次数
```

如果官方结果当前只给岗位名称和发布人，暂时使用 `operator_id + job_name` 生成 `job_key` 做分析键；待官方接口或同步表提供稳定岗位 ID 后再升级。低置信岗位键只能用于趋势和拆解，不用于跨长周期强合并。

### 派生拆解字段

```text
job_share_of_recruiter_exposure = official_job_exposure_count / official_recruiter_job_exposure_count
job_exposure_delta = current_job_exposure - baseline_job_exposure
job_contribution_to_recruiter_delta = job_exposure_delta / recruiter_exposure_delta
```

当招聘人总曝光变化接近 0 时，不计算贡献率，只展示岗位间分配变化。

## 数据来源

第一优先级是官方结果同步后的事实表或离线文件：

- 操作员日结果：用于招聘人总量、账号维度指标和官方字段兜底。
- 岗位日结果：用于岗位级曝光拆解和岗位组合特征。

当前 `docs/modules/08-official-results-sync.md` 已定义官方结果同步边界，但官方曝光字段的源字段名还需要在真实 BOSS 接口响应中确认。字段未确认前，设计上只定义目标语义，不修改飞书表结构、同步代码或生产任务。

可作为前置特征的数据必须满足“决策前已知”：

- 前 1 天、7 天、14 天的官方曝光基线。
- 前 1 天、7 天、14 天的招聘人行为事实，例如活跃分钟、详情打开、打招呼、聊天打开、回复、微信获取。
- 前 1 天、7 天、14 天的岗位组合事实，例如活跃岗位数、新发岗位数、关闭岗位数、岗位薪资区间、城市和职类分布。
- 日期特征，例如星期几、节假日、工作日序号。

同一天标签发生之后才知道的行为不得作为预测或归因训练特征，避免数据泄漏。

## 训练样本结构

### 招聘人日级样本

```text
recruiter_daily_exposure_features
- active_date
- operator_id
- official_recruiter_job_exposure_count
- exposure_baseline_1d
- exposure_baseline_7d_avg
- exposure_baseline_14d_avg
- exposure_delta_vs_7d_avg
- exposure_delta_pct_vs_7d_avg
- active_job_count
- new_job_count_7d
- closed_job_count_7d
- refreshed_job_count_7d
- job_mix_features
- lagged_behavior_features_1d
- lagged_behavior_features_7d
- lagged_behavior_features_14d
- calendar_features
- data_quality_flags
```

第一版标签可以同时保留两种形态：

- `official_recruiter_job_exposure_count`：用于计数预测。
- `log1p(official_recruiter_job_exposure_count)` 或相对 7/14 天基线的变化率：用于波动解释。

### 招聘人岗位日级拆解

```text
recruiter_job_daily_exposure_breakdown
- active_date
- operator_id
- job_key
- official_job_exposure_count
- job_share_of_recruiter_exposure
- job_exposure_baseline_7d_avg
- job_exposure_delta
- job_contribution_to_recruiter_delta
- job_status_features
- job_content_features
- data_quality_flags
```

该结构服务拆解和证据，不作为第一版主训练表。

## 归因输出边界

本地系统第一版只应生成事实、基线、波动和证据包，不直接输出确定性原因、贡献结论或置信度排序。模型或人工复盘可以基于证据生成“可能相关因素”，但表达必须保守。

推荐输出表达：

```text
招聘人总曝光下降主要发生在账号整体层面，多个岗位同步下降，优先排查账号活跃、历史响应、平台整体流量或账号权重变化。
```

```text
招聘人总曝光下降集中在 X 岗位，该岗位贡献了大部分下降，优先排查岗位状态、刷新、薪资竞争力和岗位内容变化。
```

禁止输出：

```text
确定是平台限流。
确定是招聘人表现差。
确定是岗位质量低。
```

## 第一版解释逻辑

第一层回答招聘人总曝光为什么变化：

- 与昨天、上周同日、7 日均值、14 日均值比较。
- 判断变化是否超过低样本阈值。
- 对比前置行为、岗位数量、岗位组合和日期特征是否同步变化。
- 判断变化更像账号整体、日期平台、岗位组合还是单岗位集中。

第二层回答岗位如何贡献招聘人总曝光变化：

- 所有主要岗位同步下降：偏账号级、平台流量或日期因素。
- 单个或少数岗位集中下降：偏岗位级因素。
- 总曝光基本不变但岗位份额迁移：偏岗位组合内部重新分发。
- 新岗位吸走旧岗位份额：记录为岗位组合变化，不直接判断好坏。

## 建模建议

第一阶段先做波动解释和预测辅助，不做强因果归因。

可选模型：

- 计数模型：Poisson、Negative Binomial 或基于 `log1p` 标签的回归模型。
- 非线性模型：GBDT / XGBoost / LightGBM，用于捕获岗位组合和账号行为的非线性关系。
- 分层模型：加入招聘人、城市、职类、星期几等固定效应，减少账号和行业差异带来的混杂。

验证方式：

- 使用时间切分，不能随机切分。
- 按招聘人、城市、岗位类型分层看稳定性。
- 看高预测下降风险组与低风险组的实际曝光变化差异。
- 因子方向必须跨周期稳定，不能只看单日相关性。

只有在有明确干预数据、A/B 实验、自然实验或足够强的准实验设计时，才可以把结果升级为更强的因果归因。

## 非目标

- 不修改 Chrome 插件采集逻辑。
- 不把插件候选人卡片曝光当成官方曝光。
- 不修改飞书表结构、官方同步代码、生产 SQL 或 CLS 任务。
- 不在生产链路中使用 CLS Search/SearchLog 补齐训练样本。
- 不采集聊天正文、联系方式或完整简历正文。
- 不输出员工绩效判断、候选人质量评分或岗位质量结论。

## 后续待确认

- BOSS 官方接口中“岗位在候选人侧曝光”的真实字段名。
- 该字段是否同时存在于操作员日结果和岗位日结果。
- 岗位级官方结果是否提供稳定岗位 ID；如果没有，第一版 `job_key` 的低置信规则需要在实现计划中明确。
- 飞书现有表是否需要新增官方曝光字段；如果需要，应单独设计同步字段映射和迁移步骤。
