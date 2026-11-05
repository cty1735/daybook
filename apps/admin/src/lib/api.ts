/* 管理后台 API 客户端
   开发期通过 Vite 代理 /api → 127.0.0.1:3001（同源 → Cookie 正常）。
   与 apps/web 的 request 保持同一口径：credentials include + ApiError。 */

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
    const p = payload as { message?: string; code?: string } | null;
    throw new ApiError(p?.message ?? `请求失败（${res.status}）`, res.status, p?.code);
  }
  return payload as T;
}

/* ------------------------------ 类型 ------------------------------ */

export interface AdminMe {
  id: string;
  username: string;
  displayUsername: string;
  role: string;
}

export interface AdminAccount {
  id: string;
  username: string;
  displayUsername: string;
  name: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  lastLoginAt: number | null;
  lastLoginIp: string | null;
  isSelf?: boolean;
}

export interface Overview {
  users: number;
  admins: number;
  banned: number;
  transactions: number;
  liveTransactions: number;
  todayTransactions: number;
  activeSessions7d: number;
  devices: number;
  trend: { day: string; count: number }[];
}

export interface UserRow {
  id: string;
  username: string;
  displayUsername: string;
  email: string | null;
  role: string;
  banned: boolean;
  banReason: string | null;
  banExpires: number | null;
  status: string;
  createdAt: number | null;
  lastLoginAt: number | null;
}

export interface UserDetail {
  user: UserRow & { emailVerified: boolean };
  sessions: {
    id: string;
    device: string;
    ip: string | null;
    createdAt: number | null;
    lastActive: number | null;
    expiresAt: number | null;
  }[];
  devices: { id: string; lastSeenAt: number; pushes: number; pulls: number }[];
  transactions: { total: number; live: number; lastOccurredAt: number | null; lastSeq: number };
  state: { updatedAt: number; bytes: number } | null;
  recentTransactions: { id: string; amount: number; type: string; occurredAt: number; deleted: boolean }[];
}

export interface TxRow {
  id: string;
  userId: string;
  username: string;
  amount: number;
  type: string;
  categoryId: string | null;
  occurredAt: number;
  updatedAt: number;
  deleted: boolean;
  seq: number;
}

export interface TxDetail extends TxRow {
  deletedAt: number | null;
  payload: unknown;
}

export interface AuditRow {
  id: string;
  adminId: string;
  adminName: string;
  action: string;
  targetType: string;
  targetId: string | null;
  detail: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: number;
}

export interface Totals {
  from: number | null;
  to: number | null;
  expense: { amount: number; count: number };
  income: { amount: number; count: number };
  transfer: { amount: number; count: number };
  adjustment: { amount: number; count: number };
}

export interface CategoryStat {
  categoryId: string | null;
  categoryName: string | null;
  amount: number;
  count: number;
  share: number;
}

export interface DailyStat {
  day: string;
  expense: number;
  income: number;
  count: number;
}

export interface SystemInfo {
  version: string;
  nodeEnv: string;
  uptimeSec: number;
  tables: Record<string, number>;
  lastAuditAt: number | null;
}

export interface Paged<T> {
  data: T[];
  nextCursor: string | null;
}

/* ------------------------------ 接口 ------------------------------ */

