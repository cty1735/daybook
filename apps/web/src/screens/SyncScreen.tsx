/* 云同步 / 同步状态页（PRD v1.2 §5.2 L2 同步状态页）
   上次同步、待上传条数、立即同步；登录入口与退出登录在「账号与安全」页。 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "../icons/Icon";
import { useStore } from "../store/store";
import { useNav } from "../nav";
import { SubPage } from "../components/SubPage";
import { Switch, useToast } from "../components/feedback";
import { api, ApiError } from "../lib/api";
import { isFirstSync, isOnline, runSync } from "../lib/sync";
import { useSessionUser } from "../lib/auth-state";

export function SyncScreen() {
  const nav = useNav();
  const toast = useToast();
  const sync = useStore((s) => s.sync);
  const outboxCount = useStore((s) => s.outboxCount);
  const deviceId = useStore((s) => s.deviceId);
  const setSyncMeta = useStore((s) => s.setSyncMeta);
  const refreshOutboxCount = useStore((s) => s.refreshOutboxCount);
  const txCount = useStore((s) => s.transactions.length);
  const { user, loading } = useSessionUser();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [health, setHealth] = useState<string>("检测中…");

  const refreshHealth = useCallback(async () => {
    try {
      const h = await api.health();
      setHealth(`正常 · v${h.version}`);
    } catch {
      setHealth("未连接（后端未启动？）");
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await refreshHealth();
      await refreshOutboxCount();
      if (user && useStore.getState().sync.autoSync && isOnline()) {
        try {
          const r = await runSync();
          setLastResult(describe(r));
        } catch {
          /* 静默失败，用户可手动重试 */
        }
      }
    })();
  }, [refreshHealth, refreshOutboxCount, user]);

  const doSync = async () => {
    setError(null);
    setBusy(true);
    setLastResult(null);
    try {
      const r = await runSync();
      setLastResult(describe(r));
      toast.show({ message: "同步完成", duration: 2500 });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : String(e);
      setError(msg);
      toast.show({ message: msg, tone: "err", duration: 4000 });
    } finally {
      setBusy(false);
      await refreshOutboxCount();
    }
  };

  const isFirstSyncCheck = isFirstSync(sync);

  const lastSynced = useMemo(() => {
    if (!sync.lastSyncedAt) return "从未同步";
    const d = new Date(sync.lastSyncedAt);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
  }, [sync.lastSyncedAt]);

  return (
    <SubPage title="云同步" subtitle="可选 · 数据默认只存在本机" onBack={nav.pop}>
      {/* 后端连通性 */}
      <div className="card tight" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          className="ic"
          style={{
            width: 34,
            height: 34,
            borderRadius: 11,
            display: "grid",
            placeItems: "center",
            background: health.startsWith("正常") ? "var(--green-50)" : "var(--budget-over-bg)",
            color: health.startsWith("正常") ? "var(--green-700)" : "var(--budget-over)",
          }}
        >
          <Icon name={health.startsWith("正常") ? "check" : "info"} size={16} />
        </span>
        <div style={{ flex: 1 }}>
          <div className="small" style={{ fontWeight: 600 }}>
            后端服务
          </div>
          <div className="xsmall muted-2">{health}</div>
        </div>
      </div>

      {loading ? (
        <div className="section">
          <div className="card tight">
            <div className="xsmall muted-2">正在读取账号状态…</div>
          </div>
        </div>
      ) : !user ? (
        <div className="section">
          <div className="card">
            <div className="xsmall muted-2" style={{ marginBottom: 14, lineHeight: 1.7 }}>
              还没有登录。登录后可以把本机账本增量备份到云端，并在其他设备上继续使用同一本账。
            </div>
            <button className="btn btn-main btn-block" onClick={() => nav.push("login")}>
              登录 / 注册
            </button>
            <button className="btn btn-ghost btn-block" style={{ marginTop: 8 }} onClick={() => nav.push("register")}>
              还没有账号？去注册
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="card" style={{ background: "var(--fab-gradient)", color: "#fff", border: "none" }}>
            <div className="between">
              <div style={{ minWidth: 0 }}>
                <div className="xsmall" style={{ opacity: 0.9 }}>
                  已登录
                </div>
                <div style={{ fontWeight: 700, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {user.displayUsername || user.username}
                </div>
                <div className="xsmall" style={{ opacity: 0.85, marginTop: 4 }}>
                  本机 {txCount} 条记录 · {outboxCount} 条待推送
                </div>
              </div>
              <button
                className="btn-round-sm"
                style={{ background: "rgba(255,255,255,.22)", color: "#fff", border: "none" }}
                onClick={() => nav.push("account")}
              >
                账号
              </button>
            </div>
          </div>

          <div className="section">
            <div className="list">
              <div className="setting-row">
                <span className="ic">
                  <Icon name="clock" size={18} />
                </span>
                <span className="tx">
                  <b>上次同步</b>
                  <span>{lastSynced}</span>
                </span>
              </div>
              <div className="setting-row">
                <span className="ic">
                  <Icon name="swap" size={18} />
                </span>
                <span className="tx">
                  <b>同步游标</b>
                  <span className="num">server seq = {sync.cursor}</span>
                </span>
              </div>
              <div className="setting-row">
                <span className="ic">
                  <Icon name="device" size={18} />
                </span>
                <span className="tx">
                  <b>本设备</b>
                  <span className="num">{deviceId || "—"}</span>
                </span>
              </div>
              <div className="setting-row">
                <span className="ic">
                  <Icon name="refresh" size={18} />
                </span>
                <span className="tx">
                  <b>自动同步</b>
                  <span>打开页面时自动推送与拉取</span>
                </span>
                <Switch on={sync.autoSync} onChange={(v) => setSyncMeta({ autoSync: v })} label="自动同步" />
              </div>
            </div>
          </div>

          {lastResult ? (
            <div className="section">
              <div className="insight">
                <span className="emo">☁️</span>
                <div className="txt">{lastResult}</div>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="section">
              <div className="insight over">
                <span className="emo">⚠️</span>
                <div className="txt">{error}</div>
              </div>
            </div>
          ) : null}

          <div className="section">
            <button className="btn btn-main btn-block" onClick={doSync} disabled={busy}>
              <Icon name="refresh" size={18} />
              {busy ? "同步中…" : isFirstSyncCheck ? `首次同步 · 上传本机 ${txCount} 条` : "立即同步"}
            </button>
            {isFirstSyncCheck ? (
              <div className="xsmall muted-2" style={{ marginTop: 10, lineHeight: 1.7, textAlign: "center" }}>
                首次同步会把本机全部记录与分类/账户设置一次性备份到你的后端，之后只推送有改动的部分。
              </div>
            ) : null}
          </div>
        </>
      )}

      <div className="section">
        <div className="card tight">
          <div className="xsmall muted-2" style={{ lineHeight: 1.85 }}>
            <b style={{ color: "var(--t1)" }}>同步是怎么工作的</b>
            <br />
            · 每条记录都用客户端生成的 UUID 标识，重复推送是安全的（幂等）
            <br />
            · 冲突用「最后写入胜出」：比对记录版本，同分时「已删除」优先，避免记录被复活
            <br />
            · 增量靠服务端单调递增游标（不是时间戳），设备改系统时间也不会漏数据
            <br />
            · 时间戳由服务端归一化后回写，保证多设备口径一致
          </div>
        </div>
      </div>
    </SubPage>
  );
}

function describe(r: {
  pushed: number;
  rejected: number;
  pulled: number;
  applied: number;
  stateApplied: boolean;
  cursor: number;
}): string {
  const parts = [`推送 ${r.pushed} 条`];
  if (r.rejected) parts.push(`被服务端版本覆盖 ${r.rejected} 条`);
  parts.push(`拉取 ${r.pulled} 条`);
  if (r.applied) parts.push(`应用 ${r.applied} 条`);
  if (r.stateApplied) parts.push("并更新了分类/账户设置");
  return `${parts.join(" · ")}（游标 ${r.cursor}）`;
}
