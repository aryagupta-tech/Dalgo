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
  ChevronDown,
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
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  LinearProgress,
  NativeSelect,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
  useMediaQuery,
} from "@mui/material";
const MONO = '"JetBrains Mono", monospace';
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
          <Button variant="contained" onClick={retry}>
            Try again
          </Button>
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
        <Box
          sx={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}
        >
          <MatchTopbar arena={arena} demo />
          <DemoNotice />
          <Box
            component="section"
            sx={{
              width: "100%",
              maxWidth: 680,
              mx: "auto",
              px: 2.5,
              my: { xs: 4, sm: 7 },
            }}
          >
            <Typography variant="overline">SEARCH CLOSED</Typography>
            <Typography
              variant="h1"
              sx={{ fontSize: { xs: 30, sm: 40 }, my: 1.75 }}
            >
              Demo search cancelled.
            </Typography>
            <Typography color="text.secondary">
              No opponent is waiting and no rating has changed.
            </Typography>
            <Stack
              direction="row"
              sx={{ mt: 3, justifyContent: "space-between", gap: 1.5 }}
            >
              <Button component={Link} variant="outlined" to="/">
                Back to the lobby
              </Button>
              <Button
                variant="contained"
                onClick={restart}
                endIcon={<ArrowRight size={17} />}
              >
                Start again
              </Button>
            </Stack>
          </Box>
        </Box>
      ) : phase === "searching" || phase === "ready" ? (
        <Box
          sx={{ minHeight: "100dvh", display: "flex", flexDirection: "column" }}
        >
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
        </Box>
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
          <Typography variant="h2" sx={{ fontSize: 26, mb: 1.5 }}>
            Start a fresh match?
          </Typography>
          <Typography color="text.secondary">
            The demo clock, attempts, and current draft will reset. No real
            match or rating is affected.
          </Typography>
          <Stack
            direction="row"
            sx={{ mt: 3, justifyContent: "flex-end", gap: 1.5 }}
          >
            <Button variant="outlined" onClick={() => setRestartOpen(false)}>
              Keep this demo
            </Button>
            <Button variant="contained" onClick={restart}>
              Restart demo
            </Button>
          </Stack>
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
          <Button variant="contained" onClick={onSignIn}>
            Sign in
          </Button>
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
            <Button variant="contained" onClick={session.retry}>
              Retry connection
            </Button>
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
    <Stack
      component="header"
      direction="row"
      sx={{
        minHeight: 57,
        px: { xs: 1.75, sm: 3 },
        py: 1.25,
        bgcolor: "#0c0c0c",
        borderBottom: 1,
        borderColor: "divider",
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "space-between",
        gap: { xs: 1, sm: 2 },
      }}
    >
      <Stack
        direction="row"
        sx={{ alignItems: "center", gap: { xs: 1.5, sm: 2.5 } }}
      >
        <Brand />
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            borderLeft: 1,
            borderColor: "divider",
            pl: { xs: 1.5, sm: 2.5 },
            fontSize: { xs: 12, sm: 14 },
          }}
        >
          {ARENAS[arena].name} arena
        </Typography>
      </Stack>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1.5 }}>
        <Chip
          variant="outlined"
          size="small"
          label={demo ? "DEMO MATCH" : "RANKED 1v1"}
          sx={{ display: { xs: "none", sm: "inline-flex" }, fontSize: 11 }}
        />
        {children || (
          <Button
            component={Link}
            to="/"
            variant="text"
            size="small"
            startIcon={<ArrowLeft size={14} />}
          >
            Lobby
          </Button>
        )}
      </Stack>
    </Stack>
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
    <Box component="main">
      <Stack
        component="header"
        direction="row"
        sx={{
          px: 3,
          py: 1.5,
          borderBottom: 1,
          borderColor: "divider",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Brand />
        <Button component={Link} to="/" variant="text">
          Back to lobby
        </Button>
      </Stack>
      <Box
        component="section"
        sx={{ maxWidth: 580, mx: "auto", my: { xs: 6, sm: 12.5 }, p: 3.5 }}
      >
        <Typography variant="overline" color="text.secondary">
          DALGO / MATCH
        </Typography>
        <Typography variant="h1" sx={{ fontSize: 32, my: 2 }}>
          {title}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1.5, mb: 3 }}>
          {children}
        </Typography>
        {action}
      </Box>
    </Box>
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
  const progress = Math.min(
    100,
    Math.max(0, ready ? ((5 - readyIn) / 5) * 100 : (elapsed / 15) * 100),
  );
  return (
    <Box
      component="section"
      sx={{
        width: "100%",
        maxWidth: 680,
        mx: "auto",
        px: { xs: 2.25, sm: 2.5 },
        my: { xs: 4, sm: 5 },
      }}
    >
      <Typography variant="overline">
        {ARENAS[arena].name.toUpperCase()} / {ARENAS[arena].duration / 60} MIN /{" "}
        {demo ? "DEMO" : "RANKED"}
      </Typography>
      <Typography variant="h1" sx={{ fontSize: { xs: 30, sm: 40 }, my: 1.75 }}>
        {phase === "capacity"
          ? "Today’s capacity is full."
          : paused
            ? "Search paused."
            : ready
              ? "Opponent assigned."
              : "Finding an opponent."}
      </Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 500 }}>
        {message ||
          (paused ? error || "This search is no longer active." : undefined) ||
          (ready
            ? "A simulated opponent has joined. The match starts when preparation ends."
            : demo
              ? "This demo shows the human-first search, followed by a simulated bot. No real player is being contacted."
              : "Searching near your rating. An eligible human takes priority over a simulated bot.")}
      </Typography>
      <Stack
        direction="row"
        sx={{ mt: 4.5, mb: 2.5, alignItems: "baseline", gap: 2 }}
      >
        <Typography
          component="span"
          sx={{
            fontFamily: MONO,
            fontSize: { xs: 54, sm: 72 },
            letterSpacing: "-.07em",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {ready
            ? String(Math.ceil(readyIn)).padStart(2, "0")
            : formatClock(elapsed)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {ready ? "seconds to start" : "elapsed"}
        </Typography>
      </Stack>
      <LinearProgress
        variant="determinate"
        value={progress}
        aria-label={ready ? "Preparation countdown" : "Opponent search"}
        aria-valuemin={0}
        aria-valuemax={ready ? 5 : 15}
        aria-valuenow={Math.min(
          ready ? 5 : 15,
          Math.max(0, Math.floor(ready ? 5 - readyIn : elapsed)),
        )}
        sx={{
          height: 3,
          mb: 3.5,
          bgcolor: "#333333",
          "& .MuiLinearProgress-bar": {
            bgcolor: "#eeeeee",
            "@media (prefers-reduced-motion: reduce)": { transition: "none" },
          },
        }}
      />
      <Stack
        direction="row"
        sx={{ mb: 3, justifyContent: "space-between", gap: 1.5 }}
      >
        <Typography
          variant="caption"
          color={!ready ? "text.primary" : "text.secondary"}
        >
          01 / Human-first search
        </Typography>
        <Typography
          variant="caption"
          color={ready ? "text.primary" : "text.secondary"}
        >
          02 / Opponent assigned
        </Typography>
        <Typography variant="caption" color="text.secondary">
          03 / Match starts
        </Typography>
      </Stack>
      <Stack
        divider={<Divider />}
        sx={{ borderTop: 1, borderBottom: 1, borderColor: "divider", my: 3 }}
      >
        <Stack direction="row" sx={{ py: 2.5, alignItems: "center", gap: 1.5 }}>
          <Avatar
            variant="rounded"
            sx={{
              bgcolor: "#242424",
              color: "text.primary",
              width: 40,
              height: 40,
            }}
          >
            Y
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 500 }}>
              You{demo ? " · Demo" : ""}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {ready
                ? "Ready to play"
                : paused
                  ? "Search stopped"
                  : "Waiting for assignment"}
            </Typography>
          </Box>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ ml: "auto", fontFamily: MONO }}
          >
            {demo ? "1,200" : ""}
          </Typography>
        </Stack>
        <Stack direction="row" sx={{ py: 2.5, alignItems: "center", gap: 1.5 }}>
          <Avatar
            variant="rounded"
            sx={{
              bgcolor: "#191919",
              color: "text.secondary",
              width: 40,
              height: 40,
            }}
          >
            {ready ? <Code2 size={20} /> : <Swords size={20} />}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 500 }}>
              {ready
                ? "Vector · Simulated bot"
                : paused
                  ? "Search stopped"
                  : "Searching for a human"}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {ready
                ? "Demo opponent · no execution credits"
                : paused
                  ? "No new opponent will be assigned"
                  : "Rating window expands while you wait"}
            </Typography>
          </Box>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ ml: "auto", fontFamily: MONO }}
          >
            {ready ? "1,200" : "—"}
          </Typography>
        </Stack>
      </Stack>
      {error && (
        <Alert severity="error" sx={{ my: 2 }}>
          {error}
        </Alert>
      )}
      <Stack
        direction="row"
        sx={{ mt: 3, justifyContent: "space-between", gap: 1.5 }}
      >
        <Button variant="outlined" disabled={cancelling} onClick={onCancel}>
          {cancelling
            ? "Cancelling…"
            : paused
              ? "Back to lobby"
              : ready
                ? "Cancel demo"
                : "Cancel search"}
        </Button>
        {demo && (
          <Button
            variant="text"
            endIcon={<SkipForward size={16} />}
            onClick={onSkip}
          >
            {ready ? "Skip preparation" : "Skip search"}
          </Button>
        )}
      </Stack>
      <Typography
        variant="caption"
        color="text.secondary"
        component="p"
        sx={{ mt: 2.5 }}
      >
        {demo
          ? "Skipping affects this demo only. The normal search lasts 15 seconds."
          : paused
            ? "Start another search from the lobby when matches are available."
            : "If no suitable human is found after 15 seconds, a clearly labelled bot is assigned."}
      </Typography>
    </Box>
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
  const narrow = useMediaQuery("(max-width: 640px)");
  const compact = useMediaQuery("(max-width: 950px)");
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
    <Box
      component="main"
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        minHeight: 0,
        overflow: "hidden",
        bgcolor: "#080808",
      }}
    >
      <MatchTopbar arena={match.arena} demo={demo}>
        {!match.result ? (
          <Button
            variant="text"
            size="small"
            startIcon={<Flag size={14} />}
            onClick={() => setResigning(true)}
            disabled={ready}
          >
            {demo ? "Resign demo" : "Resign"}
          </Button>
        ) : (
          <Button
            component={Link}
            to="/"
            variant="text"
            size="small"
            startIcon={<ArrowLeft size={14} />}
          >
            Lobby
          </Button>
        )}
      </MatchTopbar>
      {demo && <DemoNotice />}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: narrow
            ? "minmax(0, 1fr) 76px minmax(0, 1fr)"
            : "minmax(0, 1fr) 140px minmax(0, 1fr)",
          alignItems: "center",
          gap: narrow ? 1.25 : 2.5,
          minHeight: narrow ? 88 : 100,
          px: narrow ? 1.75 : 3,
          py: 2,
          bgcolor: "#111111",
          borderBottom: 1,
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <Stack
          direction="row"
          sx={{ minWidth: 0, alignItems: "center", gap: narrow ? 0.75 : 1.5 }}
        >
          {!compact && (
            <Avatar
              variant="rounded"
              sx={{
                bgcolor: "#242424",
                color: "text.primary",
                width: 40,
                height: 40,
              }}
            >
              Y
            </Avatar>
          )}
          <Box sx={{ minWidth: 0 }}>
            <Stack
              direction="row"
              sx={{ flexWrap: "wrap", alignItems: "center", gap: 1 }}
            >
              <Typography
                sx={{
                  fontFamily: '"Space Grotesk", sans-serif',
                  fontWeight: 500,
                  fontSize: narrow ? 14 : 16,
                  overflowWrap: "anywhere",
                }}
              >
                {demo ? "You" : (own?.name ?? "You")}
              </Typography>
              {!narrow && (
                <Chip
                  size="small"
                  variant="outlined"
                  label="YOU"
                  sx={{ fontSize: 10, height: 20 }}
                />
              )}
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              component="p"
              sx={{ mt: 0.5 }}
            >
              {own?.rating.toLocaleString() ?? "—"} ·{" "}
              {demo ? "Example rating" : "Pre-match rating"}
            </Typography>
            {compact && (
              <Typography
                variant="caption"
                color="text.secondary"
                component="p"
              >
                {match.result
                  ? "Finished"
                  : pending
                    ? "Judging"
                    : ready
                      ? "Ready"
                      : "Solving"}
              </Typography>
            )}
          </Box>
          {!compact && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ ml: "auto" }}
            >
              {match.result
                ? "Finished"
                : pending
                  ? "Judging"
                  : ready
                    ? "Ready"
                    : "Solving"}
            </Typography>
          )}
        </Stack>
        <Box
          role="timer"
          aria-label={ready ? "Match starts in" : "Match time remaining"}
          sx={{
            textAlign: "center",
            fontFamily: MONO,
            fontSize: narrow ? 23 : 32,
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-.05em",
            lineHeight: 1.15,
            color: seconds < 60 && !ready ? "#f0b694" : "text.primary",
          }}
        >
          {formatClock(ready ? (match.startsAt - now) / 1000 : seconds)}
          <Typography
            variant="caption"
            color="text.secondary"
            component="span"
            sx={{
              display: "block",
              mt: 0.75,
              letterSpacing: narrow ? 0 : ".06em",
              textTransform: "uppercase",
              fontSize: narrow ? 11 : 12,
            }}
          >
            {match.result
              ? "Match complete"
              : ready
                ? "Starts in"
                : demo
                  ? "Demo clock"
                  : "Shared clock"}
          </Typography>
        </Box>
        <Stack
          direction="row"
          sx={{
            minWidth: 0,
            textAlign: "right",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: narrow ? 0.75 : 1.5,
          }}
        >
          {!compact && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mr: "auto" }}
            >
              {match.opponentStatus || "Connecting"}
            </Typography>
          )}
          <Box sx={{ minWidth: 0 }}>
            <Stack
              direction="row"
              sx={{
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "flex-end",
                gap: 1,
              }}
            >
              <Typography
                sx={{
                  fontFamily: '"Space Grotesk", sans-serif',
                  fontSize: narrow ? 14 : 16,
                  fontWeight: 500,
                  overflowWrap: "anywhere",
                }}
              >
                {demo ? "Vector" : (opponent?.name ?? "Connecting")}
              </Typography>
              {opponent?.isBot && !narrow && (
                <Chip
                  size="small"
                  variant="outlined"
                  label="BOT"
                  sx={{ fontSize: 10, height: 20 }}
                />
              )}
            </Stack>
            <Typography
              variant="caption"
              color="text.secondary"
              component="p"
              sx={{ mt: 0.5 }}
            >
              {opponent?.rating.toLocaleString() ?? "—"} ·{" "}
              {opponent?.isBot ? "Simulated bot" : "Human opponent"}
            </Typography>
            {compact && (
              <Typography
                variant="caption"
                color="text.secondary"
                component="p"
              >
                {match.opponentStatus || "Connecting"}
              </Typography>
            )}
          </Box>
          {!compact && (
            <Avatar
              variant="rounded"
              sx={{
                bgcolor: "#191919",
                color: "text.secondary",
                width: 40,
                height: 40,
              }}
            >
              {opponent?.isBot ? <Code2 size={20} /> : <Swords size={20} />}
            </Avatar>
          )}
        </Stack>
      </Box>
      <Stack
        direction="row"
        sx={{
          px: narrow ? 1.75 : 3,
          py: 1.25,
          borderBottom: 1,
          borderColor: "divider",
          flexShrink: 0,
          alignItems: narrow ? "flex-start" : "center",
          justifyContent: "space-between",
          gap: 1.5,
        }}
      >
        <Stack
          direction="row"
          sx={{
            flexWrap: "wrap",
            minWidth: 0,
            alignItems: "center",
            gap: narrow ? 0.75 : 1.75,
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
          >
            {connection.includes("interrupted") ? (
              <WifiOff size={13} />
            ) : (
              <Wifi size={13} />
            )}{" "}
            {connection}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {ARENAS[match.arena].name} · {ARENAS[match.arena].duration / 60} min
          </Typography>
        </Stack>
        <Typography
          variant="caption"
          sx={{ fontFamily: MONO, color: "#cecece", lineHeight: 1.8 }}
        >
          {Math.max(0, limits.runs - match.attempts.runs)}/{limits.runs}{" "}
          {demo ? "run previews" : "runs"} ·{" "}
          {Math.max(0, limits.submits - match.attempts.submits)}/
          {limits.submits} {demo ? "submission previews" : "submissions"} left
        </Typography>
      </Stack>
      {error && (
        <Alert
          severity="error"
          action={
            onRetry ? (
              <Button
                variant="text"
                size="small"
                disabled={busy}
                onClick={onRetry}
              >
                {retryKind ? "Retry request" : "Retry connection"}
              </Button>
            ) : undefined
          }
          sx={{ borderRadius: 0, py: 0.25, flexShrink: 0 }}
        >
          {error}
        </Alert>
      )}
      {match.result && (
        <Stack
          direction="row"
          sx={{
            px: narrow ? 1.75 : 3,
            py: 1,
            bgcolor: "#191919",
            borderBottom: 1,
            borderColor: "divider",
            flexShrink: 0,
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1.5,
          }}
        >
          <Typography variant="body2">
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
          </Typography>
          <Button
            variant="outlined"
            size="small"
            onClick={() => setResultDismissed(false)}
          >
            View result
          </Button>
        </Stack>
      )}
      {narrow && (
        <Tabs
          value={tab}
          onChange={(_, value: "problem" | "code") => setTab(value)}
          variant="fullWidth"
          selectionFollowsFocus
          aria-label="Match workspace"
          sx={{
            minHeight: 44,
            bgcolor: "#151515",
            borderBottom: 1,
            borderColor: "divider",
            flexShrink: 0,
          }}
        >
          <Tab
            value="problem"
            id="problem-tab"
            aria-controls="problem-panel"
            label="Problem"
            sx={{ minHeight: 44 }}
          />
          <Tab
            value="code"
            id="code-tab"
            aria-controls="code-panel"
            label="Code"
            sx={{ minHeight: 44 }}
          />
        </Tabs>
      )}
      <Box
        ref={splitRef}
        sx={{
          display: narrow ? "block" : "grid",
          gridTemplateColumns: `minmax(0, ${ratio}%) 9px minmax(0, 1fr)`,
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          bgcolor: "#0a0a0a",
        }}
      >
        <Paper
          component="section"
          square
          id="problem-panel"
          role={narrow ? "tabpanel" : undefined}
          aria-labelledby={narrow ? "problem-tab" : undefined}
          aria-label="Problem statement"
          sx={{
            display: !narrow || tab === "problem" ? "flex" : "none",
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
            height: "100%",
            bgcolor: "#0a0a0a",
          }}
        >
          <PanelHeading>
            <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
              <Code2 size={15} />
              <Typography variant="body2">Problem</Typography>
            </Stack>
            {!compact && (
              <Typography variant="overline" sx={{ fontSize: 11 }}>
                FUNCTION / SOLVE
              </Typography>
            )}
          </PanelHeading>
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: "auto",
              overscrollBehavior: "contain",
              px: narrow ? 2.5 : 3.5,
              pt: 3.5,
              pb: 4.75,
            }}
          >
            <Stack
              direction="row"
              sx={{ mb: 2, alignItems: "center", gap: 1.25 }}
            >
              <Chip
                size="small"
                variant="outlined"
                label={ARENAS[problem.arena].name}
                sx={{ fontSize: 12, borderColor: "#626262", borderRadius: 1 }}
              />
              <Typography variant="caption" color="text.secondary">
                {problem.topic}
              </Typography>
            </Stack>
            <Typography
              variant="h1"
              sx={{ fontSize: 28, letterSpacing: "-.035em", mb: 2.5 }}
            >
              {problem.title}
            </Typography>
            {problem.description
              .split("\n")
              .filter(Boolean)
              .map((p, i) => (
                <Typography
                  key={i}
                  sx={{
                    color: "#c9c9c9",
                    fontSize: 16,
                    lineHeight: 1.85,
                    mb: 2,
                  }}
                >
                  {p}
                </Typography>
              ))}
            <Stack
              direction="row"
              sx={{
                borderLeft: "2px solid #686868",
                bgcolor: "#181818",
                px: 1.75,
                py: 1.5,
                my: 3,
                alignItems: "center",
                gap: 1.25,
              }}
            >
              <Code2 size={16} />
              <Typography
                component="code"
                sx={{
                  fontFamily: MONO,
                  fontSize: 14,
                  lineHeight: 1.7,
                  overflowWrap: "anywhere",
                  minWidth: 0,
                }}
              >
                solve({problem.parameters.map((p) => p.name).join(", ")})
              </Typography>
            </Stack>
            {problem.examples.map((example, i) => (
              <Box key={i} sx={{ my: 3 }}>
                <Typography variant="subtitle2" component="h3" sx={{ mb: 1.5 }}>
                  Example {i + 1}
                </Typography>
                <Paper
                  variant="outlined"
                  sx={{
                    bgcolor: "#151515",
                    borderRadius: 1,
                    px: 1.75,
                    py: 1.5,
                  }}
                >
                  <Typography
                    component="p"
                    sx={{
                      fontFamily: MONO,
                      fontSize: 12,
                      lineHeight: 1.9,
                      overflowWrap: "anywhere",
                      color: "#d5d5d5",
                    }}
                  >
                    <Box
                      component="span"
                      sx={{
                        display: "inline-block",
                        minWidth: 59,
                        mr: 1,
                        color: "text.secondary",
                      }}
                    >
                      Input
                    </Box>
                    {problem.parameters
                      .map(
                        (p, j) =>
                          p.name + " = " + JSON.stringify(example.args[j]),
                      )
                      .join(", ")}
                  </Typography>
                  <Typography
                    component="p"
                    sx={{
                      fontFamily: MONO,
                      fontSize: 12,
                      lineHeight: 1.9,
                      overflowWrap: "anywhere",
                      color: "#d5d5d5",
                    }}
                  >
                    <Box
                      component="span"
                      sx={{
                        display: "inline-block",
                        minWidth: 59,
                        mr: 1,
                        color: "text.secondary",
                      }}
                    >
                      Output
                    </Box>
                    {JSON.stringify(example.expected)}
                  </Typography>
                </Paper>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 1.25 }}
                >
                  {example.explanation}
                </Typography>
              </Box>
            ))}
            <Typography
              variant="subtitle2"
              component="h3"
              sx={{ mt: 3, mb: 1.5 }}
            >
              Constraints
            </Typography>
            <Box
              component="ul"
              sx={{ pl: 2.25, m: 0, color: "text.secondary" }}
            >
              {problem.constraints.map((c) => (
                <Box component="li" key={c}>
                  <Typography
                    component="code"
                    sx={{
                      fontFamily: MONO,
                      fontSize: 14,
                      lineHeight: 2.1,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {c}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        </Paper>
        <Box
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
          sx={{
            display: narrow ? "none" : "flex",
            alignItems: "center",
            justifyContent: "center",
            borderLeft: 1,
            borderRight: 1,
            borderColor: "divider",
            bgcolor: "#141414",
            color: "#949494",
            cursor: "col-resize",
            touchAction: "none",
            "&:hover, &:focus-visible": {
              bgcolor: "#373737",
              color: "#e0e0e0",
            },
          }}
        >
          <GripVertical size={14} />
        </Box>
        <Paper
          component="section"
          square
          id="code-panel"
          role={narrow ? "tabpanel" : undefined}
          aria-labelledby={narrow ? "code-tab" : undefined}
          aria-label="Code editor"
          sx={{
            display: !narrow || tab === "code" ? "flex" : "none",
            flexDirection: "column",
            minWidth: 0,
            minHeight: 0,
            height: "100%",
            overflow: "hidden",
          }}
        >
          <Stack
            direction="row"
            sx={{
              px: 1.5,
              py: 1,
              minHeight: 51,
              borderBottom: 1,
              borderColor: "divider",
              bgcolor: "#171717",
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 1,
            }}
          >
            {!compact && (
              <Typography variant="overline" sx={{ mr: "auto", fontSize: 11 }}>
                {demo ? "ILLUSTRATIVE ONLY" : "SAMPLE / HIDDEN TESTS"}
              </Typography>
            )}
            <Button
              variant="outlined"
              size="small"
              startIcon={<Play size={14} />}
              disabled={
                !active ||
                busy ||
                pending ||
                !!retryKind ||
                match.attempts.runs >= limits.runs
              }
              onClick={() => onAttempt("run", language, source)}
              sx={{
                fontSize: narrow ? 12 : 14,
                minHeight: 35,
                whiteSpace: "nowrap",
              }}
            >
              {demo ? "Preview run" : "Run"}
            </Button>
            <Button
              variant="contained"
              size="small"
              startIcon={
                busy ? (
                  <CircularProgress size={15} color="inherit" />
                ) : (
                  <ArrowRight size={15} />
                )
              }
              disabled={
                !active ||
                busy ||
                pending ||
                !!retryKind ||
                match.attempts.submits >= limits.submits
              }
              onClick={() => onAttempt("submit", language, source)}
              sx={{
                fontSize: narrow ? 12 : 14,
                minHeight: 35,
                whiteSpace: "nowrap",
              }}
            >
              {demo ? "Preview submission" : "Submit"}
            </Button>
          </Stack>
          <PanelHeading>
            <Stack
              direction="row"
              sx={{ minWidth: 0, alignItems: "center", gap: 1 }}
            >
              <Code2 size={16} />
              <NativeSelect
                value={language}
                inputProps={{ "aria-label": "Programming language" }}
                onChange={(e) => setLang(e.target.value as Language)}
                sx={{ maxWidth: 150, fontSize: 14 }}
              >
                {Object.entries(LANGUAGES).map(([id, l]) => (
                  <option value={id} key={id}>
                    {l.name}
                  </option>
                ))}
              </NativeSelect>
            </Stack>
            <Stack direction="row" sx={{ alignItems: "center", gap: 1.5 }}>
              {!compact && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                >
                  <Check size={12} />
                  {saved
                    ? demo
                      ? "Session draft"
                      : "Saved locally"
                    : "Draft not saved"}
                </Typography>
              )}
              {compact && !saved && (
                <Typography variant="caption" color="warning.main">
                  Draft not saved
                </Typography>
              )}
              <IconButton
                size="small"
                disabled={!!match.result}
                title="Reset starter code"
                aria-label="Reset starter code"
                onClick={() => setResetOpen(true)}
              >
                <RotateCcw size={15} />
              </IconButton>
            </Stack>
          </PanelHeading>
          <Box
            sx={{
              flex: 1,
              minHeight: narrow ? 90 : 120,
              position: "relative",
              bgcolor: "#101010",
            }}
          >
            <Suspense fallback={<EditorLoading />}>
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
                      focusBorder: "#bdbdbd",
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
                loading={<EditorLoading />}
              />
            </Suspense>
          </Box>
          <Box
            sx={{
              height: narrow ? 104 : 144,
              minHeight: 60,
              flexShrink: 0,
              borderTop: 1,
              borderColor: "divider",
              display: "flex",
              flexDirection: "column",
              bgcolor: "#0c0c0c",
            }}
          >
            <Stack
              direction="row"
              sx={{
                px: 2,
                py: 1,
                borderBottom: 1,
                borderColor: "divider",
                flexShrink: 0,
                justifyContent: "space-between",
                gap: 1.5,
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {demo ? "Example verdicts" : "Test results"}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {latest
                  ? latest.kind === "run"
                    ? "Samples"
                    : "Submission"
                  : `${problem.examples.length} sample case${problem.examples.length === 1 ? "" : "s"}`}
              </Typography>
            </Stack>
            <Box
              aria-live="polite"
              sx={{ overflow: "auto", px: 2, py: 1.5, minHeight: 0 }}
            >
              {latest ? (
                <>
                  <Stack
                    direction="row"
                    sx={{
                      color:
                        latest.verdict === "accepted"
                          ? "success.main"
                          : [
                                "judge_error",
                                "compile_error",
                                "runtime_error",
                              ].includes(latest.verdict)
                            ? "error.main"
                            : "warning.main",
                      mb: 0.5,
                      alignItems: "center",
                      gap: 1,
                    }}
                  >
                    {latest.verdict === "pending" ? (
                      <CircularProgress size={15} color="inherit" />
                    ) : latest.verdict === "accepted" ? (
                      <CheckCircle2 size={15} />
                    ) : (
                      <AlertCircle size={15} />
                    )}
                    <Typography
                      variant="body2"
                      component="strong"
                      sx={{ textTransform: "capitalize", fontWeight: 600 }}
                    >
                      {demo ? "Illustrative · " : ""}
                      {latest.verdict.replaceAll("_", " ")}
                    </Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {latest.message}
                  </Typography>
                  {latest.kind === "run" && latest.sampleResults && (
                    <Box sx={{ mt: 1 }}>
                      {latest.sampleResults.map((r, i) => (
                        <Accordion
                          key={i}
                          disableGutters
                          square
                          elevation={0}
                          sx={{
                            bgcolor: "#1c1c1c",
                            border: "1px solid #3e3e3e",
                            borderRadius: 1,
                            mt: 1,
                            "&::before": { display: "none" },
                          }}
                        >
                          <AccordionSummary
                            expandIcon={<ChevronDown size={14} />}
                            sx={{
                              minHeight: 30,
                              px: 1,
                              "& .MuiAccordionSummary-content": { my: 0.75 },
                            }}
                          >
                            <Typography variant="caption">
                              Case {i + 1} · {r.passed ? "passed" : "failed"}
                            </Typography>
                          </AccordionSummary>
                          <AccordionDetails sx={{ px: 1, py: 1 }}>
                            <Typography
                              variant="caption"
                              component="strong"
                              sx={{ fontWeight: 600 }}
                            >
                              Expected
                            </Typography>
                            <Typography
                              component="pre"
                              sx={{
                                fontFamily: MONO,
                                whiteSpace: "pre-wrap",
                                overflowWrap: "anywhere",
                                maxHeight: 120,
                                overflow: "auto",
                                my: 0.75,
                                fontSize: 12,
                              }}
                            >
                              <Box component="code">
                                {sampleValue(r.expected)}
                              </Box>
                            </Typography>
                            <Typography
                              variant="caption"
                              component="strong"
                              sx={{ fontWeight: 600 }}
                            >
                              Actual
                            </Typography>
                            <Typography
                              component="pre"
                              sx={{
                                fontFamily: MONO,
                                whiteSpace: "pre-wrap",
                                overflowWrap: "anywhere",
                                maxHeight: 120,
                                overflow: "auto",
                                my: 0.75,
                                fontSize: 12,
                              }}
                            >
                              <Box component="code">
                                {sampleValue(r.actual)}
                              </Box>
                            </Typography>
                          </AccordionDetails>
                        </Accordion>
                      ))}
                    </Box>
                  )}
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {demo
                    ? "Preview run shows the supplied example outputs. Your code is not executed."
                    : "Run the samples to check your code. Submit to judge every hidden test."}
                </Typography>
              )}
            </Box>
          </Box>
        </Paper>
      </Box>
      {demoControls && (
        <Stack
          direction="row"
          sx={{
            px: narrow ? 1.75 : 3,
            py: 1.25,
            borderTop: 1,
            borderColor: "divider",
            bgcolor: "#151515",
            flexShrink: 0,
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
          }}
        >
          <Stack
            direction="row"
            sx={{
              flexWrap: "wrap",
              minWidth: 0,
              flex: narrow ? 1 : undefined,
              alignItems: "center",
              gap: 1,
            }}
          >
            {!compact && (
              <Typography variant="overline" sx={{ fontSize: 11 }}>
                DEMO CONTROLS
              </Typography>
            )}
            <NativeSelect
              value={demoControls.scenario}
              inputProps={{ "aria-label": "Example result scenario" }}
              disabled={busy || !!match.result}
              onChange={(e) =>
                demoControls.onScenario(e.target.value as DemoScenario)
              }
              sx={{ fontSize: 12, maxWidth: narrow ? 140 : 180 }}
            >
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant="outlined"
              size="small"
              disabled={busy || !!match.result}
              onClick={demoControls.onShow}
              sx={{ fontSize: 12 }}
            >
              Show example result
            </Button>
          </Stack>
          <Button
            variant="text"
            size="small"
            startIcon={<RotateCcw size={14} />}
            onClick={demoControls.onRestart}
            sx={{ fontSize: 12 }}
          >
            Restart demo
          </Button>
        </Stack>
      )}
      {resigning && (
        <Modal
          title={demo ? "Resign demo" : "Resign match"}
          onClose={() => {
            if (!resignBusy) setResigning(false);
          }}
        >
          <Typography variant="h2" sx={{ fontSize: 26, mb: 1.5 }}>
            {demo ? "Preview a resignation?" : "Resign this match?"}
          </Typography>
          <Typography color="text.secondary">
            {demo
              ? "This displays an illustrative loss. Your real rating is unchanged."
              : "Resigning counts as a loss and changes this arena’s rating."}
          </Typography>
          {resignError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {resignError}
            </Alert>
          )}
          <Stack
            direction="row"
            sx={{ mt: 3, justifyContent: "flex-end", gap: 1.5 }}
          >
            <Button
              variant="outlined"
              disabled={resignBusy}
              onClick={() => setResigning(false)}
            >
              Keep playing
            </Button>
            <Button
              variant="contained"
              color="error"
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
            </Button>
          </Stack>
        </Modal>
      )}
      {resetOpen && (
        <Modal title="Reset starter" onClose={() => setResetOpen(false)}>
          <Typography variant="h2" sx={{ fontSize: 26, mb: 1.5 }}>
            Reset this draft?
          </Typography>
          <Typography color="text.secondary">
            Your {LANGUAGES[language].name} code will be replaced by the starter
            function.
          </Typography>
          <Stack
            direction="row"
            sx={{ mt: 3, justifyContent: "flex-end", gap: 1.5 }}
          >
            <Button variant="outlined" onClick={() => setResetOpen(false)}>
              Keep code
            </Button>
            <Button
              variant="contained"
              onClick={() => {
                update(problem.starter[language]);
                setResetOpen(false);
              }}
            >
              Reset code
            </Button>
          </Stack>
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
    </Box>
  );
}
function PanelHeading({ children }: { children: ReactNode }) {
  return (
    <Stack
      direction="row"
      sx={{
        minHeight: 48,
        px: 2,
        py: 1,
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: "#111111",
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1.25,
      }}
    >
      {children}
    </Stack>
  );
}
function EditorLoading() {
  return (
    <Stack
      direction="row"
      sx={{
        height: "100%",
        color: "text.secondary",
        alignItems: "center",
        justifyContent: "center",
        gap: 1.25,
      }}
    >
      <CircularProgress size={18} color="inherit" />
      <Typography variant="body2">Opening editor…</Typography>
    </Stack>
  );
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
    <Box component="section">
      <Typography variant="overline" sx={{ fontSize: 11 }}>
        {demo
          ? "ILLUSTRATIVE / NO RATINGS SAVED"
          : result.settled
            ? "MATCH SETTLED"
            : "SAVING RESULT"}
      </Typography>
      <Typography variant="h2" sx={{ fontSize: { xs: 32, sm: 40 }, my: 1.75 }}>
        {isVoid
          ? "Match voided."
          : draw
            ? "A draw."
            : won
              ? "You win."
              : "Opponent wins."}
      </Typography>
      <Typography color="text.secondary">
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
      </Typography>
      {/* Retained as a browser test hook; all presentation is provided by MUI. */}
      <Stack
        className="result-score"
        direction="row"
        sx={{
          my: 3,
          py: 2.5,
          borderTop: 1,
          borderBottom: 1,
          borderColor: "divider",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
        }}
      >
        <Box>
          <Typography
            component="div"
            sx={{
              fontFamily: MONO,
              fontSize: { xs: 38, sm: 48 },
              lineHeight: 1.2,
              color:
                delta > 0
                  ? "success.main"
                  : delta < 0
                    ? "error.main"
                    : "text.primary",
            }}
          >
            {delta > 0 ? "+" : ""}
            {delta}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            component="span"
            sx={{ display: "block", mt: 1 }}
          >
            {demo ? "Illustrative Elo change" : "Elo change"}
          </Typography>
        </Box>
        <Box sx={{ textAlign: "right" }}>
          <Typography sx={{ fontFamily: MONO, fontSize: { xs: 15, sm: 18 } }}>
            {before.toLocaleString()} → {(before + delta).toLocaleString()}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            component="span"
            sx={{ display: "block", mt: 1 }}
          >
            {ARENAS[match.arena].name} ·{" "}
            {match.mode === "bot" ? "Bot" : "Human"} rating
            {demo ? " example" : ""}
          </Typography>
        </Box>
      </Stack>
      <Box sx={{ my: 2.5 }}>
        <Typography variant="overline" sx={{ fontSize: 11 }}>
          {demo ? "EXAMPLE VERDICTS" : "YOUR SUBMISSIONS"}
        </Typography>
        {match.submissions.length ? (
          <Stack divider={<Divider />} sx={{ mt: 1 }}>
            {match.submissions.map((s, i) => (
              <Stack
                key={s.id}
                direction="row"
                sx={{ py: 1.25, justifyContent: "space-between", gap: 1.5 }}
              >
                <Typography variant="body2" color="text.secondary">
                  {s.kind === "run" ? "Run" : "Submission"} {i + 1} ·{" "}
                  {LANGUAGES[s.language].name}
                </Typography>
                <Typography
                  variant="body2"
                  component="strong"
                  sx={{
                    textTransform: "capitalize",
                    textAlign: "right",
                    fontWeight: 500,
                  }}
                >
                  {s.verdict.replaceAll("_", " ")}
                </Typography>
              </Stack>
            ))}
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {demo
              ? "This outcome was opened with the demo controls. No code was judged."
              : "No submissions were received."}
          </Typography>
        )}
      </Box>
      {!result.settled && (
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          sx={{ mt: 1.5 }}
        >
          Your result is being saved. A new ranked match will become available
          when settlement completes.
        </Typography>
      )}
      {demo && (
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          sx={{ mt: 1.5 }}
        >
          Demo results never appear in your history or the leaderboard.
        </Typography>
      )}
      <Stack
        direction="row"
        sx={{ mt: 3, justifyContent: "space-between", gap: 1.5 }}
      >
        <Button variant="outlined" onClick={onReview}>
          Review workspace
        </Button>
        {demo ? (
          <Button
            variant="contained"
            endIcon={<ArrowRight size={16} />}
            onClick={() => {
              onReview();
              onRestart?.();
            }}
          >
            New demo
          </Button>
        ) : (
          <Button
            component={Link}
            to="/"
            variant="contained"
            endIcon={<ArrowRight size={16} />}
          >
            Back to lobby
          </Button>
        )}
      </Stack>
    </Box>
  );
}
