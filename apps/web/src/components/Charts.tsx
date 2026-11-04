/* 自绘 SVG 图表（PRD §15：自绘以控制视觉一致性）
   任意两类之间必须同时有图标/文字标签，禁止仅靠颜色区分。 */

import { useId } from "react";
import { formatAmount } from "@daybook/shared";

/* ------------------------------- 环形图 ------------------------------- */
export interface DonutSlice {
  key: string;
  label: string;
  color: string;
  amount: number;
}

export function Donut({
  slices,
  total,
  size = 132,
  thickness = 20,
  centerLabel = "支出",
}: {
  slices: DonutSlice[];
  total: number;
  size?: number;
  thickness?: number;
  centerLabel?: string;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;

  // 若为空，画底环
  const sum = slices.reduce((s, x) => s + x.amount, 0) || 1;
  // 预先算出每段起始偏移，避免在渲染过程中累加可变变量
  const offsets: number[] = [];
  slices.reduce((acc, s) => {
    offsets.push(acc);
    return acc + (s.amount / sum) * c;
  }, 0);

  return (
    <svg className="donut" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${centerLabel}构成`}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--green-100)" strokeWidth={thickness} />
      {slices.map((s, idx) => {
        const len = (s.amount / sum) * c;
        return (
          <circle
            key={s.key}
            cx={cx}
            cy={cx}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={thickness}
            strokeDasharray={`${Math.max(len - 2, 0.5)} ${c - Math.max(len - 2, 0.5)}`}
            strokeDashoffset={-offsets[idx]}
            strokeLinecap="butt"
            transform={`rotate(-90 ${cx} ${cx})`}
          />
        );
      })}
      <text x={cx} y={cx - 6} textAnchor="middle" className="center-label">
        {centerLabel}
      </text>
      <text x={cx} y={cx + 14} textAnchor="middle" className="center-value num">
        ¥{formatAmount(total, { decimals: false })}
      </text>
    </svg>
  );
}

/* --------------------------- 月度每日柱状图 --------------------------- */
export function DayBars({
  data,
  highlightMax = true,
}: {
  data: { day: number; amount: number }[];
  highlightMax?: boolean;
}) {
  const max = Math.max(1, ...data.map((d) => d.amount));
  const maxDay = data.reduce((a, b) => (b.amount > a.amount ? b : a), data[0] ?? { day: 0, amount: 0 });
  return (
    <div className="bars" role="img" aria-label="每日支出柱状图">
      {data.map((d) => {
        const h = (d.amount / max) * 100;
        const isMax = highlightMax && d.amount > 0 && d.day === maxDay.day;
        return (
          <div key={d.day} className={`bar ${isMax ? "max" : ""}`} title={`${d.day}日 ¥${formatAmount(d.amount)}`}>
            <i style={{ height: `${Math.max(d.amount > 0 ? 4 : 0, h)}%` }} />
            {d.day % 5 === 0 || isMax ? <span className="cap num">{d.day}</span> : <span className="cap"> </span>}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------- 年度折线图 ---------------------------- */
export function MonthLine({ data }: { data: { month: number; amount: number }[] }) {
  const gid = useId().replace(/:/g, "");
  const W = 320;
  const H = 130;
  const pad = 10;
  const max = Math.max(1, ...data.map((d) => d.amount));
  const step = (W - pad * 2) / Math.max(1, data.length - 1);
  const pts = data.map((d, i) => [pad + i * step, H - pad - (d.amount / max) * (H - pad * 2)] as const);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${H - pad} L${pts[0][0].toFixed(1)} ${H - pad} Z`;

  return (
    <svg className="spark-line" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="每月支出折线图" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--green-400)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--green-400)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#g${gid})`} />
      <path d={line} fill="none" stroke="var(--green-500)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <g key={i}>
          {data[i].amount > 0 ? <circle cx={p[0]} cy={p[1]} r="3.2" fill="var(--bg-card)" stroke="var(--green-500)" strokeWidth="2.2" /> : null}
          <text x={p[0]} y={H - 1} textAnchor="middle" fontSize="8" fill="var(--t3)">
            {data[i].month}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* --------------------------- 横向条形图 --------------------------- */
export function HBars({ items }: { items: { key: string; label: string; color: string; amount: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.amount));
  return (
    <div className="hbar">
      {items.map((i) => (
        <div className="line" key={i.key}>
          <span className="name">{i.label}</span>
          <span className="track">
            <i style={{ width: `${(i.amount / max) * 100}%`, background: i.color }} />
          </span>
          <span className="v num">¥{formatAmount(i.amount, { decimals: false })}</span>
        </div>
      ))}
    </div>
  );
}