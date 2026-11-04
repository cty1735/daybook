/* 账号规则（PRD v1.2 §F0 规则一）：
   - 用户名 3–20 位，仅字母/数字/下划线/连字符，不区分大小写，不能纯数字，保留字禁止
   - 密码 8–64 位，必须字母 + 数字，不得与用户名相同或高度相似（编辑距离 ≤ 2），拒绝常见弱密码
   - 恢复码 8 位（大写字母 + 数字，去除 0/O、1/I/L 等易混淆字符），数据库只存 SHA-256 */

import { createHash, randomBytes, randomInt } from "node:crypto";

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 64;

const USERNAME_RE = /^[A-Za-z0-9_-]+$/;

/** 保留字（注册时禁止） */
const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "root",
  "system",
  "support",
  "daybook",
  "api",
  "test",
  "guest",
  "official",
  "help",
  "null",
  "undefined",
  "me",
  "user",
  "users",
  "account",
  "accounts",
]);

/** 常见弱密码（PRD 要求 Top 1000；这里收录最常见的一批并按模式兜底） */
const WEAK_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "11111111", "00000000", "88888888",
  "password", "password1", "password12", "password123", "password2024", "password2025",
  "passw0rd", "p@ssw0rd", "qwerty123", "qwertyuiop", "qwerty12", "1qaz2wsx", "1q2w3e4r",
  "abc12345", "abcd1234", "a1234567", "aa123456", "abc123456", "iloveyou", "iloveyou1",
  "woaini1314", "woaini520", "5201314520", "1314520a", "5201314a", "a123456789",
  "admin123", "admin1234", "admin888", "administrator1", "root1234", "test1234", "test123456",
  "letmein1", "welcome1", "welcome123", "monkey123", "dragon123", "sunshine1", "princess1",
  "football1", "baseball1", "superman1", "starwars1", "whatever1", "trustno1", "master123",
  "qazwsx123", "zaq12wsx", "asdfgh123", "zxcvbnm123", "1qazxsw2", "qwe123asd", "asd123qwe",
  "000000000", "123123123", "11223344", "12121212", "987654321", "87654321", "1234554321",
  "147258369", "159357258", "741852963", "1a2b3c4d", "a1b2c3d4", "abcd123456",
  "woaini123", "woaini1314a", "love1234", "loveyou1", "hello123", "hello1234", "hi123456",
  "changeme", "changeme1", "secret123", "default1", "temp1234", "user1234", "guest1234",
  "daybook1", "daybook123", "money123", "money1234", "bank1234", "pay123456",
  "kiss1234", "michelle1", "jennifer1", "jordan123", "michael1", "charlie1", "shadow123",
  "freedom1", "whatever123", "computer1", "internet1", "samsung1", "iphone123", "android1",
  "windows1", "google123", "baidu123", "qq123456", "wechat123", "taobao123", "alipay123",
]);

export type RuleResult = { ok: true } | { ok: false; message: string };

/** 用户名归一化（与 better-auth username 插件默认行为一致：小写） */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(raw: string): RuleResult {
  const v = raw.trim();
  if (v.length < USERNAME_MIN) return { ok: false, message: `用户名至少 ${USERNAME_MIN} 个字符` };
  if (v.length > USERNAME_MAX) return { ok: false, message: `用户名最多 ${USERNAME_MAX} 个字符` };
  if (!USERNAME_RE.test(v)) return { ok: false, message: "用户名只能包含字母、数字、下划线或连字符" };
  if (/^\d+$/.test(v)) return { ok: false, message: "用户名不能是纯数字" };
  if (RESERVED_USERNAMES.has(v.toLowerCase())) return { ok: false, message: "该用户名为保留字，请换一个" };
  return { ok: true };
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export function validatePassword(password: string, username: string): RuleResult {
  if (password.length < PASSWORD_MIN) return { ok: false, message: `密码至少 ${PASSWORD_MIN} 位` };
  if (password.length > PASSWORD_MAX) return { ok: false, message: `密码最多 ${PASSWORD_MAX} 位` };
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return { ok: false, message: "密码必须同时包含字母和数字" };
  }
  const lower = password.toLowerCase();
  if (WEAK_PASSWORDS.has(lower)) return { ok: false, message: "密码太常见，请换一个更安全的" };
  // 纯重复 / 连续字符（11111111、abcdefgh 等）
  if (/^(.)\1+$/.test(lower)) return { ok: false, message: "密码太简单，请不要使用重复字符" };
  if ("0123456789abcdefghijklmnopqrstuvwxyz".includes(lower)) {
    return { ok: false, message: "密码太简单，请不要使用连续字符" };
  }
  const u = normalizeUsername(username);
  if (u && levenshtein(lower, u) <= 2) {
    return { ok: false, message: "密码不能与用户名相同或过于相似" };
  }
  return { ok: true };
}

/** 恢复码字符集：去掉 0/O、1/I/L 等易混淆字符 */
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const RECOVERY_LENGTH = 8;

/** 生成 8 位恢复码，展示成 XXXX-XXXX */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_LENGTH);
  let out = "";
  for (let i = 0; i < RECOVERY_LENGTH; i++) out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  return out;
}

/** 把用户输入的恢复码归一化（去空格/连字符，转大写） */
export function normalizeRecoveryCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function formatRecoveryCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** 令牌 / 恢复码 / 重置链接统一用 SHA-256 存哈希（PRD §9.0） */
export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** 随机整数（用于无依赖的场景，如临时 id） */
export function randomIntInclusive(max: number): number {
  return randomInt(0, max);
}
