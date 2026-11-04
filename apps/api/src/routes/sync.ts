import { SyncPullQuerySchema, SyncPushRequestSchema } from "@daybook/shared/schemas";
import { Hono } from "hono";
import { env } from "../env.ts";
import { getSessionUser } from "../lib/session.ts";
import { pullChanges, pushChanges, touchDevice } from "../lib/sync-service.ts";

export const syncRoutes = new Hono();

syncRoutes.post("/push", async (c) => {
  const user = await getSessionUser(c.req.raw.headers);
  if (!user) return c.json({ message: "未登录" }, 401);

  const raw = await c.req.json().catch(() => null);
  const parsed = SyncPushRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ message: "参数不合法", issues: parsed.error.issues.slice(0, 10) }, 400);
  }
  if (parsed.data.transactions.length > env.maxPushBatch) {
    return c.json({ message: `单次推送最多 ${env.maxPushBatch} 条` }, 413);
  }

  const result = await pushChanges({
    userId: user.id,
    deviceId: parsed.data.deviceId,
    transactions: parsed.data.transactions,
    state: parsed.data.state,
  });
  return c.json(result);
});

syncRoutes.get("/pull", async (c) => {
  const user = await getSessionUser(c.req.raw.headers);
  if (!user) return c.json({ message: "未登录" }, 401);

  const parsed = SyncPullQuerySchema.safeParse({
    cursor: c.req.query("cursor") ?? 0,
    limit: c.req.query("limit") ?? 500,
    limitState: c.req.query("limitState") ?? 1,
  });
  if (!parsed.success) return c.json({ message: "参数不合法", issues: parsed.error.issues }, 400);

  const { cursor, limit, limitState } = parsed.data;
  await touchDevice(user.id, c.req.header("x-device-id") ?? "unknown", "pull");
  const result = await pullChanges(user.id, cursor, limit, limitState === 1);
  return c.json(result);
});