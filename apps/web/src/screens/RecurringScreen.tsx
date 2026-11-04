/* 周期账单（PRD F9，v1.1 规划中） */

import { Icon } from "../icons/Icon";
import { useNav } from "../nav";
import { SubPage } from "../components/SubPage";

export function RecurringScreen() {
  const nav = useNav();
  const items = [
    { icon: "refresh", title: "创建固定支出规则", desc: "名称、金额、分类、账户、频率与执行日" },
    { icon: "bell", title: "到期生成待确认项", desc: "每月 5 日的房租，当天生成待确认记录，不会直接入账" },
    { icon: "check", title: "确认 / 跳过 / 改金额", desc: "由你决定这一期是否入账" },
    { icon: "clock", title: "规则可暂停或删除", desc: "已生成的记录不受影响" },
  ];
  return (
    <SubPage title="周期账单" subtitle="v1.1 规划中" onBack={nav.pop}>
      <div className="card" style={{ textAlign: "center", padding: "32px 20px" }}>
        <div style={{ display: "grid", placeItems: "center", marginBottom: 12, color: "var(--green-500)" }}>
          <Icon name="refresh" size={44} strokeWidth={1.8} />
        </div>
        <b style={{ fontSize: 17 }}>还差一点点</b>
        <div className="xsmall muted-2" style={{ marginTop: 8, lineHeight: 1.7 }}>
          房租、会员订阅这类固定支出，很快就能每月自动生成、
          <br />
          你只需点一下「确认入账」。
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <div className="section-title">即将支持</div>
        </div>
        <div className="list">
          {items.map((i) => (
            <div key={i.title} className="setting-row">
              <span className="ic">
                <Icon name={i.icon} size={18} />
              </span>
              <span className="tx">
                <b>{i.title}</b>
                <span>{i.desc}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="section">
        <button className="btn btn-sub btn-block" onClick={nav.pop}>
          返回
        </button>
      </div>
    </SubPage>
  );
}