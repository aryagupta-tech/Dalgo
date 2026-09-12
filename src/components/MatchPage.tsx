import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Code2,
  Flag,
  GripVertical,
  LoaderCircle,
  Play,
  RotateCcw,
  SkipForward,
  Swords,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  ARENAS,
  DEFAULT_ATTEMPT_LIMITS,
  LANGUAGES,
  type Arena,
  type Language,
  type MatchView,
  type PublicProblem,
  type QueueView,
} from "../../shared/types";
import { Brand, DemoNotice, Modal } from "./Chrome";
import { api, connectEvents } from "../api";
import { useAuth } from "../auth";
import { arenaKeys, formatClock, usePublicProblem } from "../data";
import { useLiveMatch } from "../use-match-session";
import {
  advanceDemo,
  createDemo,
  DEMO_READY_MS,
  DEMO_SEARCH_MS,
  DEMO_USER,
  demoPhase,
  finishDemo,
  previewAttempt,
  restoreDemo,
  setDemoScenario,
  skipDemoWait,
  toDemoMatch,
  type DemoScenario,
  type DemoState,
} from "../demo-session";
const Editor = lazy(() => import("./CodeEditor"));
const scenarios: { id: DemoScenario; label: string }[] = [
  { id: "win", label: "Win" },
  { id: "loss", label: "Loss" },
  { id: "draw", label: "Draw" },
  { id: "void", label: "Judge unavailable" },
];
function sampleValue(value: unknown) {
  const text = JSON.stringify(value, null, 2) ?? "undefined";
  return text.length > 4000
    ? text.slice(0, 4000) + "\n… (output truncated)"
    : text;
}
function sessionRead(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function sessionWrite(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
export function DemoPage() {
  const { arena: routeArena } = useParams();
  const arena = arenaKeys.includes(routeArena as Arena)
    ? (routeArena as Arena)
    : "easy";
  const { problem, error, retry } = usePublicProblem(arena);
  if (!arenaKeys.includes(routeArena as Arena))
    return (
      <ScreenMessage title="Arena not found.">
        Choose Easy, Medium, or Hard from the lobby.
      </ScreenMessage>
    );
  if (error)
    return (
      <ScreenMessage
        title="The challenge couldn’t load."
        action={
          <button className="button primary" onClick={retry}>
            Try again
          </button>
        }
      >
        {error}
      </ScreenMessage>
    );
  if (!problem)
    return (
      <ScreenMessage title="Preparing the demo…">
        Loading this arena’s problem and starter functions.
      </ScreenMessage>
    );
  return (
    <DemoSession
      key={arena + ":" + problem.id + ":" + problem.version}
      arena={arena}
      problem={problem}
    />
  );
}
function DemoSession({
  arena,
  problem,
}: {
  arena: Arena;
  problem: PublicProblem;
}) {
  const storageKey = "dalgo:demo:session:v1:" + arena;
  const [state, setState] = useState(
    () =>
      restoreDemo(sessionRead(storageKey), arena, problem, Date.now()) ??
      createDemo(arena, problem, Date.now()),
  );
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    if (!cancelled)
      setStorageError(!sessionWrite(storageKey, JSON.stringify(state)));
  }, [state, cancelled, storageKey]);
  useEffect(() => {
    if (cancelled) return;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      setState((s) => advanceDemo(s, time, problem));
    };
    const timer = setInterval(tick, 250);
    window.addEventListener("pageshow", tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pageshow", tick);
    };
  }, [problem, cancelled]);
  function change(fn: (s: DemoState) => DemoState) {
    try {
      setError("");
      const next = fn(state);
      sessionWrite(storageKey, JSON.stringify(next));
      setState(next);
      setNow(Date.now());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function restart() {
    const next = createDemo(arena, problem, Date.now());
    sessionWrite(storageKey, JSON.stringify(next));
    setState(next);
    setNow(Date.now());
    setCancelled(false);
    setRestartOpen(false);
    setError("");
  }
  function cancel() {
    sessionWrite(storageKey, null);
    setCancelled(true);
    setError("");
  }
  const phase = demoPhase(state, now);
  const match = useMemo(
    () => toDemoMatch(state, problem, now),
    [state, problem, now],
  );
  return (
    <div
      data-demo-arena={arena}
      data-demo-phase={cancelled ? "cancelled" : phase}
      data-demo-session={state.id}
    >
      {cancelled ? (
        <div className="queue-page">
          <MatchTopbar arena={arena} demo />
          <DemoNotice />
          <section className="queue-stage">
            <span className="overline">SEARCH CLOSED</span>
            <h1>Demo search cancelled.</h1>
            <p>No opponent is waiting and no rating has changed.</p>
            <div className="queue-actions">
              <Link className="button" to="/">
                Back to the lobby
              </Link>
              <button className="button primary" onClick={restart}>
                Start again
                <ArrowRight size={17} />
              </button>
            </div>
          </section>
        </div>
      ) : phase === "searching" || phase === "ready" ? (
        <div className="queue-page">
          <MatchTopbar arena={arena} demo />
          <DemoNotice />
          <QueueStage
            arena={arena}
            phase={phase}
            elapsed={Math.min(15, Math.max(0, (now - state.queuedAt) / 1000))}
            readyIn={Math.max(0, (state.startsAt - now) / 1000)}
            demo
            error={
              error ||
              (storageError
                ? "Session storage is unavailable. This demo will restart if you reload."
                : "")
            }
            onCancel={cancel}
            onSkip={() => change((s) => skipDemoWait(s, Date.now()))}
          />
        </div>
      ) : (
        <MatchWorkspace
          key={state.id}
          match={match}
          now={now}
          userId={DEMO_USER}
          demo
          busy={!!state.pending}
          connection="Local demo"
          error={
            error ||
            (storageError
              ? "Session storage is unavailable; reload recovery is disabled."
              : "")
          }
          onAttempt={(kind, language) =>
            change((s) => previewAttempt(s, kind, language, Date.now()))
          }
          onResign={async () =>
            change((s) => finishDemo(s, "loss", Date.now(), "resigned"))
          }
          demoControls={{
            scenario: state.scenario,
            onScenario: (scenario) =>
              change((s) => setDemoScenario(s, scenario)),
            onShow: () => change((s) => finishDemo(s, s.scenario, Date.now())),
            onRestart: () => setRestartOpen(true),
          }}
        />
      )}
      {restartOpen && (
        <Modal title="Restart demo" onClose={() => setRestartOpen(false)}>
          <h2>Start a fresh match?</h2>
          <p>
            The demo clock, attempts, and current draft will reset. No real
            match or rating is affected.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setRestartOpen(false)}>
              Keep this demo
            </button>
            <button className="button primary" onClick={restart}>
              Restart demo
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
export function LiveMatchPage({ onSignIn }: { onSignIn: () => void }) {
  const { id = "" } = useParams();
  const { user } = useAuth();
  return (
    <LiveSession
      key={id + ":" + (user?.id ?? "guest")}
      id={id}
      userId={user?.id ?? ""}
      onSignIn={onSignIn}
    />
  );
}
function LiveSession({
  id,
  userId,
  onSignIn,
}: {
  id: string;
  userId: string;
  onSignIn: () => void;
}) {
  const session = useLiveMatch(id, userId);
  if (!userId)
    return (
      <ScreenMessage
        title="Sign in to your match."
        action={
          <button className="button primary" onClick={onSignIn}>
            Sign in
          </button>
        }
      >
        Your match clock continues while you’re away.
      </ScreenMessage>
    );
  if (!session.match)
    return (
      <ScreenMessage
        title={
          session.error ? "Match unavailable." : "Reconnecting to your match…"
        }
        action={
          session.error ? (
            <button className="button primary" onClick={session.retry}>
              Retry connection
            </button>
          ) : undefined
        }
      >
        {session.error || "Restoring the server clock and your attempts."}
      </ScreenMessage>
    );
  return (
    <MatchWorkspace
      {...session}
      match={session.match}
      userId={userId}
      onAttempt={session.attempt}
      onResign={session.resign}
      onRetry={session.retry}
    />
  );
}
function MatchTopbar({
  arena,
  demo,
  children,
}: {
  arena: Arena;
  demo?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className="match-topbar">
      <div className="match-topbar-left">
        <Brand />
        <span className="match-context">{ARENAS[arena].name} arena</span>
      </div>
      <div className="match-topbar-right">
        <span className="badge">{demo ? "DEMO MATCH" : "RANKED 1v1"}</span>
        {children || (
          <Link className="quiet-button" to="/">
            <ArrowLeft size={14} />
            Lobby
          </Link>
        )}
      </div>
    </header>
  );
}
function ScreenMessage({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <main>
      <div className="match-topbar">
        <Brand />
        <Link className="quiet-button" to="/">
          Back to lobby
        </Link>
      </div>
      <section className="screen-message">
        <span className="overline">DALGO / MATCH</span>
        <h1>{title}</h1>
        <p>{children}</p>
        {action}
      </section>
    </main>
  );
}
function QueueStage({
  arena,
  phase,
  elapsed,
  readyIn = 5,
  demo,
  error,
  message,
  onCancel,
  onSkip,
  cancelling = false,
}: {
  arena: Arena;
  phase: "searching" | "ready" | "capacity" | "paused";
  elapsed: number;
  readyIn?: number;
  demo?: boolean;
  error?: string;
  message?: string;
  onCancel: () => void;
  onSkip?: () => void;
  cancelling?: boolean;
}) {
  const ready = phase === "ready";
  const paused = phase === "paused";
  return (
    <section className="queue-stage">
      <span className="overline">
        {ARENAS[arena].name.toUpperCase()} / {ARENAS[arena].duration / 60} MIN /{" "}
        {demo ? "DEMO" : "RANKED"}
      </span>
      <h1>
        {phase === "capacity"
          ? "Today’s capacity is full."
          : paused
            ? "Search paused."
            : ready
              ? "Opponent assigned."
              : "Finding an opponent."}
      </h1>
      <p>
        {message ||
          (paused ? error || "This search is no longer active." : undefined) ||
          (ready
            ? "A simulated opponent has joined. The match starts when preparation ends."
            : demo
              ? "This demo shows the human-first search, followed by a simulated bot. No real player is being contacted."
              : "Searching near your rating. An eligible human takes priority over a simulated bot.")}
      </p>
      <div className="queue-clock">
        {ready
          ? String(Math.ceil(readyIn)).padStart(2, "0")
          : formatClock(elapsed)}
        <small>{ready ? "seconds to start" : "elapsed"}</small>
      </div>
      <div
        className="queue-track"
        role="progressbar"
        aria-label={ready ? "Preparation countdown" : "Opponent search"}
        aria-valuemin={0}
        aria-valuemax={ready ? 5 : 15}
        aria-valuenow={Math.min(
          ready ? 5 : 15,
          Math.floor(ready ? 5 - readyIn : elapsed),
        )}
      >
        <span
          style={{
            width:
              Math.min(
                100,
                ready ? ((5 - readyIn) / 5) * 100 : (elapsed / 15) * 100,
              ) + "%",
          }}
        />
      </div>
      <div className="queue-steps">
        <span className={!ready ? "current" : ""}>01 / Human-first search</span>
        <span className={ready ? "current" : ""}>02 / Opponent assigned</span>
        <span>03 / Match starts</span>
      </div>
      <div className="pairing-sheet">
        <div className="pairing-row">
          <span className="avatar">Y</span>
          <div>
            <strong>You{demo ? " · Demo" : ""}</strong>
            <small>
              {ready
                ? "Ready to play"
                : paused
                  ? "Search stopped"
                  : "Waiting for assignment"}
            </small>
          </div>
          <span className="mono">{demo ? "1,200" : ""}</span>
        </div>
        <div className="pairing-row">
          <span className="avatar bot">
            {ready ? <Code2 size={20} /> : <Swords size={20} />}
          </span>
          <div>
            <strong>
              {ready
                ? "Vector · Simulated bot"
                : paused
                  ? "Search stopped"
                  : "Searching for a human"}
            </strong>
            <small>
              {ready
                ? "Demo opponent · no execution credits"
                : paused
                  ? "No new opponent will be assigned"
                  : "Rating window expands while you wait"}
            </small>
          </div>
          <span className="mono">{ready ? "1,200" : "—"}</span>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="queue-actions">
        <button className="button" disabled={cancelling} onClick={onCancel}>
          {cancelling
            ? "Cancelling…"
            : paused
              ? "Back to lobby"
              : ready
                ? "Cancel demo"
                : "Cancel search"}
        </button>
        {demo && (
          <button className="quiet-button" onClick={onSkip}>
            {ready ? "Skip preparation" : "Skip search"}
            <SkipForward size={16} />
          </button>
        )}
      </div>
      <p className="queue-footnote">
        {demo
          ? "Skipping affects this demo only. The normal search lasts 15 seconds."
          : paused
            ? "Start another search from the lobby when matches are available."
            : "If no suitable human is found after 15 seconds, a clearly labelled bot is assigned."}
      </p>
    </section>
  );
}
export function LiveQueue({
  arena,
  onClose,
  resume = false,
}: {
  arena: Arena;
  onClose: () => void;
  resume?: boolean;
}) {
  const [queue, setQueue] = useState<QueueView | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const [cancelling, setCancelling] = useState(false);
  const requestId = useRef<string>(crypto.randomUUID());
  const joining = useRef<Promise<QueueView> | null>(null);
  const joinResolved = useRef(false);
  const clockOffset = useRef(0);
  const navigate = useNavigate();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | undefined;
    let last = 0;
    const update = (q: QueueView) => {
      if (stopped || q.serverNow < last) return;
      last = q.serverNow;
      clockOffset.current = q.serverNow - Date.now();
      if (q.requestId) requestId.current = q.requestId;
      setQueue((prev) =>
        prev?.status === "capacity" && q.status === "idle" && !q.message
          ? prev
          : q,
      );
      if (q.matchId) {
        navigate("/match/" + q.matchId);
        closeRef.current();
      }
    };
    joinResolved.current = false;
    // Resuming is read-only: an expired or paused search must never create a
    // new reservation merely because the player reopened its panel.
    joining.current = resume
      ? api<QueueView>("/queue")
      : api<QueueView>("/queue", {
          method: "POST",
          body: JSON.stringify({ arena, requestId: requestId.current }),
        });
    joining.current
      .then((q) => {
        if (!stopped) joinResolved.current = true;
        update(q);
      })
      .catch((e) => {
        if (!stopped) setError(e.message);
      });
    connectEvents("/queue/events", (v) => {
      if (v.type === "queue") update(v.data);
    })
      .then((s) => {
        socket = s;
        if (stopped) s.close();
      })
      .catch(() => {});
    const tick = setInterval(
      () => setNow(Date.now() + clockOffset.current),
      250,
    );
    const poll = setInterval(
      () =>
        api<QueueView>("/queue")
          .then(update)
          .catch((e) => {
            if (!stopped) setError(e.message);
          }),
      2500,
    );
    return () => {
      stopped = true;
      clearInterval(tick);
      clearInterval(poll);
      socket?.close();
    };
  }, [arena, navigate, resume]);
  async function cancel() {
    if (cancelling) return;
    if (joinResolved.current && queue?.status === "idle") {
      onClose();
      return;
    }
    setCancelling(true);
    try {
      try {
        const joined = await joining.current;
        if (joined?.requestId) requestId.current = joined.requestId;
      } catch {}
      const q = await api<QueueView>("/queue", {
        method: "DELETE",
        body: JSON.stringify({ requestId: requestId.current }),
      });
      if (q.matchId) {
        navigate("/match/" + q.matchId);
        onClose();
      } else if (q.status === "idle") onClose();
      else setError("The search is still active. Please try cancelling again.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCancelling(false);
    }
  }
  return (
    <Modal title="Matchmaking" onClose={() => void cancel()}>
      <QueueStage
        arena={arena}
        phase={
          queue?.status === "capacity"
            ? "capacity"
            : (!queue && error) || queue?.status === "idle"
              ? "paused"
              : "searching"
        }
        elapsed={Math.max(0, (now - (queue?.joinedAt ?? now)) / 1000)}
        message={queue?.message}
        error={error}
        onCancel={() => void cancel()}
        cancelling={cancelling}
      />
    </Modal>
  );
}
interface DemoControls {
  scenario: DemoScenario;
  onScenario: (scenario: DemoScenario) => void;
  onShow: () => void;
  onRestart: () => void;
}
interface WorkspaceProps {
  match: MatchView;
  now: number;
  userId: string;
  demo?: boolean;
  busy: boolean;
  connection: string;
  error: string;
  retryKind?: "run" | "submit" | null;
  onAttempt: (
    kind: "run" | "submit",
    language: Language,
    source: string,
  ) => void;
  onResign: () => Promise<void>;
  onRetry?: () => void;
  demoControls?: DemoControls;
}
function useDraft(key: string, starter: string, demo: boolean) {
  const initial = useMemo(() => {
    try {
      return (demo ? sessionStorage : localStorage).getItem(key) ?? starter;
    } catch {
      return starter;
    }
  }, [key, starter, demo]);
  const [edit, setEdit] = useState({ key, value: initial });
  const [saved, setSaved] = useState(true);
  const value = edit.key === key ? edit.value : initial;
  const update = useCallback(
    (value: string) => {
      setEdit({ key, value });
      try {
        (demo ? sessionStorage : localStorage).setItem(key, value);
        setSaved(true);
      } catch {
        setSaved(false);
      }
    },
    [key, demo],
  );
  return { source: value, update, saved };
}
function MatchWorkspace({
  match,
  now,
  userId,
  demo = false,
  busy,
  connection,
  error,
  retryKind,
  onAttempt,
  onResign,
  onRetry,
  demoControls,
}: WorkspaceProps) {
  const problem = match.problem;
  const preferencesKey = `dalgo:${demo ? "demo" : "live"}:language:${userId}:${match.id}`;
  const [language, setLanguage] = useState<Language>(() => {
    const stored = sessionRead(preferencesKey);
    return stored && Object.hasOwn(LANGUAGES, stored)
      ? (stored as Language)
      : "python";
  });
  const draftKey = `dalgo:${demo ? "demo" : "live"}:draft:${userId}:${match.id}:${problem.id}:v${problem.version}:${language}`;
  const { source, update, saved } = useDraft(
    draftKey,
    problem.starter[language],
    demo,
  );
  const [tab, setTab] = useState<"problem" | "code">("problem");
  const [ratio, setRatio] = useState(43);
  const [resigning, setResigning] = useState(false);
  const [resignBusy, setResignBusy] = useState(false);
  const [resignError, setResignError] = useState("");
  const [resultDismissed, setResultDismissed] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const stoppedClock = useRef<number | null>(null);
  if (match.result && stoppedClock.current === null) stoppedClock.current = now;
  const seconds = Math.max(
    0,
    (match.endsAt - (stoppedClock.current ?? now)) / 1000,
  );
  const ready = now < match.startsAt;
  const active =
    match.status === "active" && !ready && now < match.endsAt && !match.result;
  const limits = match.attemptLimits ?? DEFAULT_ATTEMPT_LIMITS;
  const pending = match.submissions.some(
    (s) => s.verdict === "pending" && s.userId === userId,
  );
  const latest = match.submissions.filter((s) => s.userId === userId).at(-1);
  const own = match.players.find((p) => p.id === userId);
  const opponent = match.players.find((p) => p.id !== userId);
  const [dragging, setDragging] = useState(false);
  const setLang = (lang: Language) => {
    sessionWrite(preferencesKey, lang);
    setLanguage(lang);
  };
  function drag(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  }
  const onDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragging && splitRef.current) {
      const rect = splitRef.current.getBoundingClientRect();
      setRatio(
        Math.max(
          28,
          Math.min(65, ((e.clientX - rect.left) / rect.width) * 100),
        ),
      );
    }
  };
  return (
    <main className="match-page">
      <MatchTopbar arena={match.arena} demo={demo}>
        {!match.result ? (
          <button
            className="quiet-button"
            onClick={() => setResigning(true)}
            disabled={ready}
          >
            <Flag size={14} />
            {demo ? "Resign demo" : "Resign"}
          </button>
        ) : (
          <Link className="quiet-button" to="/">
            <ArrowLeft size={14} />
            Lobby
          </Link>
        )}
      </MatchTopbar>
      {demo && <DemoNotice />}
      <div className="duel-board">
        <div className="duel-player">
          <span className="avatar">Y</span>
          <div>
            <div className="player-name">
              {demo ? "You" : (own?.name ?? "You")}
              <span className="badge">YOU</span>
            </div>
            <div className="player-rating">
              {own?.rating.toLocaleString() ?? "—"} ·{" "}
              {demo ? "Example rating" : "Pre-match rating"}
            </div>
          </div>
          <span className="player-status">
            {match.result
              ? "Finished"
              : pending
                ? "Judging"
                : ready
                  ? "Ready"
                  : "Solving"}
          </span>
        </div>
        <div
          className={"match-clock " + (seconds < 60 && !ready ? "urgent" : "")}
          role="timer"
          aria-label={ready ? "Match starts in" : "Match time remaining"}
        >
          {formatClock(ready ? (match.startsAt - now) / 1000 : seconds)}
          <span>
            {match.result
              ? "Match complete"
              : ready
                ? "Starts in"
                : demo
                  ? "Demo clock"
                  : "Shared clock"}
          </span>
        </div>
        <div className="duel-player opponent">
          <span className="player-status">
            {match.opponentStatus || "Connecting"}
          </span>
          <div>
            <div className="player-name">
              {demo ? "Vector" : (opponent?.name ?? "Connecting")}
              {opponent?.isBot && <span className="badge">BOT</span>}
            </div>
            <div className="player-rating">
              {opponent?.rating.toLocaleString() ?? "—"} ·{" "}
              {opponent?.isBot ? "Simulated bot" : "Human opponent"}
            </div>
          </div>
          <span className="avatar bot">
            {opponent?.isBot ? <Code2 size={20} /> : <Swords size={20} />}
          </span>
        </div>
      </div>
      <div className="match-meta">
        <div>
          <span className="connection-label">
            {connection.includes("interrupted") ? (
              <WifiOff size={13} />
            ) : (
              <Wifi size={13} />
            )}{" "}
            {connection}
          </span>
          <span>
            {ARENAS[match.arena].name} · {ARENAS[match.arena].duration / 60} min
          </span>
        </div>
        <span className="attempt-label">
          {Math.max(0, limits.runs - match.attempts.runs)}/{limits.runs}{" "}
          {demo ? "run previews" : "runs"} ·{" "}
          {Math.max(0, limits.submits - match.attempts.submits)}/
          {limits.submits} {demo ? "submission previews" : "submissions"} left
        </span>
      </div>
      {error && (
        <div className="match-error" role="alert">
          <span>{error}</span>
          {onRetry && (
            <button className="quiet-button" disabled={busy} onClick={onRetry}>
              {retryKind ? "Retry request" : "Retry connection"}
            </button>
          )}
        </div>
      )}
      {match.result && (
        <div className="result-inline">
          <span>
            {demo
              ? "Illustrative result"
              : match.result.settled
                ? "Match complete"
                : "Saving result"}{" "}
            ·{" "}
            {match.result.reason === "void"
              ? "Match voided"
              : !match.result.winnerId
                ? "Draw"
                : match.result.winnerId === userId
                  ? "You win"
                  : "Opponent wins"}
          </span>
          <button className="button" onClick={() => setResultDismissed(false)}>
            View result
          </button>
        </div>
      )}
      <div className="mobile-tabs" role="tablist" aria-label="Match workspace">
        {(["problem", "code"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            id={t + "-tab"}
            aria-controls={t + "-panel"}
            aria-selected={t === tab}
            tabIndex={t === tab ? 0 : -1}
            onClick={() => setTab(t)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const next = t === "problem" ? "code" : "problem";
                setTab(next);
                document.getElementById(next + "-tab")?.focus();
              }
            }}
          >
            {t === "problem" ? "Problem" : "Code"}
          </button>
        ))}
      </div>
      <div
        className={"workspace show-" + tab}
        ref={splitRef}
        style={{ "--split": ratio + "%" } as React.CSSProperties}
      >
        <section
          id="problem-panel"
          className="problem-panel"
          aria-label="Problem statement"
        >
          <div className="panel-heading">
            <span>
              <BookIcon />
              Problem
            </span>
            <span className="overline">FUNCTION / SOLVE</span>
          </div>
          <div className="problem-scroll">
            <div className="problem-meta">
              <span className={"difficulty " + problem.arena}>
                {ARENAS[problem.arena].name}
              </span>
              <span>{problem.topic}</span>
            </div>
            <h1>{problem.title}</h1>
            {problem.description
              .split("\n")
              .filter(Boolean)
              .map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            <div className="function-signature">
              <Code2 size={16} />
              <code>
                solve({problem.parameters.map((p) => p.name).join(", ")})
              </code>
            </div>
            {problem.examples.map((example, i) => (
              <div className="example" key={i}>
                <h3>Example {i + 1}</h3>
                <div className="example-code">
                  <p>
                    <span>Input</span>
                    {problem.parameters
                      .map(
                        (p, j) =>
                          p.name + " = " + JSON.stringify(example.args[j]),
                      )
                      .join(", ")}
                  </p>
                  <p>
                    <span>Output</span>
                    {JSON.stringify(example.expected)}
                  </p>
                </div>
                <p className="example-explanation">{example.explanation}</p>
              </div>
            ))}
            <h3>Constraints</h3>
            <ul className="constraints">
              {problem.constraints.map((c) => (
                <li key={c}>
                  <code>{c}</code>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <div
          className="resize-handle"
          role="separator"
          aria-label="Resize problem and editor panels"
          aria-orientation="vertical"
          aria-valuenow={Math.round(ratio)}
          aria-valuemin={28}
          aria-valuemax={65}
          tabIndex={0}
          onPointerDown={drag}
          onPointerMove={onDrag}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onLostPointerCapture={() => setDragging(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              setRatio((x) =>
                Math.max(
                  28,
                  Math.min(65, x + (e.key === "ArrowRight" ? 2 : -2)),
                ),
              );
            }
          }}
        >
          <GripVertical size={14} />
        </div>
        <section
          id="code-panel"
          className="editor-panel"
          aria-label="Code editor"
        >
          <div className="editor-actions">
            <span className="overline">
              {demo ? "ILLUSTRATIVE ONLY" : "SAMPLE / HIDDEN TESTS"}
            </span>
            <button
              className="button"
              disabled={
                !active ||
                busy ||
                pending ||
                !!retryKind ||
                match.attempts.runs >= limits.runs
              }
              onClick={() => onAttempt("run", language, source)}
            >
              <Play size={14} />
              {demo ? "Preview run" : "Run"}
            </button>
            <button
              className="button primary"
              disabled={
                !active ||
                busy ||
                pending ||
                !!retryKind ||
                match.attempts.submits >= limits.submits
              }
              onClick={() => onAttempt("submit", language, source)}
            >
              {busy ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <ArrowRight size={15} />
              )}{" "}
              {demo ? "Preview submission" : "Submit"}
            </button>
          </div>
          <div className="panel-heading editor-heading">
            <label>
              <Code2 size={16} />
              <select
                aria-label="Programming language"
                value={language}
                onChange={(e) => setLang(e.target.value as Language)}
              >
                {Object.entries(LANGUAGES).map(([id, l]) => (
                  <option value={id} key={id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="editor-tools">
              <span className="saved-label">
                <Check size={12} />
                {saved
                  ? demo
                    ? "Session draft"
                    : "Saved locally"
                  : "Draft not saved"}
              </span>
              <button
                className="icon-button"
                disabled={!!match.result}
                title="Reset starter code"
                aria-label="Reset starter code"
                onClick={() => setResetOpen(true)}
              >
                <RotateCcw size={15} />
              </button>
            </div>
          </div>
          <div className="editor-wrap">
            <Suspense
              fallback={<div className="panel-loading">Opening editor…</div>}
            >
              <Editor
                height="100%"
                language={LANGUAGES[language].monaco}
                value={source}
                onChange={(value) => update(value ?? "")}
                beforeMount={(m) =>
                  m.editor.defineTheme("dalgo-club", {
                    base: "vs-dark",
                    inherit: true,
                    rules: [
                      { token: "comment", foreground: "969696" },
                      { token: "keyword", foreground: "b7b6f5" },
                      { token: "string", foreground: "9dd4bb" },
                      { token: "number", foreground: "e1c398" },
                    ],
                    colors: {
                      "editor.background": "#101010",
                      "editor.foreground": "#e2e2e2",
                      "editorLineNumber.foreground": "#939393",
                      "editorLineNumber.activeForeground": "#d6d6d6",
                      "editor.lineHighlightBackground": "#1c1c1c",
                      "editorCursor.foreground": "#eeeeee",
                      "editor.selectionBackground": "#424242",
                      "editor.inactiveSelectionBackground": "#323232",
                      "editor.selectionHighlightBackground": "#33333380",
                      "editor.wordHighlightBackground": "#33333380",
                      "editor.wordHighlightStrongBackground": "#44444480",
                      "editorWidget.background": "#202020",
                      "editorWidget.border": "#444444",
                      "editorSuggestWidget.background": "#202020",
                      "editorSuggestWidget.border": "#444444",
                      "editorSuggestWidget.selectedBackground": "#383838",
                      "editorSuggestWidget.highlightForeground": "#f5f5f5",
                      "editorHoverWidget.background": "#202020",
                      "editorHoverWidget.border": "#444444",
                      "focusBorder": "#bdbdbd",
                      "input.background": "#161616",
                      "input.border": "#555555",
                      "input.foreground": "#e8e8e8",
                      "list.activeSelectionBackground": "#333333",
                      "list.activeSelectionForeground": "#f5f5f5",
                      "list.focusBackground": "#333333",
                      "list.focusForeground": "#f5f5f5",
                      "scrollbarSlider.background": "#77777755",
                      "scrollbarSlider.hoverBackground": "#99999966",
                      "scrollbarSlider.activeBackground": "#bbbbbb77",
                    },
                  })
                }
                theme="dalgo-club"
                options={{
                  fontFamily: "JetBrains Mono",
                  fontSize: 14,
                  lineHeight: 25,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  padding: { top: 19 },
                  automaticLayout: true,
                  tabSize: 4,
                  wordWrap: "on",
                  renderLineHighlight: "line",
                  overviewRulerLanes: 0,
                  hideCursorInOverviewRuler: true,
                  readOnly: !!match.result,
                  ariaLabel: "Solution code editor",
                  tabFocusMode: true,
                }}
                loading={
                  <div className="panel-loading">
                    <LoaderCircle size={18} className="spin" />
                    Opening editor…
                  </div>
                }
              />
            </Suspense>
          </div>
          <div className="console-panel">
            <div className="console-heading">
              <span>{demo ? "Example verdicts" : "Test results"}</span>
              <span>
                {latest
                  ? latest.kind === "run"
                    ? "Samples"
                    : "Submission"
                  : `${problem.examples.length} sample case${problem.examples.length === 1 ? "" : "s"}`}
              </span>
            </div>
            <div className="console-body" aria-live="polite">
              {latest ? (
                <>
                  <div className={"verdict " + latest.verdict}>
                    {latest.verdict === "pending" ? (
                      <LoaderCircle size={15} className="spin" />
                    ) : latest.verdict === "accepted" ? (
                      <CheckCircle2 size={15} />
                    ) : (
                      <AlertCircle size={15} />
                    )}
                    <strong>
                      {demo ? "Illustrative · " : ""}
                      {latest.verdict.replaceAll("_", " ")}
                    </strong>
                  </div>
                  <p>{latest.message}</p>
                  {latest.kind === "run" && latest.sampleResults && (
                    <div className="console-cases">
                      {latest.sampleResults.map((r, i) => (
                        <details className="console-case" key={i}>
                          <summary>
                            Case {i + 1} · {r.passed ? "passed" : "failed"}
                          </summary>
                          <div>
                            <strong>Expected</strong>
                            <pre>
                              <code>{sampleValue(r.expected)}</code>
                            </pre>
                            <strong>Actual</strong>
                            <pre>
                              <code>{sampleValue(r.actual)}</code>
                            </pre>
                          </div>
                        </details>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <p>
                  {demo
                    ? "Preview run shows the supplied example outputs. Your code is not executed."
                    : "Run the samples to check your code. Submit to judge every hidden test."}
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
      {demoControls && (
        <div className="demo-controls">
          <div>
            <span className="overline">DEMO CONTROLS</span>
            <select
              aria-label="Example result scenario"
              value={demoControls.scenario}
              disabled={busy || !!match.result}
              onChange={(e) =>
                demoControls.onScenario(e.target.value as DemoScenario)
              }
            >
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              className="button"
              disabled={busy || !!match.result}
              onClick={demoControls.onShow}
            >
              Show example result
            </button>
          </div>
          <button className="quiet-button" onClick={demoControls.onRestart}>
            <RotateCcw size={14} />
            Restart demo
          </button>
        </div>
      )}
      {resigning && (
        <Modal
          title={demo ? "Resign demo" : "Resign match"}
          onClose={() => {
            if (!resignBusy) setResigning(false);
          }}
        >
          <h2>{demo ? "Preview a resignation?" : "Resign this match?"}</h2>
          <p>
            {demo
              ? "This displays an illustrative loss. Your real rating is unchanged."
              : "Resigning counts as a loss and changes this arena’s rating."}
          </p>
          {resignError && (
            <p className="error" role="alert">
              {resignError}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="button"
              disabled={resignBusy}
              onClick={() => setResigning(false)}
            >
              Keep playing
            </button>
            <button
              className="button danger"
              disabled={resignBusy}
              onClick={async () => {
                setResignBusy(true);
                setResignError("");
                try {
                  await onResign();
                  setResigning(false);
                } catch (e) {
                  setResignError((e as Error).message);
                } finally {
                  setResignBusy(false);
                }
              }}
            >
              {resignBusy
                ? "Resigning…"
                : demo
                  ? "Resign demo"
                  : "Resign match"}
            </button>
          </div>
        </Modal>
      )}
      {resetOpen && (
        <Modal title="Reset starter" onClose={() => setResetOpen(false)}>
          <h2>Reset this draft?</h2>
          <p>
            Your {LANGUAGES[language].name} code will be replaced by the starter
            function.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setResetOpen(false)}>
              Keep code
            </button>
            <button
              className="button primary"
              onClick={() => {
                update(problem.starter[language]);
                setResetOpen(false);
              }}
            >
              Reset code
            </button>
          </div>
        </Modal>
      )}
      {match.result && !resultDismissed && (
        <Modal
          title={demo ? "Example result" : "Match result"}
          onClose={() => setResultDismissed(true)}
        >
          <ResultSheet
            match={match}
            demo={demo}
            userId={userId}
            onReview={() => setResultDismissed(true)}
            onRestart={demoControls?.onRestart}
          />
        </Modal>
      )}
    </main>
  );
}
function BookIcon() {
  return <Code2 size={15} />;
}
function ResultSheet({
  match,
  demo,
  userId,
  onReview,
  onRestart,
}: {
  match: MatchView;
  demo: boolean;
  userId: string;
  onReview: () => void;
  onRestart?: () => void;
}) {
  const result = match.result!;
  const won = result.winnerId === userId;
  const isVoid = result.reason === "void";
  const draw = !result.winnerId && !isVoid;
  const delta = result.deltas[userId] ?? 0;
  const before = match.players.find((p) => p.id === userId)?.rating ?? 1200;
  return (
    <section className="result-sheet">
      <span className="overline">
        {demo
          ? "ILLUSTRATIVE / NO RATINGS SAVED"
          : result.settled
            ? "MATCH SETTLED"
            : "SAVING RESULT"}
      </span>
      <h2>
        {isVoid
          ? "Match voided."
          : draw
            ? "A draw."
            : won
              ? "You win."
              : "Opponent wins."}
      </h2>
      <p>
        {isVoid
          ? "The judge could not produce a reliable result. Both ratings remain unchanged."
          : result.reason === "resigned"
            ? won
              ? "Your opponent resigned. You win this match."
              : "You resigned from the match. Resignation counts as a loss."
            : draw
              ? "Neither player finished first. There is no rating change."
              : won
                ? "Your accepted solution arrived first."
                : "Your opponent’s accepted solution arrived first."}
        {demo
          ? " This is a selected example, not an assessment of your code."
          : ""}
      </p>
      <div className="result-score">
        <div className={delta > 0 ? "positive" : delta < 0 ? "negative" : ""}>
          {delta > 0 ? "+" : ""}
          {delta}
          <span>{demo ? "Illustrative Elo change" : "Elo change"}</span>
        </div>
        <div className="result-rating-example">
          {before.toLocaleString()} <span style={{ display: "inline" }}>→</span>{" "}
          {(before + delta).toLocaleString()}
          <span>
            {ARENAS[match.arena].name} ·{" "}
            {match.mode === "bot" ? "Bot" : "Human"} rating
            {demo ? " example" : ""}
          </span>
        </div>
      </div>
      <div className="result-submissions">
        <span className="overline">
          {demo ? "EXAMPLE VERDICTS" : "YOUR SUBMISSIONS"}
        </span>
        {match.submissions.length ? (
          match.submissions.map((s, i) => (
            <div key={s.id} className="result-submission">
              <span>
                {s.kind === "run" ? "Run" : "Submission"} {i + 1} ·{" "}
                {LANGUAGES[s.language].name}
              </span>
              <strong>{s.verdict.replaceAll("_", " ")}</strong>
            </div>
          ))
        ) : (
          <p className="fine-print">
            {demo
              ? "This outcome was opened with the demo controls. No code was judged."
              : "No submissions were received."}
          </p>
        )}
      </div>
      {!result.settled && (
        <p className="fine-print">
          Your result is being saved. A new ranked match will become available
          when settlement completes.
        </p>
      )}
      {demo && (
        <p className="fine-print">
          Demo results never appear in your history or the leaderboard.
        </p>
      )}
      <div className="result-actions">
        <button className="button" onClick={onReview}>
          Review workspace
        </button>
        {demo ? (
          <button
            className="button primary"
            onClick={() => {
              onReview();
              onRestart?.();
            }}
          >
            New demo
            <ArrowRight size={16} />
          </button>
        ) : (
          <Link className="button primary" to="/">
            Back to lobby
            <ArrowRight size={16} />
          </Link>
        )}
      </div>
    </section>
  );
}
