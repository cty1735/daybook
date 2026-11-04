/* 跨端可用的 ID 生成（浏览器 / Node 均支持 crypto.randomUUID） */

export function uid(prefix = "id"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/** 稳定的设备 ID：同一浏览器/设备复用（web 端存于 IndexedDB，Node 端由调用方传入） */
export function deviceId(): string {
  return uid("dev");
}