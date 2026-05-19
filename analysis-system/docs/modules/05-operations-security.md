# 运行、安全与运维

## 职责

本模块描述配置、凭据、部署、监控、审计和敏感数据保护边界。

代码归属：

- `src/boss_analysis/api/`
- `src/boss_analysis/consumer/`
- `src/boss_analysis/workers/`
- `src/boss_analysis/storage/`
- 部署脚本和环境示例文件

## 配置原则

- 所有配置通过环境变量、容器编排或云端凭据管理注入。
- 不提交 SecretId、SecretKey、数据库密码、JWT 密钥或完整连接串。
- 本地开发使用 `.env.example` 说明变量名，不写真实值。

建议配置类别：

- 数据库连接。
- CLS Kafka hosts、topic、logset id。
- CLS 访问凭据引用。
- API 认证配置。
- 日志级别和结构化日志开关。
- 敏感字段访问开关。

## 进程角色

- `api-server`: FastAPI HTTP 服务。
- `cls-consumer`: CLS 实时消费。
- `summary-reader`: 查询 CLS 分钟级汇总日志主题或指标主题。
- `summary-sync-worker`: 按需把 CLS 分钟汇总同步到本地缓存。
- `aggregate-worker`: 仅处理本地样本、探索性补充和数据质量校验，不作为生产分钟级聚合主链路。
- `replay-worker`: 手动补数和 parser 修复后重放。

第一版可以共用同一代码包，通过启动命令选择角色。

## 云资源操作

涉及真实云资源时必须先说明：

- 要访问的 CLS 日志集和日志主题。
- 要创建或修改的 CLS 定时 SQL 任务、目标日志主题或指标主题。
- 要写入或查询的数据库。
- 使用的 CAM 权限。
- 是否会产生费用或修改生产数据。
- 回滚方式和审计方式。

得到用户明确确认后才能执行。

## 监控与审计

必须能观察：

- consumer 是否存活。
- Kafka offset 或消费延迟。
- 原始事件写入成功率。
- parse_status 分布。
- projector 错误数量。
- API 错误率和慢查询。
- CLS 定时 SQL 任务最后成功时间、调度延迟、失败次数和目标主题写入量。
- summary 同步任务最后成功时间、同步延迟和重复/缺失窗口数量。

关键管理操作需要记录审计日志，包括重放、导出、敏感数据查看和配置变更。

## 敏感数据保护

- 默认不在 API 返回聊天正文、联系方式和完整简历正文。
- 结构化日志不得打印完整 `payload_json` 或 `context_json`。
- 错误表中的 preview 需要截断，并避免包含完整联系方式。
- 导出任务必须区分普通报表和敏感数据导出。

## 本地开发验证

- 优先使用离线样本和本地测试。
- 不依赖真实 BOSS 页面、Chrome 插件运行时或 CLS 在线服务。
- 需要数据库时优先使用临时实例或容器，测试结束后清理。
