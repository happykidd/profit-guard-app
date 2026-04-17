# Profit Guard App 代码库审查报告

- 生成时间：2026-04-16
- 审查范围：`profit-guard-app` 整个 monorepo
- 审查方法：按层查看仓库结构、Prisma Schema、核心 service / route / worker 实现，并补充执行 `pnpm typecheck`、`pnpm test`、`pnpm lint`

## 一、总体结论

`profit-guard-app` 的整体形态是健康的，已经不是简单原型，而是一个边界相对清晰、业务模型较完整的 Shopify 嵌入式应用。当前代码库采用 monorepo 结构：`apps/web` 负责管理后台和 webhook，`apps/worker` 负责回填、指标计算、告警生成和 digest 投递，`packages/db` 负责 Prisma schema 与共享数据辅助逻辑。这个分层方向是对的。

目前最主要的问题不在于“功能缺失”，而在于“生产级稳健性”和“后续扩展性”。优先级最高的风险包括：webhook 失败后仍返回 200 导致 Shopify 不再重试、`/health` 路由未鉴权却暴露内部状态、worker 直接依赖 web 侧运行时实现、daily metrics 采用全量内存重建方式、以及若干高频查询没有与实际访问模式匹配的复合索引。

## 二、架构概览

### 1. Monorepo 分层

- `apps/web`：React Router 7 + Shopify embedded app，负责路由、页面、action/loader、服务层、报表导出、webhook 处理。
- `apps/worker`：后台轮询 worker，负责同步任务消费、Shopify 数据回填、daily metrics 重建、alert 生成、digest 调度与发送。
- `packages/db`：Prisma schema、数据库 client，以及成本匹配相关的共享 helper。

### 2. 当前做得好的地方

- 数据模型设计比较成熟，尤其是订阅、同步任务、告警、报表、digest、成本治理这几块，schema 已经体现出完整业务意图，唯一约束和枚举也比较扎实。
- 报表链路具备降级能力。AI 叙述生成失败时，并不会让整条功能不可用，而是回落到确定性的 fallback summary，这种处理对线上稳定性很重要。
- worker 侧的核心领域逻辑已有针对性测试，覆盖了成本解析、指标计算、digest 时间判定、告警评估等关键路径。
- 从当前自动化结果来看，仓库基础质量状态良好：`pnpm typecheck`、`pnpm test`、`pnpm lint` 在本次审查中都通过了。

## 三、核心发现

### 发现 1：webhook 失败时仍然返回 200，Shopify 重试会被吞掉

- **Location**: `apps/web/app/routes/webhooks.app.scopes_update.tsx:28-36`, `apps/web/app/routes/webhooks.app.subscriptions_update.tsx:30-46`, `apps/web/app/routes/webhooks.app.uninstalled.tsx:29-49`, `apps/web/app/routes/webhooks.shop.update.tsx:28-36`
- **Category**: scope
- **Severity**: 严重
- **Title**: webhook 失败路径被当作成功确认，导致上游不会重试
- **Description**: 这几条 webhook 路由在 `catch` 中会把本地 `webhookEvent` 标记为失败，但最终仍然返回 `new Response()`，默认状态码是 200。对于 Shopify 来说，这意味着 webhook 已被成功处理，因此即使本地数据库、账单同步或店铺状态更新失败，Shopify 也不会再重试。结果是系统状态可能永久不一致，而且只能依赖人工修复。
- **Suggestion**: 在记录失败状态后返回 `500`，或直接重新抛出异常，让 Shopify 保留重试机会。当前的去重逻辑 `recordWebhookReceipt` 可以继续保留，但需要把“重复已处理”和“处理失败应重试”区分开。

### 发现 2：`/health` 路由未鉴权，却暴露了内部环境和运行状态

