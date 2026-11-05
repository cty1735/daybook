/* 未登录提醒：首页顶部温和提示，可「以后再说」静默 7 天 */

import { useState } from "react";
import { Icon } from "../icons/Icon";
import { useNav } from "../nav";
import { useSessionUser } from "../lib/auth-state";

const SNOOZE_KEY = "daybook.loginPromptSnoozedAt";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export function LoginPrompt() {
  const nav = useNav();
  const { user, loading } = useSessionUser();
  const [snoozed, setSnoozed] = useState(() => {
    try {
      return Date.now() - Number(localStorage.getItem(SNOOZE_KEY) ?? 0) < SNOOZE_MS;
    } catch {
      return false;
    }
  });

  if (loading || user || snoozed) return null;

  const snooze = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    } catch {
      /* 隐私模式下忽略 */
    }
    setSnoozed(true);
  };

  return (
    <div className="section" style={{ marginTop: 0 }}>
      <div className="card tight" style={{ position: "relative" }}>
        <button
          className="icon-btn"
          aria-label="暂不登录"
          title="以后再说"
          onClick={snooze}
          style={{ position: "absolute", top: 4, right: 4, width: 28, height: 28 }}
        >
          <Icon name="close" size={14} />
        </button>
        <div className="row-flex" style={{ gap: 10, paddingRight: 22 }}>
          <span
            className="ic"
            style={{
              width: 34,
              height: 34,
              borderRadius: 11,
              display: "grid",
              placeItems: "center",
              flex: "0 0 auto",
              background: "var(--green-50)",
              color: "var(--green-700)",
            }}
          >
            <Icon name="lock" size={17} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b style={{ fontSize: 14 }}>登录后开始记账</b>
            <div className="xsmall muted-2" style={{ marginTop: 3, lineHeight: 1.6 }}>
              账本实时保存在云端，换手机登录即可找回。不登录可以先看看界面。
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn btn-main" style={{ flex: 1 }} onClick={() => nav.push("register")}>
            免费注册
          </button>
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => nav.push("login")}>
            已有账号登录
          </button>
        </div>
      </div>
    </div>
  );
}
