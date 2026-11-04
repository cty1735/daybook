/* @daybook/shared —— 日账 DayBook 共享领域层
   前端（apps/web）与后端（apps/api）共用同一份类型、校验与业务规则。 */

export * from "./types.ts";
export * from "./money.ts";
export * from "./date.ts";
export * from "./id.ts";
export * from "./stats.ts";
export * from "./seed.ts";
export * from "./csv.ts";
export * from "./sync.ts";
// 注意：Zod 校验 schema（./schemas.ts）故意不在这里导出。
// 前端只需要类型，导出它会把整个 Zod 打进客户端 bundle（+200KB）。
// 需要运行时校验的一方（后端 / 导入校验）请用子路径：@daybook/shared/schemas