export const api = {
  /** 当前后台会话；未登录返回 null（后台只关心能不能进） */
  async me(): Promise<AdminMe | null> {
    try {
      const r = await request<{ data: AdminMe }>("/api/admin/auth/me");
      return r.data;
    } catch {
      return null;
    }
  },

  /** 后台独立登录：与前台 App 账号完全分离 */
  async login(input: { username: string; password: string }): Promise<void> {
    await request("/api/admin/auth/login", { method: "POST", json: { ...input, rememberMe: true } });
  },

  async logout(): Promise<void> {
    await request("/api/admin/auth/logout", { method: "POST", json: {} });
  },

  changeMyPassword(input: { currentPassword: string; newPassword: string }): Promise<{ data: { ok: boolean } }> {
    return request("/api/admin/auth/me/password", { method: "POST", json: input });
  },

  adminAccounts(): Promise<{ data: AdminAccount[] }> {
    return request("/api/admin/auth/accounts");
  },

  createAdminAccount(input: { username: string; password: string; name?: string }): Promise<{ data: AdminAccount }> {
    return request("/api/admin/auth/accounts", { method: "POST", json: input });
  },

  resetAdminPassword(id: string, password: string): Promise<{ data: { ok: boolean; self: boolean } }> {
    return request(`/api/admin/auth/accounts/${encodeURIComponent(id)}/password`, { method: "POST", json: { password } });
  },

  setAdminStatus(id: string, status: "active" | "disabled"): Promise<{ data: { ok: boolean; status: string } }> {
    return request(`/api/admin/auth/accounts/${encodeURIComponent(id)}/status`, { method: "POST", json: { status } });
  },

  deleteAdminAccount(id: string): Promise<{ data: { ok: boolean } }> {
    return request(`/api/admin/auth/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  overview(): Promise<{ data: Overview }> {
    return request("/api/admin/overview");
  },

  users(params: { q?: string; role?: string; banned?: string; sort?: string; cursor?: string; limit?: number }): Promise<Paged<UserRow>> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
    }
    return request(`/api/admin/users?${qs}`);
  },

  user(id: string): Promise<{ data: UserDetail }> {
    return request(`/api/admin/users/${encodeURIComponent(id)}`);
  },

  banUser(id: string, body: { reason?: string; expiresIn?: number }): Promise<{ data: { ok: boolean } }> {
    return request(`/api/admin/users/${encodeURIComponent(id)}/ban`, { method: "POST", json: body });
  },

  unbanUser(id: string): Promise<{ data: { ok: boolean } }> {
    return request(`/api/admin/users/${encodeURIComponent(id)}/unban`, { method: "POST", json: {} });
  },

  revokeSessions(id: string): Promise<{ data: { ok: boolean } }> {
    return request(`/api/admin/users/${encodeURIComponent(id)}/revoke-sessions`, { method: "POST", json: {} });
  },

  transactions(
    params: {
      userId?: string;
      from?: string;
      to?: string;
      type?: string;
      minAmount?: string;
      maxAmount?: string;
      categoryId?: string;
      includeDeleted?: string;
      cursor?: string;
      limit?: number;
    },
  ): Promise<Paged<TxRow>> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
    }
    return request(`/api/admin/transactions?${qs}`);
  },

  transaction(id: string, userId?: string): Promise<{ data: TxDetail }> {
    const qs = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    return request(`/api/admin/transactions/${encodeURIComponent(id)}${qs}`);
  },

  deleteTransaction(id: string, userId: string): Promise<{ data: { ok: boolean; seq: number } }> {
    return request(`/api/admin/transactions/${encodeURIComponent(id)}/delete?userId=${encodeURIComponent(userId)}`, {
      method: "POST",
      json: {},
    });
  },

  restoreTransaction(id: string, userId: string): Promise<{ data: { ok: boolean; seq: number } }> {
    return request(`/api/admin/transactions/${encodeURIComponent(id)}/restore?userId=${encodeURIComponent(userId)}`, {
      method: "POST",
      json: {},
    });
  },

  statsTotals(from?: string, to?: string): Promise<{ data: Totals }> {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return request(`/api/admin/stats/totals?${qs}`);
  },

  statsCategories(from?: string, to?: string): Promise<{ data: CategoryStat[]; total: number }> {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return request(`/api/admin/stats/categories?${qs}`);
  },

  statsDaily(from?: string, to?: string): Promise<{ data: DailyStat[]; from: number; to: number }> {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    return request(`/api/admin/stats/daily?${qs}`);
  },

  audit(params: { action?: string; adminId?: string; from?: string; to?: string; cursor?: string; limit?: number }): Promise<Paged<AuditRow>> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "" && v !== null) qs.set(k, String(v));
    }
    return request(`/api/admin/audit?${qs}`);
  },

  system(): Promise<{ data: SystemInfo }> {
    return request("/api/admin/system");
  },
};
