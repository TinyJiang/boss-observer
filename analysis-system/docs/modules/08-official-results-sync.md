# 官方结果数据同步

## 职责

本模块提供一次性执行入口，把 BOSS 官方后台指定日期的结果数据同步到已初始化的飞书多维表格：

- `daily_operator_result`
- `daily_operator_job_result`

调度由外部系统控制。本项目不实现定时器、cron、常驻 worker 或后台调度。

## 数据源

BOSS 官方后台招聘数据页的按天列表接口：

- 操作员日结果：`/wapi/zpboss/h5/weeklyReport4Admin/getDailyBoss.json`
- 岗位日结果：`/wapi/zpboss/h5/weeklyReport4Admin/getDailyJob.json`

接口参数：

- `dateStr`: 统计日期，格式 `YYYY-MM-DD`
- `page`: 页码
- `pageSize`: 每页数量

页面中还存在 `dailyBoss/export`、`dailyJob/export` 等导出接口；同步入口不使用导出接口作为查询源。

支持三种显式 source：

- `api`：默认模式，使用环境变量提供的 BOSS cookie 直接请求官方 JSON 接口。
- `cdp`：连接用户已启动且已登录 BOSS 的 Chrome DevTools HTTP endpoint，在 BOSS 页面内执行同源 `fetch` 调用同一组 JSON 接口；不读取 cookie、localStorage、profile 数据库或下载文件。
- `file`：开发回放模式，通过 `--source-file` 读取本地 JSON 样本。

## 飞书写入

飞书写入只使用 OpenAPI，不操作飞书 UI。目标 table id 默认值：

- `daily_operator_result`: `tbl7FU8548wp187I`
- `daily_operator_job_result`: `tbl7IizPNJdfxLup`

幂等 key：

- 操作员维度：`统计日期 + BOSS姓名 + 手机号码`
- 岗位维度：`统计日期 + 职位名称 + 职位发布人 + 发布人手机号`

执行时先读取目标表已有记录，按业务 key 命中则 update，否则 create。

## 字段映射

操作员维度按天字段：

- `bossName` -> `BOSS姓名`
- `phoneDesc` -> `手机号码`
- `companyDesc` -> `所属公司`
- `groupDesc` -> `所在分组`
- `certJobDesc` -> `认证职务`
- `companyEmail` -> `企业邮箱`
- `detailGeek` -> `BOSS查看牛人`
- `activeAdd` -> `BOSS发起聊天`
- `communication` -> `BOSS沟通`
- `detailBoss` -> `牛人查看BOSS`
- `passiveAdd` -> `牛人发起聊天`
- `resumeAccept` -> `收获简历`
- `contactAccept` -> `交换电话微信`
- `interviewAccept` -> `接受面试`

岗位维度按天字段在操作员字段基础上增加：

- `jobDesc` -> `职位名称`
- 发布人相关字段写入 `发布人*` 字段。

采集侧会保留未写入飞书的额外源字段到 `extra_source_fields`，用于后续确认字段后扩展；当前不会擅自新增未经确认的飞书字段。

## 执行入口

日常手动同步命令：

```bash
./sync-official-results.sh 2026-06-15
```

该命令固定使用 CDP 源采集 BOSS 官方结果，并在同一次进程内上传飞书。需要先预演时使用：

```bash
./sync-official-results.sh 2026-06-15 --dry-run
```

底层通用入口：

```bash
python3 -m boss_analysis.ops.sync_official_results --date 2026-06-15 --dry-run
```

未传 `--date` 时，按 `APP_TIMEZONE` 或 `--timezone` 解析“昨天”。dry-run 只输出新增/更新数量、缺字段名和未匹配数量，不输出真实记录行。

CDP 源示例：

```bash
python3 -m boss_analysis.ops.sync_official_results \
  --source cdp \
  --cdp-url http://127.0.0.1:9222 \
  --date 2026-06-15 \
  --dry-run
```

## 配置

通过环境变量或 `.env.local` 注入：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_BITABLE_APP_TOKEN`
- `FEISHU_BITABLE_WIKI_NODE_TOKEN`
- `FEISHU_DAILY_OPERATOR_RESULT_TABLE_ID`
- `FEISHU_DAILY_OPERATOR_JOB_RESULT_TABLE_ID`
- `BOSS_OFFICIAL_RESULTS_COOKIE`
- `BOSS_OFFICIAL_RESULTS_CDP_URL`
- `BOSS_OFFICIAL_RESULTS_BASE_URL`
- `BOSS_OFFICIAL_RESULTS_PAGE_SIZE`
- `BOSS_OFFICIAL_RESULTS_MAX_PAGES`

真实 app secret、tenant token、cookie、session 和 BOSS 登录态不得写入代码、日志或测试快照。

## 非目标

- 不初始化或修改飞书表结构。
- 不通过 Chrome/Computer Use/飞书页面 UI 初始化或编辑表结构。
- 不使用 BOSS 导出下载文件作为同步源。
- 不实现采集调度。
- 不做波动归因、贡献度、置信度排序或员工绩效判断。
