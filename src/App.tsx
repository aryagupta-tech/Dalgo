import {
  useEffect,
  useRef,
  useState,
  lazy,
  Suspense,
  type ReactNode,
} from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  Command,
  Flag,
  Github,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Play,
  Radio,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  Trophy,
  UserRound,
  Users,
  X,
  Zap,
  WifiOff,
  LogOut,
  PanelLeft,
  GripVertical,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useAuth } from "./auth";
import { useDalgoTools } from "./webmcp";
import { api, connectEvents } from "./api";
import {
  ARENAS,
  LANGUAGES,
  type Arena,
  type Mode,
  type Language,
  type PublicProblem,
  type MatchView,
  type Rating,
  type QueueView,
  type HistoryRow,
  type LeaderRow,
} from "../shared/types";
const Editor = lazy(() => import("./components/CodeEditor"));
const arenaKeys = Object.keys(ARENAS) as Arena[];
const icons = { easy: Zap, medium: Layers3, hard: Command };
function Logo() {
  return (
    <Link to="/" className="brand" aria-label="Dalgo home">
      <span className="brand-mark">
        <svg viewBox="0 0 28 28" aria-hidden="true">
          <path d="M5 4h10l9 10-9 10H5l9-10z" fill="currentColor" />
        </svg>
      </span>
      dalgo<span className="brand-period">.</span>
    </Link>
  );
}
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    ref.current?.addEventListener("cancel", onCancel);
    return () => ref.current?.removeEventListener("cancel", onCancel);
  }, [onClose]);
  return (
    <dialog
      ref={ref}
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-label={title}
    >
      <button
        className="icon-button modal-close"
        aria-label="Close"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      {children}
    </dialog>
  );
}
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.39a4.61 4.61 0 0 1-2 3.03v2.52h3.23c1.89-1.74 2.98-4.3 2.98-7.38ZM12 22c2.7 0 4.96-.9 6.62-2.39l-3.23-2.52c-.9.6-2.04.96-3.39.96-2.6 0-4.8-1.75-5.59-4.1H3.08v2.6A10 10 0 0 0 12 22ZM6.41 13.95a6 6 0 0 1 0-3.9v-2.6H3.08a10 10 0 0 0 0 9.1l3.33-2.6ZM12 5.95c1.47 0 2.79.51 3.82 1.51l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.92 5.45l3.33 2.6C7.2 7.7 9.4 5.95 12 5.95Z"
      />
    </svg>
  );
}
function SignIn({ onClose }: { onClose: () => void }) {
  const { client } = useAuth();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function login(provider: "google" | "github") {
    if (!client) return;
    setBusy(true);
    const { error } = await client.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin + "/" },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }
  return (
    <Dialog title="Sign in to Dalgo" onClose={onClose}>
      <div className="dialog-symbol">
        <Swords size={27} />
      </div>
      <p className="eyebrow">YOUR NEXT CHALLENGE</p>
      <h2>Make your move.</h2>
      <p className="muted">
        Sign in to compete, build your rating, and make every problem count.
      </p>
      {client ? (
        <div className="auth-buttons">
          <button
            className="button auth-button"
            disabled={busy}
            onClick={() => login("google")}
          >
            <GoogleIcon />
            Continue with Google
          </button>
          <button
            className="button auth-button"
            disabled={busy}
            onClick={() => login("github")}
          >
            <Github size={19} />
            Continue with GitHub
          </button>
        </div>
      ) : (
        <div className="notice">
          <LockKeyhole size={18} />
          <span>
            Sign-in opens when the beta is connected. You can explore all three
            arenas now.
          </span>
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p className="tiny muted">
        A fresh start at 1,200. Your progress is yours.
      </p>
    </Dialog>
  );
}
function useRatings() {
  const { user } = useAuth();
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [ratingsError, setRatingsError] = useState("");
  useEffect(() => {
    let stopped = false;
    setRatings([]);
    setRatingsError("");
    if (!user) return;
    api<Rating[]>("/ratings")
      .then((value) => {
        if (!stopped) setRatings(value);
      })
      .catch((error) => {
        if (!stopped) setRatingsError(error.message);
      });
    return () => {
      stopped = true;
    };
  }, [user?.id]);
  return { ratings, ratingsError };
}
function Shell() {
  useDalgoTools();
  const { user, client } = useAuth();
  const [signIn, setSignIn] = useState(false);
  return (
    <>
      <div className="site-glow" />
      <header className="topbar">
        <div className="topbar-inner">
          <Logo />
          <nav className="main-nav" aria-label="Main navigation">
            <NavLink to="/" end>
              <Swords size={17} />
              Play
            </NavLink>
            <NavLink to="/leaderboard">
              <Trophy size={17} />
              Leaderboard
            </NavLink>
            <NavLink to="/history">
              <Clock3 size={17} />
              History
            </NavLink>
          </nav>
          <div className="topbar-right">
            <span className="beta-tag">BETA</span>
            {user ? (
              <>
                <Link
                  className="avatar"
                  to="/profile"
                  aria-label="Your profile"
                >
                  {(user.user_metadata?.full_name ?? user.email ?? "D")
                    .slice(0, 1)
                    .toUpperCase()}
                </Link>
                <button
                  className="icon-button sign-out"
                  title="Sign out"
                  aria-label="Sign out"
                  onClick={() => client?.auth.signOut()}
                >
                  <LogOut size={17} />
                </button>
              </>
            ) : (
              <button
                className="button button-small sign-in"
                onClick={() => setSignIn(true)}
              >
                Sign in
                <ArrowUpRight size={16} />
              </button>
            )}
          </div>
        </div>
      </header>
      <Routes>
        <Route path="/" element={<Home onSignIn={() => setSignIn(true)} />} />
        <Route
          path="/preview/:arena"
          element={<MatchPage preview onSignIn={() => setSignIn(true)} />}
        />
        <Route
          path="/match/:id"
          element={<MatchPage onSignIn={() => setSignIn(true)} />}
        />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route
          path="/history"
          element={<History onSignIn={() => setSignIn(true)} />}
        />
        <Route
          path="/profile"
          element={<Profile onSignIn={() => setSignIn(true)} />}
        />
        <Route
          path="*"
          element={
            <main className="page empty-page">
              <Code2 />
              <h1>That page took a wrong turn.</h1>
              <Link className="button" to="/">
                Back to the arena
              </Link>
            </main>
          }
        />
      </Routes>
      {signIn && <SignIn onClose={() => setSignIn(false)} />}
    </>
  );
}
function ModeSwitch({
  value,
  onChange,
}: {
  value: Mode;
  onChange: (v: Mode) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label="Rating type">
      <button
        aria-pressed={value === "human"}
        className={value === "human" ? "active" : ""}
        onClick={() => onChange("human")}
      >
        <Users size={15} />
        Human
      </button>
      <button
        aria-pressed={value === "bot"}
        className={value === "bot" ? "active" : ""}
        onClick={() => onChange("bot")}
      >
        <Code2 size={15} />
        Bot
      </button>
    </div>
  );
}
function Home({ onSignIn }: { onSignIn: () => void }) {
  const { user, config } = useAuth();
  const { ratings, ratingsError } = useRatings();
  const [mode, setMode] = useState<Mode>("human");
  const [queue, setQueue] = useState<Arena | null>(null);
  const nav = useNavigate();
  const name = user?.user_metadata?.full_name?.split(" ")[0];
  return (
    <main className="page home">
      <section className="intro">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-dash" />
            THE DSA DUEL ARENA
          </p>
          <h1>
            {name ? (
              <>
                Your move, <span>{name}.</span>
              </>
            ) : (
              <>
                Great minds.
                <br className="mobile-break" /> <span>Better rivals.</span>
              </>
            )}
          </h1>
          <p className="intro-copy">
            Same problem. Same clock. First correct solution wins.
          </p>
        </div>
        <div className="intro-aside">
          <div className="overlap-icons">
            <span>
              <Code2 size={20} />
            </span>
            <span>
              <Swords size={20} />
            </span>
          </div>
          <p>
            A little competition.
            <br />
            <strong>A lot of progress.</strong>
          </p>
        </div>
      </section>
      <div className="arena-section-title">
        <div>
          <h2>
            Choose your arena <span className="count-label">03</span>
          </h2>
          <p>Find your pace. Take on the challenge.</p>
        </div>
        <ModeSwitch value={mode} onChange={setMode} />
      </div>
      {ratingsError && (
        <p className="error" role="alert">
          {ratingsError}
        </p>
      )}
      <section className="arena-grid" aria-label="Arenas">
        {arenaKeys.map((key, i) => {
          const a = ARENAS[key],
            Icon = icons[key],
            rating = ratings.find((r) => r.arena === key && r.mode === mode);
          return (
            <article
              key={key}
              className={"arena-card arena-" + key}
              style={{ "--arena-color": a.color } as React.CSSProperties}
            >
              <div className="arena-top">
                <span className="arena-emblem">
                  <Icon size={29} strokeWidth={1.65} />
                </span>
                <span className="arena-time">
                  <Clock3 size={14} />
                  {a.duration / 60} min
                </span>
              </div>
              <div className="arena-art" aria-hidden="true">
                <span className="art-grid" />
                <span className="arena-number">0{i + 1}</span>
                <Icon className="arena-art-icon" size={88} strokeWidth={0.75} />
                <span className="art-orbit" />
              </div>
              <div className="arena-copy">
                <p className="eyebrow">{a.label}</p>
                <h3>
                  {a.name}
                  <span className="difficulty-marks">
                    {Array.from({ length: 3 }, (_, j) => (
                      <i key={j} className={j <= i ? "filled" : ""} />
                    ))}
                  </span>
                </h3>
                <p>{a.description}</p>
                <div className="topic-line">{a.topics}</div>
              </div>
              <div className="card-rating">
                <span>
                  {user
                    ? "Your " + mode + " rating"
                    : "Starting " + mode + " rating"}
                </span>
                <strong>
                  {(rating?.rating ?? (user ? "—" : 1200)).toLocaleString()}
                  <span>
                    {rating?.matches ? `${rating.matches} played` : "Unranked"}
                  </span>
                </strong>
              </div>
              <button
                className={
                  "button arena-cta " + (key === "medium" ? "primary" : "")
                }
                onClick={() =>
                  config.playEnabled
                    ? user
                      ? setQueue(key)
                      : onSignIn()
                    : nav("/preview/" + key)
                }
              >
                {config.playEnabled ? "Enter arena" : "Explore arena"}
                <ArrowUpRight size={18} />
              </button>
            </article>
          );
        })}
      </section>
      <div className="below-arena">
        <div className="match-info">
          <span className="soft-icon">
            <Users size={20} />
          </span>
          <div>
            <strong>A worthy opponent. Every time.</strong>
            <p>
              We look for a player near your rating for 15 seconds, then pair
              you with a clearly marked bot.
            </p>
          </div>
          <span className="info-pill">Human first</span>
        </div>
        <div className="fairplay-info">
          <ShieldCheck size={20} />
          <div>
            <strong>Built for a fair fight</strong>
            <p>Shared clock. Hidden tests. Separate bot ratings.</p>
          </div>
        </div>
      </div>
      {!config.playEnabled && (
        <div className="beta-notice">
          <span className="beta-small">EARLY ACCESS</span>
          <p>{config.reason}</p>
          <ArrowRight size={17} />
        </div>
      )}
      <section className="bottom-grid">
        <div className="recent-panel">
          <div className="section-row">
            <h2>Your last moves</h2>
            <Link to="/history">
              Match history
              <ArrowUpRight size={15} />
            </Link>
          </div>
          <div className="empty-inline">
            <span className="empty-icon">
              <Swords size={21} />
            </span>
            <div>
              <strong>
                {user
                  ? "Every match starts a story."
                  : "Your first rivalry is waiting."}
              </strong>
              <p>
                {user
                  ? "Completed matches and rating changes will appear in your history."
                  : "Sign in when the beta opens to keep track of your matches."}
              </p>
            </div>
          </div>
        </div>
        <div className="how-panel">
          <p className="eyebrow">THE WINNING MOVE</p>
          <div className="how-steps">
            <span>
              <i>1</i>Choose
            </span>
            <ChevronRight size={14} />
            <span>
              <i>2</i>Solve
            </span>
            <ChevronRight size={14} />
            <span>
              <i>3</i>Climb
            </span>
          </div>
          <p>Fully correct wins. If neither solves, it’s a draw.</p>
        </div>
      </section>
      <Footer />
      {queue && <QueueDialog arena={queue} onClose={() => setQueue(null)} />}
    </main>
  );
}
function Footer() {
  return (
    <footer>
      <span>Built for the love of problem solving.</span>
      <span>
        <span className="footer-mark">◈</span> One challenge at a time.
      </span>
    </footer>
  );
}
function QueueDialog({
  arena,
  onClose,
}: {
  arena: Arena;
  onClose: () => void;
}) {
  const [state, setState] = useState<QueueView | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const navigate = useNavigate();
  const requestId = useRef<string>(crypto.randomUUID());
  const navigating = useRef(false);
  useEffect(() => {
    let closed = false;
    let socket: WebSocket | undefined;
    const update = (q: QueueView) => {
      if (closed) return;
      if (q.requestId) requestId.current = q.requestId;
      setState((previous) =>
        previous?.status === "capacity" && q.status === "idle" ? previous : q,
      );
      if (q.matchId) {
        navigating.current = true;
        navigate("/match/" + q.matchId);
        onClose();
      }
    };
    api<QueueView>("/queue", {
      method: "POST",
      body: JSON.stringify({ arena, requestId: requestId.current }),
    })
      .then(async (q) => {
        update(q);
        if (!q.matchId) {
          try {
            socket = await connectEvents("/queue/events", (v) => {
              if (v.type === "queue") update(v.data);
            });
            if (closed) socket.close();
          } catch {}
        }
      })
      .catch((e) => setError(e.message));
    const timer = setInterval(() => setNow(Date.now()), 250);
    const poll = setInterval(
      () =>
        api<QueueView>("/queue")
          .then(update)
          .catch((e) => setError(e.message)),
      2500,
    );
    return () => {
      closed = true;
      socket?.close();
      clearInterval(timer);
      clearInterval(poll);
    };
  }, [arena]);
  const elapsed = Math.max(
    0,
    Math.floor((now - (state?.joinedAt ?? now)) / 1000),
  );
  async function cancel() {
    try {
      if (!navigating.current) {
        const q = await api<QueueView>("/queue", {
          method: "DELETE",
          body: JSON.stringify({ requestId: requestId.current }),
        });
        if (q.matchId) {
          navigate("/match/" + q.matchId);
        } else if (q.status !== "idle") {
          setError("Your search is still active. Please cancel again.");
          return;
        }
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog title="Finding an opponent" onClose={cancel}>
      <div className="match-orb">
        <Swords size={42} />
        <span />
      </div>
      <p className="eyebrow">
        {ARENAS[arena].name.toUpperCase()} ARENA · {ARENAS[arena].duration / 60}{" "}
        MIN
      </p>
      <h2>
        {state?.status === "capacity"
          ? "A short breather."
          : "Finding your rival."}
      </h2>
      <p className="muted">
        {state?.message || "Looking for someone near your skill level."}
      </p>
      <div className="queue-counter">00:{String(elapsed).padStart(2, "0")}</div>
      <div className="queue-progress">
        <span style={{ width: Math.min((elapsed / 15) * 100, 100) + "%" }} />
      </div>
      <p className="tiny muted">
        A simulated bot joins after 15 seconds if no suitable player is
        available.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="button full" onClick={cancel}>
        Cancel search
      </button>
    </Dialog>
  );
}
function usePublicProblem(arena: Arena) {
  const [problem, setProblem] = useState<PublicProblem | null>(null);
  useEffect(() => {
    fetch("/problems.json")
      .then((r) => r.json() as Promise<PublicProblem[]>)
      .then((p: PublicProblem[]) =>
        setProblem(p.find((p) => p.arena === arena) ?? null),
      )
      .catch(() => {});
  }, [arena]);
  return problem;
}
function MatchPage({
  preview = false,
  onSignIn,
}: {
  preview?: boolean;
  onSignIn: () => void;
}) {
  const params = useParams();
  const arena: Arena = arenaKeys.includes(params.arena as Arena)
    ? (params.arena as Arena)
    : "easy";
  const publicProblem = usePublicProblem(arena);
  const { user } = useAuth();
  const [match, setMatch] = useState<MatchView | null>(null);
  const [language, setLanguage] = useState<Language>("python");
  const [source, setSource] = useState("");
  const [tab, setTab] = useState<"problem" | "code">("problem");
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resign, setResign] = useState(false);
  const [connection, setConnection] = useState("");
  const [ratio, setRatio] = useState(43);
  const splitRef = useRef<HTMLDivElement>(null);
  const clockOffset = useRef(0);
  const draftKey = `dalgo-draft:${preview ? "preview-" + arena : params.id}:${language}`;
  const problem = preview ? publicProblem : match?.problem;
  useEffect(() => {
    const tick = setInterval(
      () => setNow(Date.now() + clockOffset.current),
      250,
    );
    return () => clearInterval(tick);
  }, []);
  useEffect(() => {
    if (!problem) return;
    setSource(localStorage.getItem(draftKey) ?? problem.starter[language]);
  }, [problem?.id, language, draftKey]);
  useEffect(() => {
    if (preview || !params.id || !user) return;
    let stopped = false;
    let ws: WebSocket | undefined;
    const refresh = () =>
      api<MatchView>("/matches/" + params.id)
        .then((v) => {
          if (stopped) return;
          clockOffset.current = v.serverNow - Date.now();
          setMatch(v);
          setError("");
        })
        .catch((e) => !stopped && setError(e.message));
    refresh();
    connectEvents("/matches/" + params.id + "/events", (v) => {
      if (v.type === "match") refresh();
    })
      .then((s) => {
        ws = s;
        if (stopped) s.close();
        s.onclose = () => setConnection("Reconnecting — your clock continues.");
        s.onopen = () => setConnection("");
      })
      .catch(() =>
        setConnection(
          "Live updates are reconnecting. Your match is still active.",
        ),
      );
    const poll = setInterval(refresh, 2500);
    return () => {
      stopped = true;
      ws?.close();
      clearInterval(poll);
    };
  }, [params.id, user?.id, preview]);
  async function send(kind: "run" | "submit") {
    if (!match) return;
    setBusy(true);
    setError("");
    try {
      const v = await api<MatchView>("/matches/" + match.id + "/" + kind, {
        method: "POST",
        body: JSON.stringify({
          language,
          source,
          requestId: crypto.randomUUID(),
        }),
      });
      setMatch(v);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function drag(e: React.PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (splitRef.current) {
        const rect = splitRef.current.getBoundingClientRect();
        setRatio(
          Math.max(
            28,
            Math.min(65, ((ev.clientX - rect.left) / rect.width) * 100),
          ),
        );
      }
    };
    const end = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
  }
  const time = preview
    ? ARENAS[arena].duration
    : Math.max(0, Math.ceil(((match?.endsAt ?? now) - now) / 1000));
  const active =
    match?.status === "active" && now >= (match?.startsAt ?? 0) && time > 0;
  const ownPending = match?.submissions.some(
    (s) => s.userId === user?.id && s.verdict === "pending",
  );
  const latest = match?.submissions.filter((s) => s.userId === user?.id).at(-1);
  const opponent = match?.players.find((p) => p.id !== user?.id);
  const yourPlayer = match?.players.find((p) => p.id === user?.id);
  const matchArena = problem?.arena ?? arena;
  return (
    <main className="match-page">
      <div className="match-toolbar">
        <Link to="/" className="back-link">
          <ArrowLeft size={16} />
          Arenas
        </Link>
        <div className="match-arena">
          <span className={"level-dot " + matchArena} />
          {ARENAS[matchArena].name} arena
          <span className="tiny-pill">
            {preview
              ? "PREVIEW"
              : match?.mode === "bot"
                ? "BOT MATCH"
                : "RANKED"}
          </span>
        </div>
        <div className={"match-clock " + (time < 60 ? "urgent" : "")}>
          <Clock3 size={18} />
          {String(Math.floor(time / 60)).padStart(2, "0")}:
          {String(time % 60).padStart(2, "0")}
        </div>
      </div>
      <div className="duel-strip">
        <div className="duelist">
          <span className="player-avatar">
            <UserRound size={21} />
          </span>
          <div>
            <strong>{preview ? "You" : (yourPlayer?.name ?? "You")}</strong>
            <span>{yourPlayer?.rating ?? 1200} rating</span>
          </div>
          <span className="you-tag">YOU</span>
        </div>
        <span className="versus">
          <Swords size={19} />
          VS
        </span>
        <div className="duelist opponent">
          <div>
            <strong>
              {preview ? "Your next rival" : (opponent?.name ?? "Connecting…")}
            </strong>
            <span>
              {preview
                ? "A human or simulated bot"
                : opponent?.isBot
                  ? "Simulated bot · " + opponent.rating
                  : "Rating " +
                    (opponent?.rating ?? 1200) +
                    " · " +
                    (match?.opponentStatus ?? "Solving")}
            </span>
          </div>
          <span className="player-avatar other">
            <Code2 size={21} />
          </span>
        </div>
      </div>
      {preview && (
        <div className="preview-notice">
          <Sparkles size={17} />
          <span>
            Explore the arena. The clock and code execution start when online
            matches open.
          </span>
          <button onClick={onSignIn}>
            Sign in
            <ArrowUpRight size={14} />
          </button>
        </div>
      )}
      {connection && (
        <div className="notice compact">
          <WifiOff size={16} />
          {connection}
        </div>
      )}
      {!preview && !user && (
        <div className="notice">
          Sign in to reconnect to your match.
          <button className="text-button" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      )}
      <div className="mobile-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "problem"}
          onClick={() => setTab("problem")}
        >
          Problem
        </button>
        <button
          role="tab"
          aria-selected={tab === "code"}
          onClick={() => setTab("code")}
        >
          Code
        </button>
      </div>
      <div
        className={"workspace show-" + tab}
        ref={splitRef}
        style={{ "--split": ratio + "%" } as React.CSSProperties}
      >
        <section className="problem-panel">
          <div className="panel-title">
            <span>
              <PanelLeft size={16} />
              Description
            </span>
            <span className="tiny muted">01 problem</span>
          </div>
          {problem ? (
            <div className="problem-body">
              <div className="problem-meta">
                <span className={"difficulty-badge " + matchArena}>
                  {ARENAS[matchArena].name}
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
                <Code2 size={15} />
                <code>
                  solve({problem.parameters.map((p) => p.name).join(", ")})
                </code>
              </div>
              {problem.examples.map((e, i) => (
                <div className="example" key={i}>
                  <h3>Example {i + 1}</h3>
                  <div className="example-code">
                    <p>
                      <span>Input</span>
                      {problem.parameters
                        .map(
                          (p, j) => p.name + " = " + JSON.stringify(e.args[j]),
                        )
                        .join(", ")}
                    </p>
                    <p>
                      <span>Output</span>
                      {JSON.stringify(e.expected)}
                    </p>
                  </div>
                  <p className="example-explanation">{e.explanation}</p>
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
          ) : (
            <div className="panel-loading">
              <LoaderCircle className="spin" />
              Loading the challenge…
            </div>
          )}
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
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              setRatio((x) => Math.max(28, x - 2));
            }
            if (e.key === "ArrowRight") {
              e.preventDefault();
              setRatio((x) => Math.min(65, x + 2));
            }
          }}
        >
          <GripVertical size={16} />
        </div>
        <section className="editor-panel">
          <div className="panel-title editor-heading">
            <label>
              <Code2 size={16} />
              <select
                aria-label="Programming language"
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
              >
                {Object.entries(LANGUAGES).map(([key, l]) => (
                  <option value={key} key={key}>
                    {l.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={13} />
            </label>
            <button
              className="icon-button"
              aria-label="Reset starter code"
              title="Reset starter code"
              onClick={() => {
                if (problem) {
                  setSource(problem.starter[language]);
                  localStorage.removeItem(draftKey);
                }
              }}
            >
              <RotateCcw size={15} />
            </button>
          </div>
          <div className="editor-wrap">
            <Suspense
              fallback={<div className="panel-loading">Opening editor…</div>}
            >
              <Editor
                height="100%"
                language={LANGUAGES[language].monaco}
                value={source}
                beforeMount={(m) =>
                  m.editor.defineTheme("dalgo", {
                    base: "vs-dark",
                    inherit: true,
                    rules: [
                      { token: "comment", foreground: "687a95" },
                      { token: "keyword", foreground: "bfa2ee" },
                      { token: "string", foreground: "96cab6" },
                      { token: "number", foreground: "edc88f" },
                    ],
                    colors: {
                      "editor.background": "#0d121d",
                      "editor.foreground": "#dce4f3",
                      "editorLineNumber.foreground": "#46546b",
                      "editorLineNumber.activeForeground": "#9babc3",
                      "editor.lineHighlightBackground": "#121b2b",
                      "editorCursor.foreground": "#7aa2ff",
                      "editor.selectionBackground": "#263f6c",
                      "editorWidget.background": "#192235",
                    },
                  })
                }
                theme="dalgo"
                onChange={(v) => {
                  setSource(v ?? "");
                  localStorage.setItem(draftKey, v ?? "");
                }}
                options={{
                  fontFamily: "JetBrains Mono",
                  fontSize: 14,
                  lineHeight: 25,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  padding: { top: 22 },
                  automaticLayout: true,
                  tabSize: 4,
                  wordWrap: "on",
                  renderLineHighlight: "line",
                  overviewRulerLanes: 0,
                  hideCursorInOverviewRuler: true,
                  readOnly: !!match?.result,
                }}
                loading={
                  <div className="panel-loading">
                    <LoaderCircle className="spin" />
                    Opening editor…
                  </div>
                }
              />
            </Suspense>
          </div>
          <div className="console-panel">
            <div className="console-tabs">
              <span>
                <Code2 size={14} />
                Test results
              </span>
              <span className="tiny muted">
                {preview
                  ? "Sample cases"
                  : `${match?.attempts.runs ?? 0}/3 runs · ${match?.attempts.submits ?? 0}/5 submissions`}
              </span>
            </div>
            <div className="console-body" aria-live="polite">
              {error ? (
                <div className="error">
                  <AlertCircle size={16} />
                  {error}
                </div>
              ) : latest ? (
                <>
                  <div className={"verdict " + latest.verdict}>
                    {latest.verdict === "pending" ? (
                      <LoaderCircle className="spin" size={18} />
                    ) : latest.verdict === "accepted" ? (
                      <CheckCircle2 size={18} />
                    ) : (
                      <AlertCircle size={18} />
                    )}
                    <strong>{latest.verdict.replaceAll("_", " ")}</strong>
                  </div>
                  <p>{latest.message}</p>
                  {latest.sampleResults?.map((r, i) => (
                    <span
                      className={
                        "test-chip " + (r.passed ? "passed" : "failed")
                      }
                      key={i}
                    >
                      Case {i + 1} · {r.passed ? "passed" : "failed"}
                    </span>
                  ))}
                </>
              ) : (
                <>
                  <div className="sample-chips">
                    {problem?.examples.map((_, i) => (
                      <span className="test-chip" key={i}>
                        Case {i + 1}
                      </span>
                    ))}
                  </div>
                  <p>
                    {preview
                      ? "Your test results will appear here during a match."
                      : "Run your code against the examples before submitting."}
                  </p>
                </>
              )}
            </div>
          </div>
          <div className="editor-actions">
            <span className="autosave">
              <Check size={13} />
              Saved on this device
            </span>
            <div>
              <button
                className="button run-button"
                disabled={
                  preview ||
                  !active ||
                  busy ||
                  ownPending ||
                  (match?.attempts.runs ?? 0) >= 3
                }
                onClick={() => send("run")}
              >
                <Play size={15} />
                Run
              </button>
              <button
                className="button primary"
                disabled={
                  preview ||
                  !active ||
                  busy ||
                  ownPending ||
                  (match?.attempts.submits ?? 0) >= 5
                }
                onClick={() => send("submit")}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <ArrowUpRight size={17} />
                )}
                Submit
              </button>
            </div>
          </div>
        </section>
      </div>
      <div className="match-bottom">
        <span>
          <ShieldCheck size={15} />
          Hidden tests decide correctness. The server keeps time.
        </span>
        {!preview && !match?.result && (
          <button className="text-button" onClick={() => setResign(true)}>
            <Flag size={14} />
            Resign match
          </button>
        )}
        <span className="tiny">
          {preview
            ? "No rating changes in preview"
            : "Your opponent cannot see your code."}
        </span>
      </div>
      {match?.result && <ResultCard match={match} userId={user?.id ?? ""} />}{" "}
      {resign && (
        <Dialog title="Resign match" onClose={() => setResign(false)}>
          <Flag className="dialog-symbol" />
          <h2>Leave this match?</h2>
          <p className="muted">
            Resigning counts as a loss and changes your rating.
          </p>
          <div className="dialog-actions">
            <button className="button" onClick={() => setResign(false)}>
              Keep playing
            </button>
            <button
              className="button danger"
              onClick={async () => {
                try {
                  setMatch(
                    await api<MatchView>("/matches/" + match!.id + "/resign", {
                      method: "POST",
                    }),
                  );
                  setResign(false);
                } catch (e) {
                  setError((e as Error).message);
                  setResign(false);
                }
              }}
            >
              Resign
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
function ResultCard({ match, userId }: { match: MatchView; userId: string }) {
  const result = match.result!;
  const won = result.winnerId === userId;
  const delta = result.deltas[userId] ?? 0;
  return (
    <div className="result-banner" role="status">
      <div className="result-icon">
        {result.reason === "void" ? (
          <AlertCircle />
        ) : won ? (
          <Trophy />
        ) : (
          <Swords />
        )}
      </div>
      <div>
        <p className="eyebrow">
          {result.settled ? "MATCH COMPLETE" : "SAVING RESULT"}
        </p>
        <h2>
          {result.reason === "void"
            ? "Match voided"
            : !result.winnerId
              ? "A well-fought draw."
              : won
                ? "That’s your win."
                : "A lesson for the next one."}
        </h2>
        <p>
          {result.reason === "void"
            ? "Judging could not produce a reliable result. Your rating is unchanged."
            : result.reason === "draw"
              ? "Neither player finished first. Ratings stay the same."
              : won
                ? "Your next challenge is waiting."
                : "Take a breath. Come back stronger."}
        </p>
      </div>
      <div className={"result-delta " + (delta > 0 ? "positive" : "")}>
        {delta > 0 ? "+" : ""}
        {delta}
        <span>rating</span>
      </div>
      <Link className="button primary" to="/">
        Back to arenas
        <ArrowRight size={17} />
      </Link>
    </div>
  );
}
function Leaderboard() {
  const [arena, setArena] = useState<Arena>("easy");
  const [mode, setMode] = useState<Mode>("human");
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    setLoading(true);
    api<LeaderRow[]>(`/leaderboard?arena=${arena}&mode=${mode}`)
      .then((v) => {
        setRows(v);
        setError("");
      })
      .catch(() => {
        setRows([]);
        setError("Rankings will appear when the beta opens.");
      })
      .finally(() => setLoading(false));
  }, [arena, mode]);
  return (
    <main className="page secondary-page">
      <p className="eyebrow">EARN YOUR PLACE</p>
      <h1>The leaderboard.</h1>
      <p className="intro-copy">Every rating has a story. Start yours.</p>
      <div className="list-controls">
        <ArenaTabs value={arena} onChange={setArena} />
        <ModeSwitch value={mode} onChange={setMode} />
      </div>
      <div className="data-panel">
        <div className="leader-head">
          <span>RANK</span>
          <span>PLAYER</span>
          <span>MATCHES</span>
          <span>RATING</span>
        </div>
        {rows.length ? (
          rows.map((r, i) => (
            <div className="leader-row" key={r.user_id}>
              <span className="rank">{String(i + 1).padStart(2, "0")}</span>
              <strong>
                <span className="mini-avatar">
                  {r.profiles.display_name?.[0] ?? "D"}
                </span>
                {r.profiles.display_name || r.profiles.username}
              </strong>
              <span>{r.matches}</span>
              <strong className="rating-number">
                {r.rating.toLocaleString()}
              </strong>
            </div>
          ))
        ) : (
          <Empty
            icon={<Trophy size={30} />}
            title={loading ? "Finding the rankings…" : "The top spot is open."}
            description={
              error || "Complete a match in this arena to earn your place."
            }
          />
        )}
      </div>
      <p className="under-note">
        <ShieldCheck size={16} />
        {mode === "human"
          ? "Only human matches count toward this leaderboard."
          : "Bot ratings are tracked separately from human competition."}
      </p>
      <Footer />
    </main>
  );
}
function ArenaTabs({
  value,
  onChange,
}: {
  value: Arena;
  onChange: (v: Arena) => void;
}) {
  return (
    <div className="arena-tabs" role="group" aria-label="Arena">
      {arenaKeys.map((a) => (
        <button
          key={a}
          aria-pressed={a === value}
          className={a === value ? "active" : ""}
          onClick={() => onChange(a)}
        >
          {ARENAS[a].name}
        </button>
      ))}
    </div>
  );
}
function Empty({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div>{icon}</div>
      <h2>{title}</h2>
      <p>{description}</p>
      {children}
    </div>
  );
}
function History({ onSignIn }: { onSignIn: () => void }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (user)
      api<HistoryRow[]>("/history")
        .then(setRows)
        .catch((e) => setError(e.message));
  }, [user?.id]);
  return (
    <main className="page secondary-page">
      <p className="eyebrow">ONE MATCH AT A TIME</p>
      <h1>Your match history.</h1>
      <p className="intro-copy">
        The wins, the close calls, and everything you learn along the way.
      </p>
      <div className="data-panel history-panel">
        {rows.length ? (
          rows.map((r) => {
            const delta = r.result.deltas[user!.id] ?? 0;
            return (
              <Link className="history-row" key={r.id} to={"/match/" + r.id}>
                <span
                  className={
                    "history-result " +
                    (r.result.winnerId === user?.id ? "win" : "")
                  }
                >
                  {r.result.reason === "void"
                    ? "Void"
                    : !r.result.winnerId
                      ? "Draw"
                      : r.result.winnerId === user?.id
                        ? "Win"
                        : "Loss"}
                </span>
                <div>
                  <strong>
                    {r.problem_title || ARENAS[r.arena].name + " arena"}
                  </strong>
                  <span>
                    {r.mode === "bot" ? "Simulated bot" : "Human opponent"} ·{" "}
                    {new Date(r.ended_at).toLocaleDateString()}
                  </span>
                </div>
                <strong className={delta > 0 ? "positive" : ""}>
                  {delta > 0 ? "+" : ""}
                  {delta}
                </strong>
                <ChevronRight size={17} />
              </Link>
            );
          })
        ) : (
          <Empty
            icon={<Clock3 size={30} />}
            title="A fresh page."
            description={
              error ||
              (user
                ? "Your completed matches will appear here."
                : "Sign in to save your matches and see your progress.")
            }
          >
            <button
              className="button"
              onClick={() => (user ? window.location.assign("/") : onSignIn())}
            >
              {user ? "Choose an arena" : "Sign in"}
              <ArrowUpRight size={16} />
            </button>
          </Empty>
        )}
      </div>
      <Footer />
    </main>
  );
}
function Profile({ onSignIn }: { onSignIn: () => void }) {
  const { user } = useAuth();
  const { ratings, ratingsError } = useRatings();
  return (
    <main className="page secondary-page">
      <p className="eyebrow">YOUR STARTING LINE</p>
      <h1>{user?.user_metadata?.full_name || "Your profile."}</h1>
      <p className="intro-copy">
        Three arenas. Two kinds of competition. Your own pace.
      </p>
      {ratingsError && (
        <p className="error" role="alert">
          {ratingsError}
        </p>
      )}
      {!user ? (
        <div className="data-panel">
          <Empty
            icon={<UserRound size={30} />}
            title="Make this space yours."
            description="Sign in to track all six ratings."
          >
            <button className="button" onClick={onSignIn}>
              Sign in
              <ArrowUpRight size={16} />
            </button>
          </Empty>
        </div>
      ) : (
        <div className="profile-grid">
          {arenaKeys.map((a) => (
            <div className="profile-card" key={a}>
              <h2>{ARENAS[a].name} arena</h2>
              {(["human", "bot"] as Mode[]).map((m) => {
                const r = ratings.find((r) => r.arena === a && r.mode === m);
                return (
                  <div className="profile-rating" key={m}>
                    <span>
                      {m === "human" ? (
                        <Users size={17} />
                      ) : (
                        <Code2 size={17} />
                      )}{" "}
                      {m === "human" ? "Human" : "Bot"} rating
                    </span>
                    <strong>
                      {r?.rating ?? "—"}
                      <small>
                        {r ? `${r.matches} matches` : "Loading rating…"}
                      </small>
                    </strong>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      <Footer />
    </main>
  );
}
export default function App() {
  return <Shell />;
}
