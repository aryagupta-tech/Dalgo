import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import type { Arena, HistoryRow, PublicProblem, Rating } from "../shared/types";
export function useRatings() {
  const { user } = useAuth();
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    setLoadedFor(user?.id ?? null);
    setRatings([]);
    setError("");
    if (user)
      api<Rating[]>("/ratings")
        .then((v) => {
          if (!stopped) setRatings(v);
        })
        .catch((e) => {
          if (!stopped) setError(e.message);
        });
    return () => {
      stopped = true;
    };
  }, [user?.id]);
  return {
    ratings: user?.id === loadedFor ? ratings : [],
    error: user?.id === loadedFor ? error : "",
  };
}
export function useHistory() {
  const { user } = useAuth();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let stopped = false;
    setLoadedFor(user?.id ?? null);
    setRows([]);
    setError("");
    setLoading(!!user);
    if (user)
      api<HistoryRow[]>("/history")
        .then((v) => {
          if (!stopped) setRows(v);
        })
        .catch((e) => {
          if (!stopped) setError(e.message);
        })
        .finally(() => {
          if (!stopped) setLoading(false);
        });
    return () => {
      stopped = true;
    };
  }, [user?.id]);
  return {
    rows: user?.id === loadedFor ? rows : [],
    error: user?.id === loadedFor ? error : "",
    loading: !!user && (user.id !== loadedFor || loading),
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
