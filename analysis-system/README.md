# BOSS Analysis System

后端分析系统是独立子项目，用于消费 CLS 中的招聘事实事件，落库、关联、聚合并提供查询和报表能力。

## 边界

分析系统把 Chrome 插件视为外部日志生产者。二者之间唯一稳定契约是根项目的日志规范：

- `../docs/modules/12-log-specification.md`

允许依赖：

- CLS 中符合日志规范的扁平字段。
- `payload_json` 和 `context_json` 中按日志规范定义的 JSON 内容。
- 腾讯云基础设施，例如 CLS Kafka、TencentDB for PostgreSQL、COS、CAM/KMS。

禁止依赖：

- `../extension/` 下任何源码、测试、构建产物或浏览器运行时状态。
- 插件 debug 页、popup Profile、Chrome storage 作为生产数据源。
- BOSS 页面 DOM、URL 探针或前台内部 helper。
- 前台未写入日志规范的临时字段。

如果分析系统需要新增字段，先更新日志规范，再由插件按契约生产；分析系统只能消费新契约，不能绕过契约读取前台内部实现。

## 第一版技术栈

- Python 3.11+
- FastAPI
- PostgreSQL / TencentDB for PostgreSQL
- SQLAlchemy + Alembic
- Pydantic
- CLS Kafka consumer
- Docker Compose on the existing Tencent Cloud server

当前目录只放分析系统自身代码、配置和文档。根项目 `extension/` 仍然是 Chrome 插件子项目，两个子项目不共享运行时代码。

## 目录

```text
analysis-system/
  AGENTS.md
  README.md
  pyproject.toml
  .env.example
  docs/
    ai-worklog.md
    boundary.md
    overview-design.md
    runtime-plan.md
    modules/
  src/
    boss_analysis/
      api/
      consumer/
      domain/
      storage/
      workers/
  tests/
```

## 开发约定

- 每次实质工作前先查看并更新 `docs/ai-worklog.md`。
- 总览设计入口是 `docs/overview-design.md`。
- 模块级设计放在 `docs/modules/`，父项目文档只作为契约和背景参考。
- 所有生产配置走环境变量或云端凭据管理。
- 不提交 SecretId、SecretKey、数据库密码、JWT 密钥或完整连接串。
- 所有外部输入先落原始事件表，再解析到事实表。
- 所有事实表写入必须以 `event_id` 或链路事件 ID 幂等。
- 默认不展示聊天正文、联系方式和完整简历正文。

## 本地一键开发

默认使用 CLS 定时 SQL 写入的分钟汇总启动后端和前端，不查询原始 raw 日志：

```bash
./dev.sh
```

`dev.sh` 默认要求真实汇总数据并禁用 demo fallback；只有显式把 `BOSS_ANALYSIS_DATA_SOURCE=demo` 时才会使用演示数据。

默认地址：

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:8765`

常用覆盖项：

```bash
BOSS_ANALYSIS_DATA_SOURCE=summary \
./dev.sh
```

本地只看 mock 数据时可以显式切回 demo：

```bash
BOSS_ANALYSIS_DATA_SOURCE=demo \
BOSS_ANALYSIS_REQUIRE_REAL_DATA=0 \
./dev.sh
```

可调端口和代理目标：

```bash
BOSS_ANALYSIS_BACKEND_PORT=8766 \
BOSS_ANALYSIS_FRONTEND_PORT=5174 \
./dev.sh
```

`dev.sh` 会把后端和前端作为后台进程启动，并把运行状态写到 `.dev/`：

- pid 文件：`.dev/backend.pid`、`.dev/frontend.pid`
- 日志文件：`.dev/backend.log`、`.dev/frontend.log`

停止和重启：

```bash
./stop.sh
./restart.sh
```

脚本不会写入或读取真实密钥，真实 CLS 配置仍通过环境变量、`.env` 或 `.env.local` 提供。默认 `summary` 需要配置 `CLS_SUMMARY_TOPIC_ID` 和腾讯云凭据；如果缺少分钟汇总配置，后端会直接报错，而不是回退去查原始日志。

## 本地真实数据接入

本地 dev 后端支持两种真实数据入口。

读取 CLS 或插件导出的 JSON/JSONL 文件：

```bash
cd src
python3 -m boss_analysis.dev_server \
  --host 127.0.0.1 \
  --port 8765 \
  --data-source file \
  --data-file /path/to/export.jsonl \
  --require-real-data
```

直接读取腾讯云 CLS 定时 SQL 分钟汇总：

```bash
export TENCENTCLOUD_SECRET_ID=...
export TENCENTCLOUD_SECRET_KEY=...
export CLS_SUMMARY_REGION=ap-guangzhou
export CLS_SUMMARY_TOPIC_ID=... # boss_summary_minute_prod
export CLS_SUMMARY_WINDOW_MINUTES=today
export BOSS_ANALYSIS_OPERATOR_CONFIG_FILE=config/operators.local.json

python3 -m boss_analysis.dev_server \
  --host 127.0.0.1 \
  --port 8765 \
  --data-source summary \
  --require-real-data
```

真实密钥只放环境变量或服务器凭据管理，不写入仓库。前端通过 `/api/dashboard` 的 `source` 和 `summary_source` 字段显示当前读取的是演示数据、真实文件还是 CLS 分钟汇总。
本地也可以把这些变量放在 `analysis-system/.env` 或 `analysis-system/.env.local`，dev server 启动时会自动读取；环境变量已存在时不会被 `.env` 覆盖。

本地 dev 后端读取 CLS 定时 SQL 写入的分钟汇总主题，例如 `boss_summary_minute_prod`。默认 `CLS_SUMMARY_WINDOW_MINUTES=today`，按 `APP_TIMEZONE` 从当天 00:00 读取到当前时间，避免滚动 24 小时把昨天数据带入今天；如果需要局部调试，可以显式填写数字分钟窗口。当前代码识别第一批核心任务：

- `boss_minute_operator_funnel`
- `boss_minute_chat`
- `boss_10min_log_quality`

`summary` 模式只使用分钟汇总结果生成活跃状态、单人漏斗和聊天指标，不查询原始 raw 日志。若汇总结果中 `operator_id` 是 `<missing>`，前端会把它计入“流水线异常”，用于提示源主题索引类型或 SQL 字段配置问题。
如果配置 `BOSS_ANALYSIS_LOG_QUALITY_DATA_FILE` 或 `CLS_LOG_QUALITY_TOPIC_ID`，前端数据质量区域会展示 10 分钟日志质量状态、插件版本维度和事件类型问题排行。`CLS_LOG_QUALITY_TOPIC_ID` 只用于本地开发读取定时 SQL 目标 topic；生产同步仍需走批准的非 SearchLog 链路。

## 本地操作员列表

本地 dev 默认读取 `config/operators.local.json`，该文件被 git ignore，可以直接按需改：

```json
{
  "operators": [
    {
      "operatorId": "zhouxinyu",
      "displayName": "zhouxinyu",
      "accountName": "谢女士",
      "enabled": true,
      "role": "招聘操作员",
      "note": "operatorId 必须与 CLS 日志 operator_id 完全一致"
    }
  ]
}
```

页面每次请求 `/api/dashboard` 都会按文件修改时间热加载操作员配置；修改这个文件后刷新页面即可生效，不需要重启 dev server。`config/operators.example.json` 是可提交模板，真实本地名单放 `config/operators.local.json`。
