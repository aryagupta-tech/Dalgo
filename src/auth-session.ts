import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { Config } from "../shared/types";

export const AUTH_CONFIG_STORAGE_KEY = "dalgo:auth-config:v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type SessionClient = Pick<SupabaseClient, "auth">;

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export async function retry<T>(
  operation: () => Promise<T>,
  waits = [0, 150, 500],
  sleep: (milliseconds: number) => Promise<void> = delay,
) {
  let lastError: unknown;
  for (const wait of waits) {
    if (wait) await sleep(wait);
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function readCachedAuthConfig(storage: StorageLike) {
  try {
    const value = JSON.parse(
      storage.getItem(AUTH_CONFIG_STORAGE_KEY) ?? "null",
    ) as { supabaseUrl?: unknown; supabaseKey?: unknown } | null;
    if (
      typeof value?.supabaseUrl === "string" &&
      /^https:\/\/[^/]+$/.test(value.supabaseUrl) &&
      typeof value.supabaseKey === "string" &&
      value.supabaseKey.length > 0
    )
      return {
        supabaseUrl: value.supabaseUrl,
        supabaseKey: value.supabaseKey,
      };
  } catch {}
  return null;
}

export function cacheAuthConfig(storage: StorageLike, config: Config) {
  if (!config.supabaseUrl || !config.supabaseKey) return;
  try {
    storage.setItem(
      AUTH_CONFIG_STORAGE_KEY,
      JSON.stringify({
        supabaseUrl: config.supabaseUrl,
        supabaseKey: config.supabaseKey,
      }),
    );
  } catch {}
}

export function createSessionCoordinator(
  client: SessionClient,
  options: {
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {},
) {
  const now = options.now ?? Date.now;
  let current: Session | null = null;
  let pending: Promise<Session | null> | null = null;

  const restore = () => {
    if (pending) return pending;
    pending = retry(
      async () => {
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        current = data.session;
        return current;
      },
      undefined,
      options.sleep,
    ).then(
      (session) => {
        pending = null;
        return session;
      },
      (error) => {
        pending = null;
        throw error;
      },
    );
    return pending;
  };

  return {
    restore,
    update(session: Session | null) {
      current = session;
    },
    async accessToken() {
      const expiresAt = current?.expires_at
        ? current.expires_at * 1000
        : Number.POSITIVE_INFINITY;
      if (current?.access_token && expiresAt > now() + 90_000)
        return current.access_token;
      return (await restore())?.access_token ?? null;
    },
  };
}