- **Location**: `apps/web/app/routes/health.tsx:3-8`, `apps/web/app/services/health.server.ts:43-63`, `apps/web/app/services/health.server.ts:68-85`
- **Category**: scope
- **Severity**: 主要
- **Title**: 公共健康检查接口暴露了过多内部信息
- **Description**: `/health` 当前不需要 `authenticate.admin`，也没有 token 或 shared secret 校验，却返回了环境名、队列数量、webhook 计数、邮件能力和配置是否存在等内部状态。它对运维很有用，但对外暴露这些细节，会给未授权调用者提供一份轻量级运行态画像。
- **Suggestion**: 将健康检查拆成两层。公开路由只保留最小 liveness 信息，例如 `status: ok`；更完整的 readiness / diagnostics 输出放到受保护路由，或要求环境密钥访问。

### 发现 3：worker 直接依赖 web 侧运行时，边界被打穿

- **Location**: `apps/worker/src/index.ts:1-5`, `apps/worker/src/services/shopify-sync.ts:1-3`, `apps/web/app/shopify.server.ts:20-70`
- **Category**: scope
- **Severity**: 主要
- **Title**: 后台任务对 web 应用内部实现存在强耦合
- **Description**: worker 当前直接从 `apps/web` 导入 `isEmailDeliveryReady`，并且通过 `../../../web/app/shopify.server` 获取 Shopify 访问能力。这说明 worker 并没有依赖一个独立的“平台层”或“集成层”，而是直接依赖 web 应用自己的运行时装配。短期内可以工作，但长期会影响部署独立性、测试清晰度和模块边界稳定性。
- **Suggestion**: 把 Shopify client、session 访问、邮件能力探测等逻辑提取到共享包，例如 `packages/platform` 或 `packages/integrations`。web 和 worker 都依赖共享适配层，而不是互相跨应用导入。

### 发现 4：daily metrics 采用全量加载 + 全量重建，扩展性风险较大

- **Location**: `apps/worker/src/services/daily-metrics.ts:40-108`, `apps/worker/src/services/daily-metrics.ts:115-273`
- **Category**: scope
- **Severity**: 主要
- **Title**: 指标重建方案在订单规模上来后会成为明显瓶颈
- **Description**: `rebuildDailyMetrics` 会一次性读取某个 shop 的全部已处理订单及其 line items，在内存中生成完整 bundle，然后在一个事务里删除并重建所有受影响日期的聚合数据，最后再触发 alert 同步。这个实现对早期数据量是可行的，但在订单变多后会面临内存压力、长事务、锁竞争和重建窗口过大的问题。
- **Suggestion**: 改成增量重建。一个现实的下一步是仅重算本次 backfill 触达的日期窗口，或按 cursor / date bucket 逐段更新；把“全量重建”保留为显式维护任务，而不是默认同步路径。

### 发现 5：首页 dashboard 的读取路径夹带了外部请求和数据库写入

- **Location**: `apps/web/app/routes/app._index.tsx:67-155`, `apps/web/app/services/billing.server.ts:222-334`
- **Category**: scope
- **Severity**: 主要
- **Title**: Dashboard 首屏加载与 Shopify billing 同步强绑定
- **Description**: `/app` 的 loader 每次都会执行 `billing.check()`，随后立刻调用 `syncBillingState()` 把结果写回数据库。这样一个普通的 GET 页面请求就同时依赖外部网络调用和本地事务写入，会拉长首页响应时间，也扩大首屏故障面。更重要的是，读路径被做成了写路径，后续缓存和可观测性也会变复杂。
- **Suggestion**: 将 billing 同步尽量转为 webhook 驱动或后台异步刷新。Dashboard 只在缓存过期、用户显式触发，或 webhook 尚未完成对账时再做补充同步，而不是每次打开页面都强制写入。

### 发现 6：若干高频查询缺少与访问模式匹配的复合索引

