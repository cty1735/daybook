# 日账 DayBook · Web 版

> 3 秒记一笔，30 秒看懂这个月钱花在哪。

按 `产品PRO/PRD-日账-个人财务管家.md`（v1.1）实现的 MVP 闭环：**记 → 看 → 导出**。
移动端优先的单页应用，视觉严格照搬 PRD §10（薄荷绿 · 轻盈可爱）。

## 运行

```powershell
cd daybook
npm install
npm run dev      # http://localhost:5173
```

```powershell
npm run build    # 产物在 dist/（tsc -b && vite build）
npm run preview  # 本地预览构建产物
npm run lint     # oxlint
```

首次打开是一本空账（不预置示例账单，账户余额与预算也是 0）；
想查看报表效果可在 **我的 → 数据 → 载入示例数据**，随后可「清空所有记录」或「恢复出厂设置」。

## 技术栈

| 层 | 选择 |
|---|---|
| 构建 | Vite 8 + React 19 + TypeScript |
| 状态 | Zustand（`persist` 中间件 → localStorage） |
| 样式 | 原生 CSS + 设计 Token（`src/styles/tokens.css`），无 UI 框架 |
| 图表 | 自绘 SVG（环形图 / 柱状图 / 折线图 / 条形图） |
| 图标 | 自绘线性圆头 SVG 图标集（`src/icons/Icon.tsx`） |
| 后端 | 无。全部数据存本地，符合 PRD「本地优先、离线可用」 |

## 目录结构

```
src/
  main.tsx            入口
  App.tsx             应用外壳：主题 / 顶栏 / 底部 Tab / FAB / 页面栈
  nav.tsx             轻量路由（Tab + 页面栈 + URL hash 深链）
  record.tsx          「记一笔」抽屉的全局入口 + Toast/撤销
  styles/             tokens.css / base.css / components.css
  icons/Icon.tsx      线性图标集
  lib/
    types.ts          数据模型（对齐 PRD §9）
    money.ts          金额工具（内部一律「分」存储）
    date.ts           日期 / 预算周期
    select.ts         分类树 / 账户展示选择器
    stats.ts          统计、预算状态、洞察规则引擎（R1–R6）
    csv.ts            CSV 导入导出（别名容错 / 逐行报错 / 重复检测）
    backup.ts         本地每日自动备份（保留 7 份）
    seed.ts           默认分类（12 一级 + 二级 + 收入）、账户、示例数据
  store/store.ts      Zustand store + localStorage 持久化
  components/         TxRow / RecordSheet / AmountKeypad / Charts / SubPage / …
  screens/            Home / Ledger / Report / Me / Budget / Accounts / Categories / ImportExport / Recurring
```

## PRD 覆盖情况

| 编号 | 功能 | 状态 |
|---|---|---|
| F1 | 3 秒快速记账 | ✅ 自定义键盘、默认值兜底、Toast + 5 秒撤销、幂等由「完成后关闭」保证 |
| F2 | 分类体系（一级 + 二级 + 收入） | ✅ 12 个默认一级分类、20 个上限、隐藏/删除并迁移记录、12 色自动分配 |
| F3 | 账户与余额 | ✅ 6 种账户类型、余额自动扣减、信用卡已用额度、转账、余额校准 |
| F4 | 明细列表 | ✅ 按日分组合计、搜索（防抖）、时间/类型筛选、多选批量改分类/账户/删除 |
| F5 | 月度预算 | ✅ 总预算 + 分类预算、自定义起始日、三层状态、日均可用 |
| F6 | 报表与洞察 | ✅ 月/年切换、三数字卡、环形图 + 环比、日柱状/月折线、账户分布、洞察卡片 |
| F7 | 导入 / 导出 / 备份 | ✅ CSV（BOM、别名映射、逐行错误）、JSON 完整备份、模板下载、导入预览、每日快照 |
| F8 | 离线 + 本地优先 | ✅ localStorage、软删除字段预留、无网络依赖 |
| — | 深色模式 | ✅ 仅浅色 / 跟随系统 / 仅深色，PRD §10.2 深色色值 |
| F9 | 周期账单 | 🕐 占位页（v1.1 规划中） |

### 与 PRD 的两处主动偏离

1. **底部导航 4 项（首页 / 明细 / 报表 / 我的）**。PRD §5.1 写的是 3 项（明细/报表/我的），
   但 §5.2 把「首页（今日概览）」列为 L1 页面，且 F1/F5 都引用首页。为保证首页可用，保留 4 项（≤5，符合移动端导航规范）。
2. **明细的「左滑删除 / 右滑编辑」改为「点击编辑 + 多选批量」**。Web 端滑动手势体验不佳且易误触；
   编辑能力通过点击行进入抽屉实现，删除/批量能力通过多选模式实现。

## 已验证

用 Chrome DevTools Protocol 做了真机视口（320 / 360 / 430 / 768）自动化冒烟测试，覆盖：
记账 → 计数 +1 → Toast → 撤销 → 计数还原；金额 0 时「完成」置灰；9 位上限提示；
多选批量删除 → 撤销；CSV 导入（可导入 2 / 异常 1，逐行原因）；表格深链；
深色模式切换；**全部页面在 320–768 宽下无横向溢出**；控制台零报错。

## 无障碍与可用性

- 正文对比度 ≥ 4.5:1；支出用中性墨绿灰而非红色；收入用「加深绿 + 向上箭头」双编码。
- 分类、预算状态均同时有文字/图标，不单靠颜色区分（图例带图标 + 文字）。
- 键盘可达（focus-visible 描边）、触摸热区 ≥ 44px、`prefers-reduced-motion` 降级。