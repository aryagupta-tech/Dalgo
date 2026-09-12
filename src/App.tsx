import { useEffect, useState, type ReactNode } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Flag,
  LogOut,
  Play,
  Swords,
  Trophy,
  UserRound,
} from "lucide-react";
import { useAuth } from "./auth";
import { api } from "./api";
import { useDalgoTools } from "./webmcp";
import {
  ARENAS,
  type Arena,
  type HistoryRow,
  type LeaderRow,
  type Mode,
  type QueueView,
} from "../shared/types";
import { Brand, EmptyState, Footer, SignIn } from "./components/Chrome";
import { arenaKeys, formatClock, useHistory, useRatings } from "./data";
import { DemoPage, LiveMatchPage, LiveQueue } from "./components/MatchPage";
const arenaDetails = {
  easy: {
    subtitle: "Start with the fundamentals.",
    topics: "Arrays, strings, hash maps",
    note: "A focused problem with a direct approach. Speed and careful edge cases make the difference.",
  },
  medium: {
    subtitle: "Find the better approach.",
    topics: "Trees, graphs, dynamic programming",
    note: "A problem that rewards pattern recognition. Choose your approach before you start typing.",
  },
  hard: {
    subtitle: "Make every decision count.",
    topics: "Advanced graphs, DP, optimization",
    note: "A deeper problem with tighter constraints. Correctness and complexity both matter.",
  },
};
export default function App() {
  useDalgoTools();
  const { user, client, config } = useAuth();
  const [signIn, setSignIn] = useState(false);
  const location = useLocation();
  const matchRoute = /^\/(demo|match|preview)\//.test(location.pathname);
  return (
    <div className={matchRoute ? "app match-app" : "app"}>
      {!matchRoute && (
        <aside className="sidebar">
          <div className="sidebar-brand">
            <Brand />
            <span className="club-label">THE CODING CLUB</span>
          </div>
          <nav className="side-nav" aria-label="Main navigation">
            <NavLink to="/" end>
              <Swords size={18} />
              Play<span className="nav-index">01</span>
            </NavLink>
            <NavLink to="/leaderboard">
              <Trophy size={18} />
              Leaderboard<span className="nav-index">02</span>
            </NavLink>
            <NavLink to="/history">
              <Clock3 size={18} />
              Match history<span className="nav-index">03</span>
            </NavLink>
            <NavLink to="/profile">
              <UserRound size={18} />
              Your profile<span className="nav-index">04</span>
            </NavLink>
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-status">
              <span className="status-square" />
              {config.playEnabled
                ? config.admissionMode === "staging"
                  ? "Tester matches open"
                  : "Ranked play open"
                : "Demo available"}
              <small>
                {config.admissionMode === "staging"
                  ? "Private staging"
                  : config.playEnabled
                    ? "Free beta"
                    : "Ranked play not open yet"}
              </small>
            </div>
            {user ? (
              <>
                <Link className="account-button" to="/profile">
                  <span className="avatar small">
                    {(user.user_metadata?.full_name || "You")[0]}
                  </span>
                  <span>{user.user_metadata?.full_name || "Your account"}</span>
                </Link>
                <button
                  className="quiet-button sign-out"
                  onClick={() => client?.auth.signOut()}
                >
                  <LogOut size={15} />
                  Sign out
                </button>
              </>
            ) : (
              <button
                className="button sidebar-signin"
                onClick={() => setSignIn(true)}
              >
                Sign in
                <ArrowUpRight size={17} />
              </button>
            )}
          </div>
        </aside>
      )}
      <div className="app-content">
        <Routes>
          <Route
            path="/"
            element={<Lobby onSignIn={() => setSignIn(true)} />}
          />
          <Route path="/demo/:arena" element={<DemoPage />} />
          <Route path="/preview/:arena" element={<PreviewRedirect />} />
          <Route
            path="/match/:id"
            element={<LiveMatchPage onSignIn={() => setSignIn(true)} />}
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
              <main className="page">
                <h1>Page not found.</h1>
                <Link className="button primary" to="/">
                  Back to the lobby
                  <ArrowRight size={17} />
                </Link>
              </main>
            }
          />
        </Routes>
      </div>
      {signIn && <SignIn onClose={() => setSignIn(false)} />}
    </div>
  );
}
function PreviewRedirect() {
  const { arena } = useParams();
  return (
    <Navigate
      replace
      to={"/demo/" + (arenaKeys.includes(arena as Arena) ? arena : "easy")}
    />
  );
}
function PageTop({
  section,
  children,
}: {
  section: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-top">
      <span className="overline">
        CLUBHOUSE <span>/</span> {section}
      </span>
      <div>{children || <span className="badge">FREE BETA</span>}</div>
    </div>
  );
}
function RatingSwitch({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label="Rating type">
      {(["human", "bot"] as Mode[]).map((m) => (
        <button key={m} aria-pressed={mode === m} onClick={() => onChange(m)}>
          {m === "human" ? "Human" : "Bot"}
        </button>
      ))}
    </div>
  );
}
function Lobby({ onSignIn }: { onSignIn: () => void }) {
  const { user, config } = useAuth();
  const { ratings, error } = useRatings();
  const [arena, setArena] = useState<Arena>("easy");
  const [mode, setMode] = useState<Mode>("human");
  const [queue, setQueue] = useState<{
    arena: Arena;
    resume: boolean;
    userId: string;
  } | null>(null);
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const [recovery, setRecovery] = useState<{
    userId: string;
    value: QueueView | null;
    error: string;
  } | null>(null);
  useEffect(() => {
    let stopped = false;
    if (!user) {
      setRecovery(null);
      return;
    }
    const userId = user.id;
    let refreshVersion = 0;
    const refresh = () => {
      const requested = ++refreshVersion;
      void api<QueueView>("/queue")
        .then((value) => {
          if (!stopped && requested === refreshVersion)
            setRecovery({ userId, value, error: "" });
        })
        .catch(() => {
          if (!stopped && requested === refreshVersion)
            setRecovery((prior) => ({
              userId,
              value: prior?.userId === userId ? prior.value : null,
              error:
                "Your current match could not be checked. Retry to reconnect.",
            }));
        });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      stopped = true;
      window.removeEventListener("focus", refresh);
    };
  }, [user?.id, recoveryVersion]);
  const currentQueue = recovery?.userId === user?.id ? recovery?.value : null;
  const recoveryError = recovery?.userId === user?.id ? recovery?.error : "";
  function closeQueue() {
    setQueue(null);
    setRecoveryVersion((version) => version + 1);
  }
  const nav = useNavigate();
  const rating = ratings.find((r) => r.arena === arena && r.mode === mode);
  return (
    <main className="page lobby">
      <PageTop section="PLAY" />
      <header className="page-heading">
        <div>
          <h1>
            The arena<span className="heading-period">.</span>
          </h1>
          <p>One problem. Two players. First correct solution wins.</p>
        </div>
        <span className="heading-side">
          RATED 1v1
          <br />
          <span>10 / 20 / 30 MIN</span>
        </span>
      </header>
      {user &&
        (currentQueue?.matchId || currentQueue?.status === "waiting") && (
          <section
            className="notice"
            aria-label="Your current match"
            style={{ marginBottom: 24 }}
          >
            <strong>
              {currentQueue.matchId
                ? "You have a match to return to."
                : "Your opponent search is still active."}
            </strong>
            <p>
              {currentQueue.matchId
                ? "Reconnect to the server clock, your drafts, and the latest result. Existing matches remain available while new admissions are paused."
                : "Reopen your existing search. This will not create a new queue entry."}
            </p>
            {currentQueue.matchId ? (
              <Link
                className="button primary"
                to={"/match/" + currentQueue.matchId}
              >
                Resume match
                <ArrowRight size={16} />
              </Link>
            ) : (
              <button
                className="button primary"
                onClick={() =>
                  setQueue({
                    arena: currentQueue.arena ?? arena,
                    resume: true,
                    userId: user.id,
                  })
                }
              >
                Resume search
                <ArrowRight size={16} />
              </button>
            )}
          </section>
        )}
      {user && recoveryError && (
        <div className="notice" role="alert" style={{ marginBottom: 24 }}>
          <p>{recoveryError}</p>
          <button
            className="button"
            onClick={() => setRecoveryVersion((version) => version + 1)}
          >
            Retry current match
          </button>
        </div>
      )}
      <div className="lobby-layout">
        <div className="lobby-main">
          <section className="match-setup" aria-label="Choose your match">
            <div className="section-heading">
              <h2>Choose your match</h2>
              <span className="overline">01 — DIFFICULTY</span>
            </div>
            <div
              className="arena-options"
              role="radiogroup"
              aria-label="Arena difficulty"
            >
              {arenaKeys.map((a, i) => (
                <label
                  key={a}
                  className={"arena-option " + (arena === a ? "selected" : "")}
                >
                  <input
                    type="radio"
                    name="arena"
                    value={a}
                    checked={arena === a}
                    onChange={() => setArena(a)}
                  />
                  <span className="arena-order">0{i + 1}</span>
                  <span className="arena-option-name">
                    <strong>{ARENAS[a].name}</strong>
                    <span>{arenaDetails[a].topics}</span>
                  </span>
                  <span className="arena-option-time">
                    {formatClock(ARENAS[a].duration)}
                    <small>minutes</small>
                  </span>
                  <span className="radio-mark">
                    {arena === a && <Check size={14} />}
                  </span>
                </label>
              ))}
            </div>
            <div className="selection-details">
              <span className="overline">
                {ARENAS[arena].name.toUpperCase()} /{" "}
                {ARENAS[arena].duration / 60} MINUTES
              </span>
              <h3>{arenaDetails[arena].subtitle}</h3>
              <p>{arenaDetails[arena].note}</p>
              <div className="format-line">
                <span>
                  <Swords size={15} />1 vs 1
                </span>
                <span>
                  <Flag size={15} />
                  First correct wins
                </span>
                <span>
                  <BookOpen size={15} />
                  Same problem
                </span>
              </div>
            </div>
            <div className="play-row">
              <div>
                <span className="play-label">
                  {config.playEnabled
                    ? "Ready to queue"
                    : "A full match, in demo mode"}
                </span>
                <span className="muted">
                  {config.playEnabled
                    ? "Human opponent first. Bot fallback after 15s."
                    : "Try the clock, editor, and example results."}
                </span>
              </div>
              <button
                className="button primary play-button"
                onClick={() =>
                  config.playEnabled
                    ? user
                      ? setQueue({ arena, resume: false, userId: user.id })
                      : onSignIn()
                    : nav("/demo/" + arena)
                }
              >
                <Play size={17} fill="currentColor" />
                {config.playEnabled ? "Find a match" : "Try demo"}
                <ArrowRight size={18} />
              </button>
            </div>
            {!config.playEnabled && (
              <div className="setup-note">
                <p>No account required. No code execution or saved ratings.</p>
                {config.admissionMode === "staging" && <p>{config.reason}</p>}
              </div>
            )}
          </section>
          <RecentHistory />
        </div>
        <aside className="lobby-rail">
          <section className="rating-panel">
            <div className="section-heading">
              <h2>Your rating</h2>
              <span className="overline">ELO</span>
            </div>
            <RatingSwitch mode={mode} onChange={setMode} />
            <div className="rating-value">
              {rating ? rating.rating.toLocaleString() : "—"}
              <span>
                {ARENAS[arena].name} ·{" "}
                {mode === "human" ? "Human matches" : "Bot matches"}
              </span>
            </div>
            <div className="rating-foot">
              <span>
                {rating
                  ? `${rating.matches} matches played`
                  : "Starting rating"}
              </span>
              <strong>{rating ? `${rating.wins} wins` : "1,200"}</strong>
            </div>
            <p className="muted">
              {user
                ? "Each arena has separate human and bot ratings."
                : "Sign in when ranked play opens to establish your rating."}
            </p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </section>
          <section className="rules-panel">
            <span className="overline">THE MATCH RULES</span>
            <ol>
              <li>
                <span>01</span>
                <div>
                  <strong>Same starting line</strong>
                  <p>Identical problem and a shared clock.</p>
                </div>
              </li>
              <li>
                <span>02</span>
                <div>
                  <strong>Correctness comes first</strong>
                  <p>Pass every hidden test to win.</p>
                </div>
              </li>
              <li>
                <span>03</span>
                <div>
                  <strong>A separate bot ladder</strong>
                  <p>Simulated opponents never change your human rating.</p>
                </div>
              </li>
            </ol>
            <div className="supported-languages">
              <span className="overline">YOUR LANGUAGE</span>
              <p>
                Python <b>·</b> C++ <b>·</b> Java <b>·</b> JavaScript
              </p>
            </div>
          </section>
        </aside>
      </div>
      <Footer />
      {queue && user?.id === queue.userId && (
        <LiveQueue
          key={queue.userId + ":" + queue.arena + ":" + queue.resume}
          arena={queue.arena}
          resume={queue.resume}
          onClose={closeQueue}
        />
      )}
    </main>
  );
}
function RecentHistory() {
  const { user } = useAuth();
  const { rows, error, loading } = useHistory();
  return (
    <section className="recent-history">
      <div className="section-heading">
        <h2>Recent matches</h2>
        <Link className="text-link" to="/history">
          View history
          <ArrowUpRight size={15} />
        </Link>
      </div>
      {user && rows.length ? (
        <MatchRows rows={rows.slice(0, 3)} userId={user!.id} />
      ) : (
        <EmptyState
          title={loading ? "Loading matches…" : "No matches played yet."}
        >
          {error ||
            (user
              ? "Your completed matches and rating changes will appear here."
              : "Your match history starts with your first ranked game. Demo results stay out of the record.")}
        </EmptyState>
      )}
    </section>
  );
}
function ArenaTabs({
  arena,
  onChange,
}: {
  arena: Arena;
  onChange: (a: Arena) => void;
}) {
  return (
    <div className="segmented arena-tabs" role="group" aria-label="Arena">
      {arenaKeys.map((a) => (
        <button key={a} aria-pressed={a === arena} onClick={() => onChange(a)}>
          {ARENAS[a].name}
        </button>
      ))}
    </div>
  );
}
function Leaderboard() {
  const [arena, setArena] = useState<Arena>("easy");
  const [mode, setMode] = useState<Mode>("human");
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { config } = useAuth();
  useEffect(() => {
    let stopped = false;
    setLoading(true);
    setRows([]);
    setError("");
    if (!config.playEnabled) {
      setLoading(false);
      return;
    }
    api<LeaderRow[]>(`/leaderboard?arena=${arena}&mode=${mode}`)
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
  }, [arena, mode, config.playEnabled]);
  return (
    <main className="page">
      <PageTop section="LEADERBOARD" />
      <header className="page-heading">
        <div>
          <h1>
            The standings<span className="heading-period">.</span>
          </h1>
          <p>Rankings by arena. Human and bot results are kept separate.</p>
        </div>
      </header>
      <div className="list-controls">
        <ArenaTabs arena={arena} onChange={setArena} />
        <RatingSwitch mode={mode} onChange={setMode} />
      </div>
      <div className="table-surface">
        <div className="leader-row table-head">
          <span>RANK</span>
          <span>PLAYER</span>
          <span>MATCHES</span>
          <span>RATING</span>
        </div>
        {rows.length ? (
          rows.map((r, i) => (
            <div className="leader-row" key={r.user_id}>
              <span className="rank-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              <strong className="table-player">
                <span className="avatar small">
                  {(r.profiles?.display_name || r.profiles?.username || "?")[0]}
                </span>
                {r.profiles?.display_name || r.profiles?.username}
              </strong>
              <span>{r.matches}</span>
              <strong className="mono">{r.rating.toLocaleString()}</strong>
            </div>
          ))
        ) : (
          <EmptyState
            title={loading ? "Loading rankings…" : "The board is empty."}
          >
            {error ||
              (config.playEnabled
                ? "Complete a match to establish a rating in this arena."
                : "Rankings open with the live beta. Demo matches don’t enter the standings.")}
          </EmptyState>
        )}
      </div>
      <p className="under-note">
        {mode === "human"
          ? "Human matches only."
          : "Simulated bot matches only."}{" "}
        Every new rating starts at 1,200.
      </p>
      <Footer />
    </main>
  );
}
function MatchRows({ rows, userId }: { rows: HistoryRow[]; userId: string }) {
  return (
    <div className="history-rows">
      {rows.map((r) => {
        const win = r.result.winnerId === userId;
        const delta = r.result.deltas[userId] ?? 0;
        return (
          <Link className="history-row" to={"/match/" + r.id} key={r.id}>
            <span className={"result-label " + (win ? "positive" : "")}>
              {r.result.reason === "void"
                ? "Void"
                : !r.result.winnerId
                  ? "Draw"
                  : win
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
            <span className={"mono " + (delta > 0 ? "positive" : "")}>
              {delta > 0 ? "+" : ""}
              {delta}
            </span>
            <ChevronRight size={15} />
          </Link>
        );
      })}
    </div>
  );
}
function History({ onSignIn }: { onSignIn: () => void }) {
  const { user } = useAuth();
  const { rows, error, loading } = useHistory();
  return (
    <main className="page">
      <PageTop section="MATCH HISTORY" />
      <header className="page-heading">
        <div>
          <h1>
            Your record<span className="heading-period">.</span>
          </h1>
          <p>Completed matches, verdicts, and rating changes.</p>
        </div>
      </header>
      <section className="table-surface">
        <div className="section-heading">
          <h2>All matches</h2>
          <span className="overline">{rows.length} RECORDED</span>
        </div>
        {user && rows.length ? (
          <MatchRows rows={rows} userId={user!.id} />
        ) : (
          <EmptyState
            title={loading ? "Loading your record…" : "No matches on record."}
          >
            {error ||
              (user
                ? "Your completed matches will be recorded here."
                : "Sign in when the beta opens to keep your match history. Demo results are never saved here.")}
          </EmptyState>
        )}
      </section>
      <div className="page-actions">
        {!user && (
          <button className="button" onClick={onSignIn}>
            Sign in
            <ArrowUpRight size={16} />
          </button>
        )}
        <Link className="button primary" to="/">
          Back to the lobby
          <ArrowRight size={16} />
        </Link>
      </div>
      <Footer />
    </main>
  );
}
function Profile({ onSignIn }: { onSignIn: () => void }) {
  const { user } = useAuth();
  const { ratings, error } = useRatings();
  return (
    <main className="page">
      <PageTop section="YOUR PROFILE" />
      <header className="page-heading">
        <div>
          <h1>
            {user?.user_metadata?.full_name || "Your profile"}
            <span className="heading-period">.</span>
          </h1>
          <p>Three arenas. Six independent ratings.</p>
        </div>
      </header>
      {user ? (
        <section className="table-surface">
          <div className="profile-row table-head">
            <span>ARENA</span>
            <span>HUMAN RATING</span>
            <span>BOT RATING</span>
          </div>
          {arenaKeys.map((a) => (
            <div className="profile-row" key={a}>
              <strong>{ARENAS[a].name}</strong>
              {(["human", "bot"] as Mode[]).map((m) => {
                const r = ratings.find((r) => r.arena === a && r.mode === m);
                return (
                  <div key={m}>
                    <strong className="mono">{r?.rating ?? "—"}</strong>
                    <span className="muted">
                      {r ? `${r.matches} played` : "Loading…"}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      ) : (
        <section className="table-surface">
          <EmptyState title="Your seat is waiting.">
            Sign in when ranked play opens. You’ll start at 1,200 in each arena,
            with separate ratings for human and simulated bot matches.
          </EmptyState>
          <button className="button primary" onClick={onSignIn}>
            Sign in
            <ArrowUpRight size={16} />
          </button>
        </section>
      )}
      <Footer />
    </main>
  );
}
