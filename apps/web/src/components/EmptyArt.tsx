/* 空态插画：吉祥物「小豆芽」（PRD §10.5：扁平 + 手绘感，圆头线条，
   仅用于空态与月报庆祝） */

export function EmptyArt({ size = 128 }: { size?: number }) {
  return (
    <svg viewBox="0 0 160 160" width={size} height={size} role="img" aria-label="空空的账本">
      {/* 地面阴影 */}
      <ellipse cx="80" cy="146" rx="46" ry="7" fill="var(--green-100)" />
      {/* 花盆 */}
      <path d="M42 104h76l-7 30a11 11 0 0 1-10.8 8.6H59.8A11 11 0 0 1 49 134z" fill="var(--green-300)" />
      <path d="M42 104h76l-7 30a11 11 0 0 1-10.8 8.6H59.8A11 11 0 0 1 49 134z" fill="none" stroke="var(--green-600)" strokeWidth="3" strokeLinejoin="round" />
      {/* 盆沿 */}
      <rect x="34" y="96" width="92" height="14" rx="7" fill="var(--green-400)" />
      <rect x="34" y="96" width="92" height="14" rx="7" fill="none" stroke="var(--green-600)" strokeWidth="3" />
      {/* 茎 */}
      <path d="M80 96c0-14 0-22 0-32" fill="none" stroke="var(--green-600)" strokeWidth="4" strokeLinecap="round" />
      {/* 叶子 */}
      <path d="M80 76C66 76 56 67 56 54c13-2 22 6 24 20z" fill="var(--green-500)" stroke="var(--green-700)" strokeWidth="3" strokeLinejoin="round" />
      <path d="M80 70c14 0 24-9 24-22-13-2-22 6-24 20z" fill="var(--green-400)" stroke="var(--green-700)" strokeWidth="3" strokeLinejoin="round" />
      {/* 表情 */}
      <circle cx="68" cy="118" r="3.4" fill="var(--green-800)" />
      <circle cx="92" cy="118" r="3.4" fill="var(--green-800)" />
      <path d="M72 126c3 3.4 13 3.4 16 0" fill="none" stroke="var(--green-800)" strokeWidth="3" strokeLinecap="round" />
      {/* 腮红 */}
      <ellipse cx="60" cy="124" rx="5" ry="3.2" fill="var(--sakura)" opacity="0.7" />
      <ellipse cx="100" cy="124" rx="5" ry="3.2" fill="var(--sakura)" opacity="0.7" />
      {/* 飘落的硬币 */}
      <circle cx="122" cy="52" r="11" fill="var(--butter)" stroke="var(--green-700)" strokeWidth="3" />
      <path d="M122 46v12M119 49.5c0-1.4 1.4-2 3-2s3 .7 3 1.8c0 2.6-6 1.5-6 4.1 0 1.1 1.4 1.8 3 1.8s3-.7 3-1.9" fill="none" stroke="var(--green-800)" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="40" cy="62" r="8" fill="var(--peach)" stroke="var(--green-700)" strokeWidth="3" />
      <path d="M40 57.5v9" fill="none" stroke="var(--green-800)" strokeWidth="2.2" strokeLinecap="round" />
      {/* 装饰小星星 */}
      <path d="M132 96l1.6 3.6 3.6 1.6-3.6 1.6-1.6 3.6-1.6-3.6-3.6-1.6 3.6-1.6z" fill="var(--sky)" />
      <path d="M30 92l1.3 2.9 2.9 1.3-2.9 1.3-1.3 2.9-1.3-2.9-2.9-1.3 2.9-1.3z" fill="var(--lavender)" />
    </svg>
  );
}

/** 月报庆祝用的小徽章插画 */
export function CelebrateArt({ size = 96 }: { size?: number }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label="本月账单已生成">
      <circle cx="60" cy="60" r="34" fill="var(--green-100)" />
      <path d="M60 38c10 0 18 8 18 18s-8 18-18 18-18-8-18-18 8-18 18-18z" fill="var(--green-500)" />
      <path d="M44 58l10 10 22-24" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M22 30l2 4.5 4.5 2-4.5 2-2 4.5-2-4.5L15.5 36.5l4.5-2z" fill="var(--butter)" />
      <path d="M96 26l1.8 4 4 1.8-4 1.8-1.8 4-1.8-4-4-1.8 4-1.8z" fill="var(--sakura)" />
      <path d="M100 88l1.6 3.6 3.6 1.6-3.6 1.6-1.6 3.6-1.6-3.6-3.6-1.6 3.6-1.6z" fill="var(--sky)" />
    </svg>
  );
}