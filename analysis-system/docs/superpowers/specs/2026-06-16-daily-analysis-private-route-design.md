# 日常分析隐藏入口设计

- 日期：2026-06-16
- 状态：已确认
- 范围：React 前端入口与静态测试

## 目标

`日常分析` 功能尚未正式上线，因此不出现在左侧主菜单中；保留一个独立访问路径供内部测试。

默认独立路径为：

```text
/daily-analysis
```

## 设计

- 左侧导航移除 `日常分析` 按钮。
- 根路径 `/` 仍默认显示实时大盘，其他已上线菜单保持不变。
- 当前浏览器路径为 `/daily-analysis` 时，主区域直接渲染 `DailyAnalysisTab`。
- 不引入 React Router；第一版用 `window.location.pathname` 做轻量分支，避免为一个隐藏测试入口扩大前端结构。
- `/api/daily-analysis` 后端接口保持不变。

## 验证

- 静态测试确认源码中仍保留 `/daily-analysis` 和 `DailyAnalysisTab`。
- 静态测试确认源码中不存在菜单点击 `setActiveTab("dailyAnalysis")`。
- 前端构建通过。
