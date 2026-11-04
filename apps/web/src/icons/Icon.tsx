/* 线性圆头图标集（PRD §10.5：round cap / round join，线宽 2px，24 网格）
   所有图标以 24×24 viewBox 绘制，颜色继承 currentColor。
   未注册的名称回退 `dotted`，不会破坏布局。 */

import type { CSSProperties, ReactNode } from "react";

type IconDef = ReactNode;

const ICONS: Record<string, IconDef> = {
  /* ---------------- 通用 UI ---------------- */
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 13l4 4L19 7" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronUp: <path d="M6 15l6-6 6 6" />,
  back: <path d="M11 5l-7 7 7 7M4 12h16" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  dotted: <circle cx="12" cy="12" r="7" />,
  list: <path d="M4 6h16M4 12h16M4 18h16" />,
  chart: (
    <>
      <path d="M4 20h16" />
      <path d="M7 20v-6M12 20V7M17 20v-9" />
    </>
  ),
  chartLine: <path d="M4 16l5-5 4 3 6-8M4 20h16" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c.6-3.8 3.7-6 7.5-6s6.9 2.2 7.5 6" />
    </>
  ),
  cog: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.2 5.2l1.9 1.9M16.9 16.9l1.9 1.9M18.8 5.2l-1.9 1.9M7.1 16.9l-1.9 1.9" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20.5 20.5L16 16" />
    </>
  ),
  filter: <path d="M4 5h16l-6.2 7.4V19l-3.6-2v-4.6z" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
    </>
  ),
  moon: <path d="M20.5 14.6A8.2 8.2 0 1 1 9.4 3.5a6.6 6.6 0 0 0 11.1 11.1z" />,
  trash: <path d="M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10.5 11v5.5M13.5 11v5.5" />,
  pencil: <path d="M4 20h4L20 8l-4-4L4 16v4zM14 6l4 4" />,
  download: <path d="M12 3v12M7 11l5 5 5-5M4 21h16" />,
  upload: <path d="M12 21V9M7 14l5-5 5 5M4 3.5h16" />,
  refresh: <path d="M20 11.5A8 8 0 1 0 17.6 17M20 5.5v6h-6" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 8h.01" />
    </>
  ),
  sparkles: (
    <>
      <path d="M12 3.5l1.7 4.3 4.3 1.7-4.3 1.7L12 15.5l-1.7-4.3L6 9.5l4.3-1.7z" />
      <path d="M18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </>
  ),
  arrowUp: <path d="M12 19V5M6.5 10.5L12 5l5.5 5.5" />,
  arrowDown: <path d="M12 5v14M6.5 13.5L12 19l5.5-5.5" />,
  swap: <path d="M7.5 7h11l-3-3M16.5 17h-11l3 3" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10" width="15" height="10.5" rx="3" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
    </>
  ),
  bell: <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 5 2 6 2 6H4.5s2-1 2-6zM10 20a2.4 2.4 0 0 0 4 0" />,
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2.5" />
      <path d="M9 20h6M12 16.5V20" />
    </>
  ),

  /* ---------------- 金额 / 账户 ---------------- */
  wallet: (
    <>
      <path d="M3.5 7.5h13A3.5 3.5 0 0 1 20 11v6a3 3 0 0 1-3 3H6.5a3 3 0 0 1-3-3z" />
      <path d="M3.5 7.5A3 3 0 0 1 6.5 4.5h10" />
      <path d="M16 12.5h1.5" />
    </>
  ),
  bank: (
    <>
      <path d="M3 9.5L12 4l9 5.5" />
      <path d="M5 9.5V19M10 9.5V19M14 9.5V19M19 9.5V19M3 19h18" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="3" />
      <path d="M3 10h18M6.5 14.5h4" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M9.6 9.8c0-1.2 1-1.8 2.4-1.8s2.4.6 2.4 1.6c0 2.4-4.8 1.3-4.8 3.7 0 1 1 1.6 2.4 1.6s2.4-.6 2.4-1.7" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3.5" y="7.5" width="17" height="12" rx="3" />
      <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3.5 13h17" />
    </>
  ),

  /* ---------------- 分类图标 ---------------- */
  food: (
    <>
      <path d="M3.5 12.5h17c0 4.4-3.8 8-8.5 8s-8.5-3.6-8.5-8z" />
      <path d="M14.5 3.5l3.2 8.5M17.7 3.5l-3.2 8.5" />
    </>
  ),
  coffee: (
    <>
      <path d="M5 9h11v4.5A4.5 4.5 0 0 1 11.5 18h-2A4.5 4.5 0 0 1 5 13.5z" />
      <path d="M16 10h1.8a2.4 2.4 0 0 1 0 4.8H16M8 3v2.2M11 3v2.2" />
    </>
  ),
  candy: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="9.5" cy="10" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="13.5" cy="14" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="9.5" r="0.7" fill="currentColor" stroke="none" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M3.5 19.5c.5-3.2 3-5 5.5-5s5 1.8 5.5 5" />
      <path d="M15.5 6.4a3 3 0 0 1 0 5.2M17 14.6c2 .5 3.4 2.1 3.7 4.9" />
    </>
  ),
  train: (
    <>
      <rect x="5" y="3.5" width="14" height="13" rx="3.5" />
      <path d="M5 10.5h14M9 20l1.5-3.5M15 20l-1.5-3.5M8.5 14h.01M15.5 14h.01" />
    </>
  ),
  car: (
    <>
      <path d="M4 16v2.5h3V16M17 16v2.5h3V16" />
      <path d="M3.5 16v-3l1.6-4.2A2 2 0 0 1 7 7.5h10a2 2 0 0 1 1.9 1.3L20.5 13v3z" />
      <path d="M5 13h14" />
    </>
  ),
  fuel: (
    <>
      <path d="M5 20V5.5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2V20M4 20h10" />
      <path d="M6 9h6M13 8l3.5 3.5a2 2 0 0 1 .5 1.4V17a1.6 1.6 0 0 0 3.2 0V11l-2.7-3" />
    </>
  ),
  parking: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M10 16V8.5h3a2.4 2.4 0 0 1 0 4.8h-3" />
    </>
  ),
  bag: (
    <>
      <path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
    </>
  ),
  shirt: <path d="M9 4l3 2 3-2 3.5 2-1.5 4-1.5-.8V20H8.5V9.2L7 10 5.5 6z" />,
  device: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="3" />
      <path d="M10.5 17.5h3" />
    </>
  ),
  beauty: (
    <>
      <path d="M9 3.5h4v3l1.5 2v10a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2v-10L9 6.5z" />
      <path d="M9.5 12h3.5" />
    </>
  ),
  sofa: (
    <>
      <path d="M4 11V8.5A2.5 2.5 0 0 1 6.5 6h11A2.5 2.5 0 0 1 20 8.5V11" />
      <path d="M3.5 12.5a2 2 0 0 1 4 0V15h9v-2.5a2 2 0 0 1 4 0V18H3.5z" />
    </>
  ),
  home: <path d="M4 10.5L12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19zM9.5 20.5v-6h5v6" />,
  bolt: <path d="M13.5 3L6 13h4.5L10 21l7.5-10H13z" />,
  wrench: <path d="M14.7 6.3a3.8 3.8 0 0 0-5 5L4 17l3 3 5.7-5.7a3.8 3.8 0 0 0 5-5l-2.3 2.3-2.7-2.7z" />,
  phone: <path d="M7 3.5h10a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zM10.5 17.5h3" />,
  film: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M7.5 4.5v15M16.5 4.5v15M3.5 9.5h4M3.5 14.5h4M16.5 9.5h4M16.5 14.5h4" />
    </>
  ),
  gamepad: (
    <>
      <path d="M8 8.5h8a5.5 5.5 0 0 1 5.4 4.4l.5 3.2a2.2 2.2 0 0 1-3.9 1.8L16 16H8l-2 1.9a2.2 2.2 0 0 1-3.9-1.8l.5-3.2A5.5 5.5 0 0 1 8 8.5z" />
      <path d="M8 11.5v2M7 12.5h2M15.5 12h.01M17.5 14h.01" />
    </>
  ),
  dumbbell: <path d="M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10" />,
  pill: (
    <>
      <rect x="3.5" y="8" width="17" height="8" rx="4" transform="rotate(-45 12 12)" />
      <path d="M9.5 9.5l5 5" />
    </>
  ),
  book: <path d="M12 6.5C10 5 7.5 4.5 5 5v13c2.5-.5 5 0 7 1.5 2-1.5 4.5-2 7-1.5V5c-2.5-.5-5 0-7 1.5zM12 6.5V19.5" />,
  gift: (
    <>
      <rect x="4" y="9" width="16" height="11" rx="2" />
      <path d="M3.5 9h17M12 9v11M12 9C10 9 7 8.7 7 6.5A2.5 2.5 0 0 1 12 5.5M12 9c2 0 5-.3 5-2.5A2.5 2.5 0 0 0 12 5.5" />
    </>
  ),
  envelope: (
    <>
      <rect x="3.5" y="6" width="17" height="12.5" rx="3" />
      <path d="M4.5 8.5L12 13l7.5-4.5" />
    </>
  ),
  plane: <path d="M11 4.5a1.5 1.5 0 0 1 3 0V10l6.5 3.5v2L14 14v4l2.5 2v1.5L12 20l-4.5 1.5V20L10 18v-4l-6.5 1.5v-2L10 10z" />,
  bed: <path d="M3.5 19V8M3.5 12h13a4 4 0 0 1 4 4v3M3.5 19h17M8 12V9.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 14 9.5V12" />,
  ticket: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h13A1.5 1.5 0 0 1 20 8.5v2a2 2 0 0 0 0 3.9v2A1.5 1.5 0 0 1 18.5 18h-13A1.5 1.5 0 0 1 4 16.4v-2a2 2 0 0 0 0-3.9z" />
      <path d="M12 8.5v9" />
    </>
  ),
  paw: (
    <>
      <ellipse cx="7.5" cy="10" rx="2" ry="2.6" />
      <ellipse cx="12" cy="8.2" rx="2" ry="2.8" />
      <ellipse cx="16.5" cy="10" rx="2" ry="2.6" />
      <path d="M8.6 15.8c0-2 1.6-3.4 3.4-3.4s3.4 1.4 3.4 3.4c0 2.4-2.2 3.9-3.4 3.9s-3.4-1.5-3.4-3.9z" />
    </>
  ),
  tag: (
    <>
      <path d="M4 4h7l9 9-7 7-9-9z" />
      <circle cx="8.2" cy="8.2" r="1.3" />
    </>
  ),
  undo: <path d="M8 8H4V4M4.5 8A8 8 0 1 1 6 17.5" />,
  trendUp: <path d="M4 16l5.5-5.5 3.5 3L20 6M20 6h-4.5M20 6v4.5" />,
};

export type IconName = keyof typeof ICONS | (string & {});

interface IconProps {
  name: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

export function Icon({ name, size = 24, strokeWidth = 2, className, style, title }: IconProps) {
  const def = ICONS[name] ?? ICONS.dotted;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {def}
    </svg>
  );
}

export function hasIcon(name: string): boolean {
  return name in ICONS;
}