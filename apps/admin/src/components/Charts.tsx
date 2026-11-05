/* 极简图表：纯 SVG，无第三方依赖（照 apps/web/src/components/Charts.tsx 的思路）
   - TrendBars：日趋势柱状图
   - CategoryBars：分类占比横条
   - SplitDonut：收支构成 */

interface TrendPoint {
  day: string;
  count: number;
}

export function TrendBars({ data, height = 150 }: { data: TrendPoint[]; height?: number }) {
  if (!data.length) return <div className="empty">暂无数据</div>;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height, padding: "8px 4px 0" }}>
      {data.map((d) => {
        const h = Math.max(3, (d.count / max) * (height - 34));
        return (
          <div
            key={d.day}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}
            title={`${d.day}：${d.count} 笔`}
          >
            <div style={{ fontSize: 10.5, color: "var(--t3)" }} className="num">
              {d.count}
            </div>
            <div
              style={{
                width: "100%",
                maxWidth: 34,
                height: h,
                borderRadius: 6,
                background: "var(--fab-gradient)",
                transition: "height var(--t-base)",
              }}
            />
            <div style={{ fontSize: 10, color: "var(--t3)", whiteSpace: "nowrap" }}>
              {d.day.slice(5)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CategoryBars({
  data,
}: {
  data: { categoryId: string | null; categoryName?: string | null; amount: number; share: number; count: number }[];
}) {
  if (!data.length) return <div className="empty">暂无数据</div>;
  const max = Math.max(...data.map((d) => d.share), 0.0001);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {data.map((d, i) => (
        <div key={`${d.categoryId ?? "none"}-${i}`}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
            <span style={{ color: "var(--t2)", fontWeight: 600 }}>
              {d.categoryName ?? d.categoryId ?? "未分类"}
            </span>
            <span className="num" style={{ color: "var(--t3)" }}>
              {(d.share * 100).toFixed(1)}%
            </span>
          </div>
          <div style={{ height: 7, borderRadius: 4, background: "var(--bg-sunken)", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${(d.share / max) * 100}%`,
                borderRadius: 4,
                background: `var(--cat-${(i % 12) + 1})`,
                transition: "width var(--t-base)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SplitDonut({
  expense,
  income,
  size = 150,
}: {
  expense: number;
  income: number;
  size?: number;
}) {
  const total = expense + income;
  const r = size / 2 - 10;
  const cx = size / 2;
  const cy = size / 2;

  if (total <= 0) return <div className="empty">暂无收支</div>;

  const expShare = expense / total;
  const circumference = 2 * Math.PI * r;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <svg width={size} height={size} role="img" aria-label="收支构成">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-sunken)" strokeWidth={12} />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--income)"
          strokeWidth={12}
          strokeDasharray={`${(1 - expShare) * circumference} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--expense)"
          strokeWidth={12}
          strokeDasharray={`${expShare * circumference} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(${-90 + (1 - expShare) * 360} ${cx} ${cy})`}
        />
      </svg>
      <div style={{ fontSize: 12.5, lineHeight: 2 }}>
        <div>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: 3,
              background: "var(--expense)",
              marginRight: 8,
            }}
          />
          支出 {(expShare * 100).toFixed(1)}%
        </div>
        <div>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: 3,
              background: "var(--income)",
              marginRight: 8,
            }}
          />
          收入 {((1 - expShare) * 100).toFixed(1)}%
        </div>
      </div>
    </div>
  );
}
