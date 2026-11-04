import { auth } from "../auth.ts";

export interface SessionUser {
  id: string;
  email: string;
  username: string;
}

/** 从请求头解析 better-auth 会话；未登录返回 null */
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const result = await auth.api.getSession({ headers });
  if (!result?.user) return null;
  const u = result.user as Record<string, unknown>;
  return {
    id: result.user.id,
    email: result.user.email,
    username: (u.username as string | null) ?? "",
  };
}
