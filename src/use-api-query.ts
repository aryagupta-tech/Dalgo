import { useCallback, useEffect, useState } from "react";
import { api, ApiError, publicApi } from "./api";

// Only read requests use retries. Mutations retain their existing idempotency rules.
export function useApiQuery<T>(
  path: string | null,
  options: {
    identity?: string;
    version?: number;
    public?: boolean;
    pollMs?: number;
  } = {},
) {
  const {
    identity = "",
    version = 0,
    public: isPublic = false,
    pollMs = 60_000,
  } = options;
  const key = path === null ? null : `${identity}:${path}`;
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(
    () => setRefreshVersion((value) => value + 1),
    [],
  );
  const [state, setState] = useState<{
    key: string | null;
    data: T | null;
    error: string;
    loading: boolean;
  }>({ key: null, data: null, error: "", loading: false });

  useEffect(() => {
    if (path === null) {
      setState({ key: null, data: null, error: "", loading: false });
      return;
    }
    let stopped = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    setState((previous) =>
      previous.key === key
        ? previous
        : { key, data: null, error: "", loading: true },
    );
    const load = async () => {
      if (stopped || pending) return;
      clearTimeout(timer);
      pending = true;
      let failed = false;
      try {
        let value: T | undefined;
        for (const wait of [0, 150, 500]) {
          if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
          if (stopped) return;
          controller = new AbortController();
          let deadline: ReturnType<typeof setTimeout> | undefined;
          try {
            value = await Promise.race([
              (isPublic ? publicApi<T> : api<T>)(path, {
                signal: controller.signal,
              }),
              new Promise<never>((_, reject) => {
                deadline = setTimeout(() => {
                  controller?.abort();
                  reject(new ApiError("Connection timed out. Retrying…", 408));
                }, 10_000);
              }),
            ]);
            break;
          } catch (reason) {
            const transient =
              reason instanceof ApiError
                ? reason.status >= 500 ||
                  reason.status === 408 ||
                  reason.status === 429
                : reason instanceof TypeError;
            if (!transient || wait === 500) throw reason;
          } finally {
            clearTimeout(deadline);
          }
        }
        if (!stopped)
          setState({ key, data: value as T, error: "", loading: false });
      } catch (reason) {
        failed = true;
        if (!stopped)
          setState((previous) => ({
            ...previous,
            key,
            error:
              reason instanceof Error
                ? reason.message
                : "Could not load data. Retrying…",
            loading: false,
          }));
      } finally {
        pending = false;
        if (!stopped)
          timer = setTimeout(
            () => {
              if (document.visibilityState === "visible") void load();
              else timer = setTimeout(resume, pollMs);
            },
            failed ? 5000 : pollMs,
          );
      }
    };
    const resume = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [path, key, version, refreshVersion, isPublic, pollMs]);

  return {
    data: key !== null && state.key === key ? state.data : null,
    error: key !== null && state.key === key ? state.error : "",
    loading: key !== null && (state.key !== key || state.loading),
    refresh,
  };
}
