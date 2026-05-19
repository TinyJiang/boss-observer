# 运行方案

## MVP 拓扑

```text
CLS 原始日志主题
  -> CLS 定时 SQL 分析
     -> 分钟级汇总日志主题 / 指标主题
     -> summary-reader / summary-sync-worker
  -> Kafka 实时消费
     -> cls-consumer
     -> raw_events
     -> fact tables
  -> api-server
  -> management UI
```

MVP 使用已购买的腾讯云服务器承载应用进程，数据库使用 TencentDB for PostgreSQL。实时明细和需要重放的事实进入 PostgreSQL；分钟级、长周期、稳定口径的统计指标优先使用 CLS 定时 SQL 预聚合后的结果主题，本地系统不作为主分钟级聚合引擎。

## 进程

- `api-server`: FastAPI HTTP API。
- `cls-consumer`: 消费 CLS Kafka 日志并写入原始事件和事实表。
- `summary-reader`: 读取 CLS 定时 SQL 写入的分钟级汇总日志主题或指标主题，作为趋势、漏斗和历史指标的优先数据源。
- `summary-sync-worker`: 必要时同步 CLS 分钟汇总到 PostgreSQL 缓存，用于权限过滤、跨主题组合和前端低延迟查询。
- `aggregate-worker`: 仅用于开发样本、探索性临时口径、数据质量校验和少量 CLS SQL 不适合表达的二次计算。
- `nginx` 或 `caddy`: HTTPS 和反向代理。

## 腾讯云资源

- CLS: 插件日志主题和 Kafka 协议消费。
- CLS 定时 SQL 分析: 平台侧配置分钟级、历史和长周期指标预聚合，结果写入目标日志主题或指标主题。
- TencentDB for PostgreSQL: 主数据库。
- CVM 或轻量应用服务器: 应用运行环境。
- VPC + 安全组: 内网访问控制。
- COS: 报表导出和归档。
- CAM + KMS/凭据管理: 密钥和权限。
- 云监控 + CloudAudit: 监控和审计。

## 腾讯云产品选型

| 能力 | 腾讯云产品 | 第一版建议 |
| --- | --- | --- |
| 应用服务器 | 已购买的 CVM 或轻量应用服务器 | 运行 FastAPI API、CLS consumer、summary 读取/同步 worker 和反向代理。优先确认服务器与 CLS/PostgreSQL 在同地域。 |
| 数据库 | TencentDB for PostgreSQL | 作为主业务库，保存 `raw_events`、事实表、汇总缓存和权限数据；不要把 PostgreSQL 自建在应用服务器上。 |
| 实时日志源 | CLS Kafka 协议消费 | 从插件写入的 CLS topic 实时消费事件。 |
| 分钟级与历史汇总 | CLS 定时 SQL 分析 + 目标日志主题/指标主题 | 对操作员分钟活跃、分钟漏斗、岗位分钟趋势、聊天回复时长分布、微信获取分钟计数、日报等稳定指标，优先在 CLS 平台配置 SQL 预聚合；后端读取结果主题或同步到 PostgreSQL 缓存。 |
| 私有网络 | VPC + 子网 + 安全组 | 服务器、TencentDB、后续 CLB 尽量放同一 VPC；数据库只放通应用服务器内网访问。 |
| 对外入口 | 第一版 Caddy/Nginx 直连服务器；正式阶段 CLB + SSL 证书 | 已有单台服务器时先少买组件；需要高可用、证书托管、健康检查或多实例时加 CLB。 |
| 域名解析 | DNSPod / 云解析 DNS | 用户已有域名，第一版使用独立子域名指向服务器公网 IP；后续上 CLB 时切换到 CLB。 |
| HTTPS | Caddy 自动证书或腾讯云 SSL 证书 | 第一版可以用 Caddy 降低部署复杂度；正式阶段可迁到 CLB + 腾讯云 SSL 证书托管。 |
| 备份/导出 | TencentDB 自动备份 + COS | 数据库用 TencentDB 自动备份；报表导出、历史归档和人工下载文件放 COS。 |
| 密钥 | CAM 子用户 + KMS/凭据管理系统 | SecretId/SecretKey、数据库密码、JWT 密钥等只放服务器环境变量或凭据管理，不进入仓库。 |
| 监控告警 | 云监控 + CLS | 监控服务器、TencentDB、CLB；应用日志继续写 CLS 或本地文件采集到 CLS。 |
| 操作审计 | CloudAudit | 记录腾讯云控制台/API 操作，便于排查资源变更和密钥风险。 |
| 容器镜像 | TCR | 第一版可不用；如果采用 Docker 镜像发布，再接入 TCR 管理镜像。 |
| Web 防护 | WAF | 第一版内网/小范围访问可先不用；公网管理后台开放给多人后再接 WAF。 |

