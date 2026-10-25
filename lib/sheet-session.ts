import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const sheetCookieName = "church_ai_sheets";
const lifetimeSeconds = 60 * 60 * 24 * 7;
const validId = (id: string) => /^[a-zA-Z0-9_-]{20,100}$/.test(id);

export function spreadsheetIdFromUrl(input: string): string | null {
  const value = input.trim();
  if (validId(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "docs.google.com") return null;
    const match = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,100})(?:\/|$)/);
    return match?.[1] ?? null;
  } catch { return null; }
}

function secret(): string | null {
  const password = process.env.CHURCH_AI_ADMIN_PASSWORD;
  return password && password.length >= 12 ? password : null;
}

export function adminConfigured(): boolean { return Boolean(secret()); }

export function checkAdminPassword(password: string): boolean {
  const expected = secret();
  if (!expected || typeof password !== "string") return false;
  const a = createHmac("sha256", "church-ai-password").update(password).digest();
  const b = createHmac("sha256", "church-ai-password").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function makeSheetSession(ids: string[]): string {
  const key = secret();
  if (!key) throw new Error("Admin password is not configured.");
  const payload = Buffer.from(JSON.stringify({ v: 1, exp: Math.floor(Date.now() / 1000) + lifetimeSeconds, ids: ids.filter(validId).slice(0, 8) })).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function readSheetSession(cookie?: string): string[] | null {
  const key = secret();
  if (!key || !cookie) return null;
  const [payload, signature, extra] = cookie.split(".");
  if (!payload || !signature || extra || payload.length > 2048) return null;
  const expected = createHmac("sha256", key).update(payload).digest();
  let received: Buffer;
  try { received = Buffer.from(signature, "base64url"); } catch { return null; }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { v?: number; exp?: number; ids?: unknown };
    if (value.v !== 1 || typeof value.exp !== "number" || value.exp < Date.now() / 1000 || !Array.isArray(value.ids)
      || value.ids.length > 8 || !value.ids.every((id) => typeof id === "string" && validId(id))) return null;
    return [...new Set(value.ids as string[])];
  } catch { return null; }
}

export const sheetCookieOptions = { httpOnly: true, sameSite: "strict" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: lifetimeSeconds };
