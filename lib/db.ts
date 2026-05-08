import { createClient, type Client } from '@libsql/client';

declare global {
  var __turso_client: Client | undefined;
}

function getClient(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    throw new Error('TURSO_DATABASE_URL is not set in environment.');
  }
  return createClient({ url, authToken });
}

// dev 환경에서 hot reload 시 connection 누수 방지
export const db: Client =
  globalThis.__turso_client ??
  (globalThis.__turso_client = getClient());

// ─── 헬퍼: row → JS object 변환 ───
export function rowToObject<T>(row: Record<string, unknown>): T {
  return row as T;
}

// ─── 일관성 있게 timestamp 만들기 ───
export function now(): string {
  return new Date().toISOString();
}
