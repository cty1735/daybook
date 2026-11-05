/* 后端 API 客户端
   开发期通过 Vite 代理把 /api 转发到 http://127.0.0.1:3001（同源 → Cookie 正常）。 */

import type { SyncPullResult, SyncPushResult, Transaction, UserState } from "@daybook/shared";

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`${API_BASE}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const p = payload as { message?: string; error?: { message?: string }; code?: string } | null;
    throw new ApiError(p?.message ?? p?.error?.message ?? `请求失败（${res.status}）`, res.status, p?.code);
  }
  return payload as T;
}

export interface SessionUser {
  id: string;
  username: string;
  displayUsername: string;
  /** 未绑定时为 null（内部占位邮箱不外露） */
  email: string | null;
  emailVerified: boolean;
  createdAt: number | null;
}

export interface SessionInfo {
  id: string;
  expiresAt: number;
}

export interface DeviceSession {
  id: string;
  device: string;
  ip: string;
  lastActive: number | null;
  createdAt: number | null;
  expiresAt: number | null;
  current: boolean;
}

export interface ForgotResult {
  ok: boolean;
  message: string;
  hasEmail?: boolean;
  /** 仅开发环境返回，便于本地无 SMTP 时跑通邮箱重置 */
  devResetToken?: string;
}

export const api = {
  /** 当前会话（未登录返回 null） */
  async session(): Promise<SessionUser | null> {
    try {
      const r = await request<{ user?: SessionUser } | null>("/api/auth/session");
      return r?.user ?? null;
    } catch {
      return null;
    }
  },

  async register(input: {
    username: string;
    password: string;
    email?: string;
    acceptedTerms: boolean;
  }): Promise<{ user: SessionUser; recoveryCode: string }> {
    return request("/api/auth/register", { method: "POST", json: input });
  },

  async checkUsername(username: string): Promise<{ available: boolean; message?: string }> {
    return request(`/api/auth/check-username?username=${encodeURIComponent(username)}`);
  },

  async login(input: { username: string; password: string; rememberMe?: boolean }): Promise<{ user: SessionUser }> {
    return request("/api/auth/login", { method: "POST", json: input });
  },

  async logout(): Promise<void> {
    await request("/api/auth/logout", { method: "POST", json: {} });
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await request("/api/auth/change-password", { method: "POST", json: { currentPassword, newPassword } });
  },

  async listSessions(): Promise<DeviceSession[]> {
    const r = await request<{ sessions: DeviceSession[] }>("/api/auth/sessions");
    return r.sessions ?? [];
  },

  async revokeSession(id: string): Promise<void> {
    await request(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  async forgotPassword(username: string): Promise<ForgotResult> {
    return request("/api/auth/forgot-password", { method: "POST", json: { username } });
  },

  async resetPassword(input: { username?: string; code?: string; token?: string; newPassword: string }): Promise<void> {
    await request("/api/auth/reset-password", { method: "POST", json: input });
  },

  async regenerateRecoveryCode(password: string): Promise<{ recoveryCode: string }> {
    return request("/api/auth/recovery-code", { method: "POST", json: { password } });
  },

  async health(): Promise<{ ok: boolean; version: string; time: number }> {
    return request("/api/health");
  },

  async push(body: {
    deviceId: string;
    cursor: number;
    transactions: Transaction[];
    state?: { payload: UserState; updatedAt: number };
  }): Promise<SyncPushResult> {
    return request("/api/sync/push", { method: "POST", json: body });
  },

  async pull(cursor: number, limit = 500): Promise<SyncPullResult> {
    return request(`/api/sync/pull?cursor=${cursor}&limit=${limit}`);
  },
};
