import type { Config } from "../shared/types";
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(
  /\/$/,
  "",
);
let tokenGetter: () => Promise<string | null> = async () => null;
export function setTokenGetter(fn: () => Promise<string | null>) {
  tokenGetter = fn;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await tokenGetter();
  const response = await fetch(API_BASE + "/api" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error(
      "Online matches are not connected yet. You can still explore the arenas.",
    );
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}
export const fallbackConfig: Config = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? "",
  supabaseKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
  playEnabled: false,
  reason:
    "The beta is being prepared. Explore an arena while online play gets ready.",
  dailyCapacity: null,
};
export async function connectEvents(path: string, onMessage: (v: any) => void) {
  const token = await tokenGetter();
  const ticket = await api<{ ticket: string }>(`/socket-ticket`, {
    method: "POST",
    body: JSON.stringify({ path }),
  });
  const origin = API_BASE || window.location.origin;
  const ws = new WebSocket(
    origin.replace(/^http/, "ws") +
      "/api" +
      path +
      "?ticket=" +
      encodeURIComponent(ticket.ticket),
  );
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data));
    } catch {}
  };
  return ws;
}