## 分阶段资源路线

MVP 最小资源：

- 已购买服务器。
- TencentDB for PostgreSQL。
- 当前 CLS topic + Kafka 协议消费。
- CLS 定时 SQL 目标日志主题或指标主题，用于分钟级和历史汇总结果。
- VPC、安全组。
- 已有域名的独立子域名和 HTTPS。
- 云监控基础告警。

正式可用阶段补充：

- COS 存放导出文件和长期归档。
- CloudAudit 开启腾讯云账号操作审计。
- KMS/凭据管理系统统一管理密钥。
- TCR 管理 Docker 镜像。

规模化或公网暴露阶段补充：

- CLB 承接 HTTPS、健康检查和后续多实例。
- WAF 防护公网管理后台。
- ClickHouse 或其他 OLAP 存储承接大规模明细分析。

## CLS 定时 SQL 使用原则

官方 CLS 文档确认定时 SQL 分析可以在控制台或 API 配置，按调度范围、调度周期和 SQL 时间窗口查询源日志主题，并把结果写入目标日志主题或指标主题。

适合放到 CLS 定时 SQL 的内容：

- 分钟级大盘指标，例如每分钟活跃操作员、最后活跃时间桶、关键动作计数。
- 操作员分钟漏斗，例如 `card -> detail -> greeting -> chat -> wechat` 各节点的分钟计数。
- 岗位分钟趋势、页面类型分钟分布、筛选动作分钟分布。
- 聊天回复时长分布、回复率和微信获取率所需的稳定中间计数。
- 操作员日报、岗位维度汇总、页面类型分布等由分钟汇总再 rollup 的指标。
- `card -> detail -> greeting -> chat -> wechat` 中已经确认口径的汇总漏斗。
- 数据健康类汇总，例如解析失败数、未知事件类型数、消费延迟分布。

当前第一批已落地的核心任务：

| 任务 | 目标主题 | 本地消费方式 | 用途 |
| --- | --- | --- | --- |
| `boss_minute_operator_funnel` | `boss_summary_minute_prod` | `minute-summary-reader` 解析为操作员分钟漏斗 | 单人 `card -> detail -> greeting -> chat -> wechat` 漏斗、岗位维度初步拆分 |
| `boss_minute_chat` | `boss_summary_minute_prod` | `minute-summary-reader` 解析为聊天分钟汇总 | 聊天打开、快照、待补采、采集失败、微信成功标记 |

仍保留在 analysis-system 内计算的内容：

- 需要候选人链路回放、跨事件保守关联或低置信身份处理的明细分析。
- 需要权限过滤、审计、敏感字段保护或多源合并的查询。
- 口径尚未稳定、需要频繁调整的探索性指标。
- 基于 CLS 分钟汇总的二次 rollup、缓存和展示层字段拼装。

约束：

- 源日志主题必须开启键值索引，且需要统计的字段要支持 SQL 分析。
- `operator_id`、`job_id` 等维度字段必须按真实类型建索引。当前真实 `operator_id` 是字符串，例如 `zhouxinyu`；如果源主题把它建成 `long`，定时 SQL 会得到 `<missing>`，本地只把它计为数据健康异常，不猜测归属。
- 定时 SQL 结果是 CLS 目标日志主题或指标主题，不是 PostgreSQL 表。
- 如前端需要关系型查询或跨主题联查，由 `summary-reader` 将汇总结果同步入库。
- 低频存储不支持 SQL 分析；需要做定时 SQL 的历史窗口应保留在标准存储或先完成预聚合。
- 任务数量、查询并发、单次结果行数、结果大小、SQL 时间窗口和调度周期都有限制，详细设计时需要按指标拆分评估。
- 官方限制中定时 SQL 支持 1 分钟到 24 小时调度周期、1 分钟到 7 天 SQL 时间窗口；平台文档也把“日志预聚合为分钟级指标数据”作为高维长周期查询的推荐场景。
- 当前设计依据：
  - 新建任务：https://cloud.tencent.com/document/product/614/78891
  - 创建定时 SQL API：https://cloud.tencent.com/document/product/614/95138
  - 数据处理限制：https://cloud.tencent.com/document/product/614/86622

## 部署原则

- 服务器、CLS 和 TencentDB 优先同地域。
- PostgreSQL 不暴露公网。
- 服务器安全组只开放必要入口。
- 域名指向服务器公网 IP；正式多实例阶段再切到 CLB。
- 所有密钥通过环境变量或云端凭据管理注入。
