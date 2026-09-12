import { useEffect, useRef, useState } from "react";
import { api, ApiError, connectEvents } from "./api";
import type { Language, MatchView } from "../shared/types";
interface PendingRequest {
  key: string;
  id: string;
  kind: "run" | "submit";
  language: Language;
  source: string;
}

/** Live transport only. Demo controllers never call these operations. */
export function useLiveMatch(id: string, userId: string) {
  const [match, setMatch] = useState<MatchView | null>(null);
  const [now, setNow] = useState(Date.now());
  const [transportError, setTransportError] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState("Syncing");
  const [retryKind, setRetryKind] = useState<"run" | "submit" | null>(null);
  const offset = useRef(0),
    generation = useRef(0),
    snapshot = useRef(0);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const requestRef = useRef<PendingRequest | null>(null);
  const busyRef = useRef(false);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + offset.current), 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const current = ++generation.current;
    let stopped = false,
      fetching = false,
      again = false,
      failures = 0;
    let socket: WebSocket | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    setMatch(null);
    setTransportError("");
    setMutationError("");
    setBusy(false);
    setRetryKind(null);
    busyRef.current = false;
    requestRef.current = null;
    snapshot.current = 0;
    offset.current = 0;
    setConnection("Syncing");
    const apply = (v: MatchView) => {
      if (
        stopped ||
        current !== generation.current ||
        v.serverNow < snapshot.current
      )
        return;
      snapshot.current = v.serverNow;
      offset.current = v.serverNow - Date.now();
      setNow(v.serverNow);
      setMatch(v);
    };
    async function refresh() {
      if (!userId || stopped) return;
      if (fetching) {
        again = true;
        return;
      }
      fetching = true;
      try {
        const v = await api<MatchView>("/matches/" + id);
        apply(v);
        if (!stopped) {
          setTransportError("");
          if (socket?.readyState !== WebSocket.OPEN) setConnection("Polling");
        }
      } catch (e) {
        if (!stopped) {
          setTransportError((e as Error).message);
          setConnection("Connection interrupted");
        }
      } finally {
        fetching = false;
        if (again && !stopped) {
          again = false;
          void refresh();
        }
      }
    }
    function scheduleSocket() {
      if (stopped) return;
      setConnection("Polling · reconnecting");
      reconnect = setTimeout(
        openSocket,
        Math.min(10000, 1000 * 2 ** failures++),
      );
    }
    async function openSocket() {
      if (!userId || stopped) return;
      try {
        const s = await connectEvents(
          "/matches/" + id + "/events",
          () => void refresh(),
        );
        if (stopped) {
          s.close();
          return;
        }
        socket = s;
        s.onopen = () => {
          failures = 0;
          setConnection("Live");
        };
        if (s.readyState === WebSocket.OPEN) {
          failures = 0;
          setConnection("Live");
        }
        s.onclose = scheduleSocket;
        s.onerror = () => s.close();
      } catch {
        scheduleSocket();
      }
    }
    refreshRef.current = refresh;
    void refresh();
    void openSocket();
    const poll = setInterval(refresh, 2500);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearTimeout(reconnect);
      socket?.close();
      refreshRef.current = async () => {};
    };
  }, [id, userId]);
  async function attempt(
    kind: "run" | "submit",
    language: Language,
    source: string,
  ) {
    if (busyRef.current || !userId || !match) return;
    busyRef.current = true;
    setBusy(true);
    setMutationError("");
    const current = generation.current;
    const key = JSON.stringify([id, userId, kind, language, source]);
    if (requestRef.current?.key !== key)
      requestRef.current = {
        key,
        id: crypto.randomUUID(),
        kind,
        language,
        source,
      };
    try {
      const v = await api<MatchView>(`/matches/${id}/${kind}`, {
        method: "POST",
        body: JSON.stringify({
          language,
          source,
          requestId: requestRef.current.id,
        }),
      });
      if (current === generation.current) {
        requestRef.current = null;
        setRetryKind(null);
        if (v.serverNow >= snapshot.current) {
          snapshot.current = v.serverNow;
          setMatch(v);
          offset.current = v.serverNow - Date.now();
        }
      }
    } catch (e) {
      if (current === generation.current) {
        // A client rejection is definitive; a transport/server failure may have
        // persisted the attempt. Only an explicit retry reuses that request ID.
        const definitive =
          e instanceof ApiError && e.status >= 400 && e.status < 500;
        if (definitive) {
          requestRef.current = null;
          setRetryKind(null);
        } else setRetryKind(kind);
        setMutationError(
          (e as Error).message +
            (definitive
              ? ""
              : " Retry the request to confirm whether it was received; the same attempt will not be counted twice."),
        );
      }
    } finally {
      if (current === generation.current) {
        busyRef.current = false;
        setBusy(false);
        void refreshRef.current();
      }
    }
  }
  async function resign() {
    const current = generation.current;
    if (!userId || !match) return;
    setBusy(true);
    setMutationError("");
    try {
      const v = await api<MatchView>(`/matches/${id}/resign`, {
        method: "POST",
      });
      if (current === generation.current && v.serverNow >= snapshot.current) {
        snapshot.current = v.serverNow;
        setMatch(v);
      }
    } catch (e) {
      if (current === generation.current)
        setMutationError((e as Error).message);
      throw e;
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  function retry() {
    const pending = requestRef.current;
    if (retryKind && pending)
      void attempt(pending.kind, pending.language, pending.source);
    else void refreshRef.current();
  }
  return {
    match,
    now,
    error: mutationError || transportError,
    busy,
    connection,
    attempt,
    resign,
    retry,
    retryKind,
  };
}
