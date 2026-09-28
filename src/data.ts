import { useEffect, useState } from "react";
import { useApiQuery } from "./use-api-query";
import { useAuth } from "./auth";
import type { Arena, HistoryRow, PublicProblem, Rating } from "../shared/types";
export function useRatings() {
  const { user, loading: authLoading } = useAuth();
  const query = useApiQuery<Rating[]>(
    user && !authLoading ? "/ratings" : null,
    { identity: user?.id },
  );
  return {
    ratings: query.data ?? [],
    error: query.error,
    loading: authLoading || query.loading,
  };
}
export function useHistory() {
  const { user, loading: authLoading } = useAuth();
  const query = useApiQuery<HistoryRow[]>(
    user && !authLoading ? "/history" : null,
    { identity: user?.id },
  );
  return {
    rows: query.data ?? [],
    error: query.error,
    loading: authLoading || query.loading,
  };
}
let bankPromise: Promise<PublicProblem[]> | undefined;
export function usePublicProblem(arena: Arena) {
  const [problem, setProblem] = useState<PublicProblem | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let stopped = false;
    setProblem(null);
    setError("");
    bankPromise ??= fetch("/problems.json")
      .then((r) => {
        if (!r.ok) throw new Error("Problem statements are unavailable.");
        return r.json() as Promise<PublicProblem[]>;
      })
      .catch((e) => {
        bankPromise = undefined;
        throw e;
      });
    bankPromise
      .then((rows) => {
        const p = rows.find((p) => p.arena === arena);
        if (!p) throw new Error("This arena’s problem is unavailable.");
        if (!stopped) setProblem(p);
      })
      .catch((e) => {
        if (!stopped) setError(e.message);
      });
    return () => {
      stopped = true;
    };
  }, [arena, retry]);
  return { problem, error, retry: () => setRetry((x) => x + 1) };
}
export function formatClock(seconds: number) {
  const value = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
export const arenaKeys: Arena[] = ["easy", "medium", "hard"];
