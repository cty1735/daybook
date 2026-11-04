/* 运行期配置：全部可用环境变量覆盖，默认值面向本地开发 */

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return v !== "0" && v.toLowerCase() !== "false";
}

const DEFAULT_WEB_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

/**
 * 开发期便利开关：会把密码重置令牌等敏感信息随响应返回，
 * 便于本地无 SMTP 的情况下跑通找回密码闭环。生产务必设为 0。
 * （旧变量名 EXPOSE_DEV_OTP 仍兼容）
 */
const exposeDevAuth = bool(
  process.env.EXPOSE_DEV_AUTH ?? process.env.EXPOSE_DEV_OTP,
  process.env.NODE_ENV !== "production",
);

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: process.env.NODE_ENV === "production",
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3001),

  /** SQLite 文件位置（libSQL）；生产建议挂载到独立数据卷 */
  databaseUrl: process.env.DATABASE_URL ?? "file:./data/daybook.sqlite",

  /** better-auth 签名密钥；生产必须设置 */
  authSecret: process.env.BETTER_AUTH_SECRET ?? "dev-only-insecure-secret-change-me-in-production",
  /** 后端自身对外基址（用于生成回调/验证链接） */
  baseUrl: process.env.BETTER_AUTH_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3001}`,

  /** 允许的前端来源（CORS + better-auth trustedOrigins） */
  webOrigins: (process.env.WEB_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? DEFAULT_WEB_ORIGINS),

  /** 开发期便利开关（找回密码令牌等）；生产必须关闭 */
  exposeDevAuth,
  /** @deprecated 兼容旧名字，等同 exposeDevAuth */
  exposeDevOtp: exposeDevAuth,

  /** 单用户单次 push 的最大变更条数 */
  maxPushBatch: Number(process.env.MAX_PUSH_BATCH ?? 2000),
} as const;

export function assertProdConfig(): void {
  if (!env.isProd) return;
  if (env.authSecret.startsWith("dev-only")) {
    throw new Error("生产环境必须设置 BETTER_AUTH_SECRET");
  }
  if (env.exposeDevAuth) {
    throw new Error("生产环境必须设置 EXPOSE_DEV_AUTH=0");
  }
}