- **Location**: `apps/worker/src/services/sync-runner.ts:69-83`, `apps/web/app/services/alerts.server.ts:359-439`, `packages/db/prisma/schema.prisma:271-288`, `packages/db/prisma/schema.prisma:741-816`
- **Category**: scope
- **Severity**: 次要
- **Title**: 队列与告警列表在数据增长后容易过早退化
- **Description**: worker 的 claim 逻辑按 `status=QUEUED` 过滤，并按 `createdAt` 排序取下一条任务，但 `SyncRun` 只有 `(shopId, runType, status)` 和 `createdAt` 的索引，没有直接匹配“按状态抢占最早任务”的组合索引。类似地，alert thread 列表按 `(shopId, isOpen)` 过滤，却按 `lastDetectedAt` 排序；active alert 列表则按 `rankScore` 和 `detectedForDate` 排序，schema 中也没有明显覆盖这条访问路径的索引。这一条是基于当前 Prisma 查询和 schema 的推断，但在数据量上升时很可能变成真实性能问题。
- **Suggestion**: 按实际查询模式补复合索引，例如 `SyncRun(status, createdAt)`、`AlertThread(shopId, isOpen, lastDetectedAt)`，以及针对 active alerts 排序模式补充面向 rank / date 的索引。

### 发现 7：多个核心业务文件已经明显过大，维护成本正在上升

- **Location**: `apps/web/app/services/cost-import.server.ts:175-2098`, `apps/web/app/services/reports.server.ts:740-1818`, `apps/web/app/services/alerts.server.ts:344-1085`, `apps/web/app/routes/app.costs.tsx:118-1304`, `apps/web/app/routes/app.alerts.tsx:76-993`
- **Category**: scope
- **Severity**: 次要
- **Title**: 超大文件导致职责堆叠，改动波及面越来越大
- **Description**: 成本导入、报表、告警这几条主业务链路，已经在单文件中同时承担了请求解析、校验、数据库写入、导出渲染、业务编排和 UI 组合等多种职责。当前代码仍然可读，但已经跨过“一个文件承载太多变化原因”的阈值。随着功能继续增长，评审成本、回归风险和重构难度都会继续上升。
- **Suggestion**: 逐步按用例拆分，而不是一次性大重构。比如把 CSV 解析 / 校验从导入持久化里拆开，把报表快照生成与导出渲染拆开，把 route 中的 intent 分发逻辑下沉到更小的 action helper。

## 四、分模块观察

### `packages/db`

- 这是当前代码库里结构最稳的一层。
- schema 已经能很好地表达订阅、回填、告警、报表、digest、成本治理等核心业务。
- 下一阶段最值得投入的是“查询模式与索引对齐”，而不是继续单纯扩表。

### `apps/web`

- 已经承载了比较完整的 merchant 运维工作流，不是简单的 CRUD 页面。
- 服务层概念上是存在的，但不少功能已经长成“路由 + 服务双大文件”的形态，HTTP 处理、业务编排和展示逻辑开始混在一起。
- 当前最需要优先处理的是 webhook 可靠性和诊断接口暴露问题。

### `apps/worker`

- 同步编排流程本身是清楚的，阅读路径也比较顺。
- 当前最大隐患不是“小数据量下跑不通”，而是“大数据量下扩不动”。
- 一旦把共享集成边界抽出来，再把 metrics 重建改为增量式，worker 这一层会稳定很多。

## 五、建议处理优先级

1. 先修 webhook 失败返回 200 的问题，恢复 Shopify 重试语义。
2. 收紧 `/health`，拆分公开 liveness 和内部 readiness。
3. 抽离共享平台/集成层，去掉 worker 对 `apps/web` 的跨应用依赖。
4. 改造 daily metrics 为增量重建，并补上队列 / 告警相关复合索引。
5. 结合后续需求开发，逐步拆分最大的 route / service 文件，避免一次性大重构。

## 六、已执行验证

- `pnpm typecheck`：通过
- `pnpm test`：通过
- `pnpm lint`：通过

