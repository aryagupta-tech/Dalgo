import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  Clock3,
  LogOut,
  Play,
  RefreshCw,
  Swords,
  Trophy,
  UserRound,
} from "lucide-react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  FormControlLabel,
  List,
  ListItem,
  ListItemButton,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
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
import { LiveMatchPage, LiveQueue } from "./components/MatchPage";
import { FriendPlay } from "./components/FriendPlay";
import { UsernameOnboarding } from "./components/UsernameOnboarding";
import { PrivacyPage } from "./components/PrivacyPage";
import { ProfilePage } from "./components/ProfilePage";
import { MatchReviewPage } from "./components/MatchReviewPage";
import { PublicPlayerPage } from "./components/PublicPlayerPage";
const arenaDetails = {
  easy: { topics: "Arrays, strings, hash maps" },
  medium: { topics: "Trees, graphs, dynamic programming" },
  hard: { topics: "Advanced graphs, DP, optimization" },
};
const navigation = [
  { to: "/", label: "Play", icon: Swords },
  { to: "/friends", label: "Friends", icon: UserRound },
  { to: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { to: "/history", label: "History", icon: Clock3 },
  { to: "/profile", label: "Your profile", icon: UserRound },
];
export default function App() {
  useDalgoTools();
  const { user, client, profile } = useAuth();
  const [signIn, setSignIn] = useState(false);
  const location = useLocation();
  const matchRoute = /^\/match\//.test(location.pathname);
  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: matchRoute ? "block" : { xs: "block", sm: "grid" },
        gridTemplateColumns: {
          sm: "74px minmax(0, 1fr)",
          md: "180px minmax(0, 1fr)",
          lg: "208px minmax(0, 1fr)",
        },
      }}
    >
      {!matchRoute && (
        <Box
          component="aside"
          sx={{
            position: { xs: "static", sm: "sticky" },
            top: 0,
            height: { xs: "auto", sm: "100dvh" },
            display: { xs: "grid", sm: "flex" },
            gridTemplateColumns: "1fr auto",
            flexDirection: "column",
            alignItems: { xs: "center", sm: "stretch" },
            px: { xs: 2.25, sm: 1.4, md: 1.5, lg: 2.4 },
            pt: { xs: 2, sm: 3.25, lg: 4.5 },
            pb: { xs: 0, sm: 2.5 },
            backgroundColor: "#0c0c0c",
            borderRight: { xs: 0, sm: 1 },
            borderBottom: { xs: 1, sm: 0 },
            borderColor: "divider",
          }}
        >
          <Box
            sx={{
              px: { xs: 0, md: 1 },
              pb: { xs: 0, sm: 3.75, md: 5 },
              textAlign: { sm: "center", md: "left" },
            }}
          >
            <Brand compactAtMedium />
          </Box>
          <List
            component="nav"
            aria-label="Main navigation"
            disablePadding
            sx={{
              display: { xs: "grid", sm: "flex" },
              gridColumn: "1/-1",
              gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
              flexDirection: "column",
              gap: { xs: 0, sm: 0.75 },
              mt: { xs: 2, sm: 0 },
            }}
          >
            {navigation.map(({ to, label, icon: Icon }) => (
              <ListItemButton
                key={to}
                component={NavLink}
                to={to}
                end={to === "/"}
                aria-label={label}
                selected={location.pathname === to}
                sx={{
                  minWidth: 0,
                  minHeight: { xs: 54, sm: 46 },
                  px: { xs: 0.25, sm: 1.5 },
                  py: 1.25,
                  gap: { xs: 0.65, sm: 1.4 },
                  flexDirection: { xs: "column", sm: "row" },
                  justifyContent: { xs: "center", md: "flex-start" },
                  color: "text.secondary",
                  borderRadius: { xs: 0, sm: 1 },
                  borderBottom: { xs: "2px solid transparent", sm: 0 },
                  "&.Mui-selected": {
                    color: "text.primary",
                    backgroundColor: { xs: "transparent", sm: "#202020" },
                    borderBottomColor: { xs: "#eeeeee" },
                  },
                  "&:hover, &.Mui-selected:hover": {
                    backgroundColor: "#191919",
                  },
                }}
              >
                <Icon size={18} aria-hidden="true" />
                <Typography
                  component="span"
                  sx={{
                    display: { xs: "inline", sm: "none", md: "inline" },
                    fontSize: { xs: ".7rem", md: ".875rem" },
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </Typography>
              </ListItemButton>
            ))}
          </List>
          <Box sx={{ mt: { xs: 0, sm: "auto" }, gridColumn: 2, gridRow: 1 }}>
            {user ? (
              <Stack spacing={1}>
                <Button
                  component={Link}
                  to="/profile"
                  aria-label="Your account"
                  variant="text"
                  color="inherit"
                  sx={{
                    justifyContent: {
                      xs: "flex-end",
                      sm: "center",
                      md: "flex-start",
                    },
                    p: { xs: 0, sm: 1 },
                    minWidth: 0,
                    gap: 1,
                    textAlign: "left",
                    overflowWrap: "anywhere",
                  }}
                >
                  <Avatar
                    src={profile?.avatar}
                    slotProps={{ img: { alt: "" } }}
                    variant="rounded"
                    sx={{
                      width: 29,
                      height: 29,
                      backgroundColor: "#202020",
                      border: "1px solid #494949",
                      color: "text.primary",
                      fontSize: ".875rem",
                    }}
                  >
                    {
                      (profile?.username ||
                        user.user_metadata?.full_name ||
                        "You")[0]
                    }
                  </Avatar>
                  <Box
                    component="span"
                    sx={{ display: { xs: "none", md: "inline" } }}
                  >
                    {profile?.username
                      ? `@${profile.username}`
                      : user.user_metadata?.full_name || "Your account"}
                  </Box>
                </Button>
                <Button
                  size="small"
                  variant="text"
                  color="inherit"
                  startIcon={<LogOut size={15} />}
                  onClick={() => client?.auth.signOut()}
                  sx={{
                    display: { xs: "none", sm: "none", md: "inline-flex" },
                    justifyContent: "flex-start",
                    color: "text.secondary",
                  }}
                >
                  Sign out
                </Button>
              </Stack>
            ) : (
              <Button
                variant="outlined"
                onClick={() => setSignIn(true)}
                endIcon={<ArrowUpRight size={17} />}
                sx={{
                  display: { xs: "inline-flex", sm: "none", md: "flex" },
                  width: { md: "100%" },
                  minHeight: { xs: 36, md: 42 },
                  justifyContent: "space-between",
                  whiteSpace: "nowrap",
                }}
              >
                Sign in
              </Button>
            )}
          </Box>
        </Box>
      )}
      <Box sx={{ minWidth: 0 }}>
        <Routes>
          <Route
            path="/"
            element={<Lobby onSignIn={() => setSignIn(true)} />}
          />
          <Route
            path="/match/:id"
            element={<LiveMatchPage onSignIn={() => setSignIn(true)} />}
          />
          <Route path="/matches/:id/review" element={<MatchReviewPage />} />
          <Route
            path="/friends"
            element={<FriendPlay onSignIn={() => setSignIn(true)} />}
          />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/players/:id" element={<PublicPlayerPage />} />
          <Route
            path="/history"
            element={<History onSignIn={() => setSignIn(true)} />}
          />
          <Route
            path="/profile"
            element={<ProfilePage onSignIn={() => setSignIn(true)} />}
          />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route
            path="*"
            element={
              <Page>
                <Typography component="h1" variant="h2" sx={{ mb: 3 }}>
                  Page not found.
                </Typography>
                <Button
                  component={Link}
                  to="/"
                  variant="contained"
                  endIcon={<ArrowRight size={17} />}
                >
                  Back to the lobby
                </Button>
              </Page>
            }
          />
        </Routes>
      </Box>
      {signIn && <SignIn onClose={() => setSignIn(false)} />}
      <UsernameOnboarding />
    </Box>
  );
}
function Page({ children }: { children: ReactNode }) {
  return (
    <Box
      component="main"
      sx={{
        maxWidth: 1370,
        mx: "auto",
        px: { xs: 2.25, sm: 3.5, lg: 5.75 },
        pt: { xs: 2.5, sm: 3, lg: 3.75 },
      }}
    >
      {children}
    </Box>
  );
}
function PageTop({ section }: { section: string }) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        alignItems: "center",
        minHeight: 32,
      }}
    >
      <Typography
        component="span"
        variant="overline"
        sx={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: ".75rem",
          letterSpacing: ".075em",
          color: "text.secondary",
        }}
      >
        <Box component="span" sx={{ textTransform: "none" }}>
          dalgo
        </Box>{" "}
        <Box
          component="span"
          sx={{ px: { xs: 0.75, sm: 1.6 }, color: "#949494" }}
        >
          /
        </Box>{" "}
        {section}
      </Typography>
    </Stack>
  );
}
function PageHeading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <Stack
      component="header"
      direction="row"
      spacing={2.5}
      sx={{
        alignItems: "center",
        justifyContent: "space-between",
        my: { xs: 3, lg: 4 },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography
          component="h1"
          variant="h2"
          sx={{
            fontSize: { xs: "2.375rem", sm: "2.5rem", lg: "2.8rem" },
            fontWeight: 500,
            lineHeight: 1.15,
            letterSpacing: "-.05em",
            overflowWrap: "anywhere",
          }}
        >
          {title}
        </Typography>
        {subtitle && (
          <Typography
            color="text.secondary"
            sx={{
              mt: 1.25,
              fontSize: { xs: ".875rem", sm: "1rem" },
              lineHeight: 1.65,
            }}
          >
            {subtitle}
          </Typography>
        )}
      </Box>
      {children}
    </Stack>
  );
}
function SectionHeading({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        justifyContent: "space-between",
        alignItems: "center",
        pb: 2.25,
      }}
    >
      <Typography
        component="h2"
        variant="h6"
        sx={{ fontSize: "1.12rem", fontWeight: 500 }}
      >
        {title}
      </Typography>
      {children}
    </Stack>
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
    <ToggleButtonGroup
      value={mode}
      exclusive
      onChange={(_, value: Mode | null) => {
        if (value) onChange(value);
      }}
      aria-label="Rating type"
      size="small"
      fullWidth
      sx={{ backgroundColor: "#141414" }}
    >
      {(["human", "bot"] as Mode[]).map((m) => (
        <ToggleButton key={m} value={m} sx={{ flex: 1, px: 2 }}>
          {m === "human" ? "Human" : "Bot"}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
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
              error: "We couldn’t check your active match. Try again.",
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
  const rating = ratings.find((r) => r.arena === arena && r.mode === mode);
  return (
    <Page>
      <PageTop section="PLAY" />
      <PageHeading
        title="Choose your arena"
        subtitle="Live data structures and algorithms (DSA) coding matches in Python, C++, Java, and JavaScript."
      />
      {user &&
        (currentQueue?.matchId || currentQueue?.status === "waiting") && (
          <Alert
            component="section"
            severity="info"
            icon={false}
            role="region"
            aria-label="Your current match"
            sx={{ mb: 3 }}
          >
            <Typography
              component="strong"
              variant="body2"
              sx={{
                fontWeight: 600,
              }}
            >
              {currentQueue.matchId
                ? "Your match is still active."
                : "Your opponent search is still active."}
            </Typography>
            {currentQueue.matchId ? (
              <Button
                component={Link}
                to={"/match/" + currentQueue.matchId}
                variant="contained"
                endIcon={<ArrowRight size={16} />}
                sx={{ mt: 2 }}
              >
                Resume match
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={() =>
                  setQueue({
                    arena: currentQueue.arena ?? arena,
                    resume: true,
                    userId: user.id,
                  })
                }
                endIcon={<ArrowRight size={16} />}
                sx={{ mt: 2 }}
              >
                Resume search
              </Button>
            )}
          </Alert>
        )}
      {user && recoveryError && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            {recoveryError}
          </Typography>
          <Button
            variant="outlined"
            onClick={() => setRecoveryVersion((version) => version + 1)}
          >
            Check again
          </Button>
        </Alert>
      )}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            lg: "minmax(0, 1fr) 248px",
          },
          gap: { xs: 3, lg: 4.5 },
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Paper
            component="section"
            variant="outlined"
            aria-label="Arena selection"
            sx={{
              borderRadius: "6px",
              backgroundColor: "#111111",
              overflow: "hidden",
            }}
          >
            <Box sx={{ px: { xs: 2.25, sm: 3 }, pt: 2.75 }}>
              <SectionHeading title="Arena" />
            </Box>
            <RadioGroup
              name="arena"
              value={arena}
              onChange={(_, value) => setArena(value as Arena)}
              aria-label="Arena difficulty"
              sx={{ borderTop: 1, borderBottom: 1, borderColor: "divider" }}
            >
              {arenaKeys.map((a, i) => (
                <FormControlLabel
                  key={a}
                  value={a}
                  labelPlacement="start"
                  disableTypography
                  control={
                    <Radio
                      size="small"
                      sx={{ p: 0, ml: { xs: 1, sm: 1.8 }, flexShrink: 0 }}
                    />
                  }
                  label={
                    <Box
                      sx={{
                        flex: 1,
                        minWidth: 0,
                        display: "grid",
                        gridTemplateColumns: {
                          xs: "minmax(0, 1fr) 48px",
                          sm: "minmax(0, 1fr) 62px",
                        },
                        alignItems: "center",
                        gap: { xs: 1.3, sm: 1.9 },
                      }}
                    >
                      <Box>
                        <Typography
                          component="strong"
                          sx={{
                            display: "block",
                            fontFamily: '"Space Grotesk", Inter, sans-serif',
                            fontSize: "1.25rem",
                            fontWeight: 500,
                          }}
                        >
                          {ARENAS[a].name}
                        </Typography>
                        <Typography
                          component="span"
                          color="text.secondary"
                          sx={{
                            display: "block",
                            mt: 0.6,
                            fontSize: { xs: ".75rem", sm: ".875rem" },
                            lineHeight: 1.5,
                          }}
                        >
                          {arenaDetails[a].topics}
                        </Typography>
                      </Box>
                      <Box sx={{ textAlign: "right" }}>
                        <Typography
                          component="span"
                          sx={{
                            fontFamily: '"JetBrains Mono", monospace',
                            fontSize: { xs: ".875rem", sm: "1rem" },
                          }}
                        >
                          {formatClock(ARENAS[a].duration)}
                        </Typography>
                        <Typography
                          component="span"
                          color="text.secondary"
                          sx={{ display: "block", mt: 0.75, fontSize: ".7rem" }}
                        >
                          minutes
                        </Typography>
                      </Box>
                    </Box>
                  }
                  sx={{
                    m: 0,
                    px: { xs: 2.25, sm: 3 },
                    py: 2.4,
                    minHeight: 84,
                    backgroundColor: arena === a ? "#202020" : "#0c0c0c",
                    boxShadow: arena === a ? "inset 3px 0 #eeeeee" : "none",
                    borderBottom: i < 2 ? 1 : 0,
                    borderColor: "divider",
                    "&:hover": { backgroundColor: "#1c1c1c" },
                    "&:has(input:focus-visible)": {
                      outline: "2px solid #eeeeee",
                      outlineOffset: "-3px",
                    },
                  }}
                />
              ))}
            </RadioGroup>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1.75}
              sx={{
                justifyContent: "space-between",
                alignItems: { xs: "stretch", sm: "center" },
                p: { xs: 2.25, sm: 3 },
                borderTop: 1,
                borderColor: "divider",
                backgroundColor: "#151515",
              }}
            >
              <Box>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 500,
                  }}
                >
                  {ARENAS[arena].name} · {ARENAS[arena].duration / 60} minutes
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mt: 0.6, maxWidth: { sm: 240 } }}
                >
                  {config.playEnabled
                    ? "Players are matched first. If none is available after 15 seconds, you’ll face a bot."
                    : "Live matches are temporarily unavailable. Please try again later."}
                </Typography>
              </Box>
              <Button
                variant="contained"
                startIcon={<Play size={17} fill="currentColor" />}
                endIcon={<ArrowRight size={18} />}
                disabled={!config.playEnabled}
                sx={{ minHeight: 47, px: 2.4, flexShrink: 0 }}
                onClick={() => {
                  if (!config.playEnabled) return;
                  if (user) setQueue({ arena, resume: false, userId: user.id });
                  else onSignIn();
                }}
              >
                {config.playEnabled ? "Find a match" : "Matches unavailable"}
              </Button>
            </Stack>
          </Paper>
          <RecentHistory />
        </Box>
        <Box
          component="aside"
          sx={{
            display: { xs: "grid", lg: "block" },
            gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
            gap: 4,
            borderTop: { xs: 1, lg: 0 },
            borderColor: "divider",
            pt: { xs: 3.5, lg: 0 },
          }}
        >
          <Box component="section">
            <SectionHeading title="Your rating">
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: ".75rem",
                }}
              >
                ELO
              </Typography>
            </SectionHeading>
            <RatingSwitch mode={mode} onChange={setMode} />
            <Box sx={{ mt: 3.5, mb: 2.75 }}>
              <Typography
                sx={{
                  fontFamily: '"JetBrains Mono", monospace',
                  fontSize: { xs: "3rem", lg: "3.75rem" },
                  lineHeight: 1,
                  letterSpacing: "-.065em",
                  color: "#eeeeee",
                }}
              >
                {rating ? rating.rating.toLocaleString() : "—"}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 1.6 }}
              >
                {ARENAS[arena].name} ·{" "}
                {mode === "human" ? "Human matches" : "Bot matches"}
              </Typography>
            </Box>
            <Stack
              direction="row"
              spacing={1.5}
              sx={{
                justifyContent: "space-between",
                borderTop: 1,
                borderColor: "divider",
                pt: 2,
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {rating
                  ? `${rating.matches} matches played`
                  : "Starting rating"}
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontFamily: '"JetBrains Mono", monospace' }}
              >
                {rating ? `${rating.wins} wins` : "800"}
              </Typography>
            </Stack>
            {error && (
              <Alert severity="error" sx={{ mt: 1.5 }}>
                {error}
              </Alert>
            )}
          </Box>
          <Box
            component="section"
            sx={{
              mt: { lg: 3.5 },
              borderTop: { lg: 1 },
              borderColor: "divider",
              pt: { lg: 3 },
            }}
          >
            <Typography
              variant="overline"
              sx={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: ".75rem",
                color: "text.secondary",
              }}
            >
              MATCH RULES
            </Typography>
            <Stack
              component="ol"
              spacing={2.6}
              sx={{ listStyle: "none", p: 0, mt: 2.75, mb: 0 }}
            >
              {[
                "Same problem. Shared clock.",
                "The first accepted submission wins.",
                "Human and bot ratings are separate.",
              ].map((rule) => (
                <Stack component="li" key={rule} direction="row" spacing={1.75}>
                  <Typography
                    component="span"
                    aria-hidden="true"
                    sx={{
                      fontSize: "1rem",
                      color: "text.secondary",
                      lineHeight: 1.45,
                    }}
                  >
                    •
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {rule}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Box>
        </Box>
      </Box>
      <Footer />
      {queue && user?.id === queue.userId && (
        <LiveQueue
          key={queue.userId + ":" + queue.arena + ":" + queue.resume}
          arena={queue.arena}
          resume={queue.resume}
          onClose={closeQueue}
        />
      )}
    </Page>
  );
}
function RecentHistory() {
  const { user } = useAuth();
  const { rows, error, loading } = useHistory();
  return (
    <Box component="section" sx={{ mt: 3.6 }}>
      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <SectionHeading title="Recent matches">
          <Button
            component={Link}
            to="/history"
            variant="text"
            color="inherit"
            size="small"
            endIcon={<ArrowUpRight size={15} />}
            sx={{ color: "text.secondary", whiteSpace: "nowrap" }}
          >
            View history
          </Button>
        </SectionHeading>
      </Box>
      {user && rows.length ? (
        <MatchRows rows={rows.slice(0, 3)} userId={user.id} />
      ) : (
        <EmptyState
          title={
            loading
              ? "Loading matches…"
              : user
                ? "No matches played yet."
                : "Sign in to view matches."
          }
        >
          {error || undefined}
        </EmptyState>
      )}
    </Box>
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
    <ToggleButtonGroup
      value={arena}
      exclusive
      onChange={(_, value: Arena | null) => {
        if (value) onChange(value);
      }}
      aria-label="Arena"
      size="small"
      sx={{ backgroundColor: "#141414", minWidth: { sm: 280 } }}
    >
      {arenaKeys.map((a) => (
        <ToggleButton key={a} value={a} sx={{ flex: 1, px: 2 }}>
          {ARENAS[a].name}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
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
    <Page>
      <PageTop section="LEADERBOARD" />
      <PageHeading title="Leaderboard" />
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2.5}
        sx={{
          justifyContent: "space-between",
          mb: 3,
        }}
      >
        <ArenaTabs arena={arena} onChange={setArena} />
        <Box sx={{ minWidth: 170 }}>
          <RatingSwitch mode={mode} onChange={setMode} />
        </Box>
      </Stack>
      <Paper
        variant="outlined"
        square
        sx={{
          backgroundColor: "#0d0d0d",
          borderLeft: 0,
          borderRight: 0,
          px: { xs: 1.5, sm: 3 },
        }}
      >
        <TableContainer>
          <Table
            size="small"
            aria-label={`${ARENAS[arena].name} ${mode} ratings`}
            sx={{ tableLayout: "fixed" }}
          >
            <TableHead>
              <TableRow>
                {["RANK", "PLAYER", "MATCHES", "RATING"].map((label, i) => (
                  <TableCell
                    key={label}
                    align={i > 1 ? "right" : "left"}
                    sx={{
                      px: { xs: 0.5, sm: 1 },
                      py: 2.4,
                      fontFamily: '"JetBrains Mono", monospace',
                      color: "text.secondary",
                      fontSize: { xs: ".6rem", sm: ".75rem" },
                      width: i === 0 ? "13%" : i === 1 ? "43%" : "22%",
                    }}
                  >
                    {label}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length ? (
                rows.map((r, i) => (
                  <TableRow key={r.user_id}>
                    <TableCell
                      sx={{
                        px: { xs: 0.5, sm: 1 },
                        py: 2.4,
                        fontFamily: '"JetBrains Mono", monospace',
                        color: "text.secondary",
                      }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </TableCell>
                    <TableCell sx={{ px: { xs: 0.5, sm: 1 }, py: 2.4 }}>
                      <Stack
                        component={Link}
                        to={`/players/${r.user_id}`}
                        direction="row"
                        spacing={1.5}
                        aria-label={`View ${r.profiles?.display_name || r.profiles?.username || "player"} profile`}
                        sx={{
                          alignItems: "center",
                          color: "inherit",
                          textDecoration: "none",
                          "&:hover": { textDecoration: "underline" },
                          "&:focus-visible": {
                            outline: "2px solid currentColor",
                            outlineOffset: 4,
                          },
                        }}
                      >
                        <Avatar
                          src={r.profiles?.avatar_url || undefined}
                          variant="rounded"
                          sx={{
                            width: 29,
                            height: 29,
                            display: { xs: "none", sm: "flex" },
                            backgroundColor: "#202020",
                            color: "text.primary",
                            border: "1px solid #494949",
                            fontSize: ".875rem",
                          }}
                        >
                          {
                            (r.profiles?.display_name ||
                              r.profiles?.username ||
                              "?")[0]
                          }
                        </Avatar>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 500,
                            overflowWrap: "anywhere",
                          }}
                        >
                          {r.profiles?.display_name || r.profiles?.username}
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell align="right" sx={{ px: { xs: 0.5, sm: 1 } }}>
                      {r.matches}
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        px: { xs: 0.5, sm: 1 },
                        fontFamily: '"JetBrains Mono", monospace',
                        fontWeight: 500,
                      }}
                    >
                      {r.rating.toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    sx={{ borderBottom: 0, px: 0, py: 1.8 }}
                  >
                    <EmptyState
                      title={
                        loading ? "Loading rankings…" : "No ranked players yet."
                      }
                    >
                      {error ||
                        (config.playEnabled
                          ? "Complete a match to establish a rating in this arena."
                          : "No ratings are available for this arena yet.")}
                    </EmptyState>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 2.5 }}>
        New ratings start at 800.
      </Typography>
      <Footer />
    </Page>
  );
}
function MatchRows({ rows, userId }: { rows: HistoryRow[]; userId: string }) {
  return (
    <List disablePadding aria-label="Completed matches">
      {rows.map((r) => {
        const win = r.result.winnerId === userId;
        const delta = r.result.deltas[userId] ?? 0;
        return (
          <ListItem
            key={r.id}
            disablePadding
            sx={{
              borderBottom: 1,
              borderColor: "divider",
              gap: { xs: 1, sm: 2 },
            }}
          >
            <ListItemButton
              component={Link}
              to={"/matches/" + r.id + "/review"}
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "44px minmax(0, 1fr) 38px 15px",
                  sm: "62px minmax(0, 1fr) 50px 18px",
                },
                alignItems: "center",
                gap: { xs: 1, sm: 1.9 },
                px: 0,
                py: 2.5,
                minWidth: 0,
                "&:hover": { backgroundColor: "#191919" },
              }}
            >
              <Typography
                variant="body2"
                sx={{ color: win ? "#8dd3b5" : "text.primary" }}
              >
                {r.result.reason === "void"
                  ? "Void"
                  : !r.result.winnerId
                    ? "Draw"
                    : win
                      ? "Win"
                      : "Loss"}
              </Typography>
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  component="strong"
                  variant="body2"
                  sx={{
                    fontWeight: 500,
                    display: "block",
                    overflowWrap: "anywhere",
                  }}
                >
                  {r.problem_title || ARENAS[r.arena].name + " arena"}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block", mt: 0.75 }}
                >
                  {r.mode === "bot"
                    ? "Simulated bot"
                    : r.opponent?.username
                      ? `@${r.opponent.username}`
                      : "Human opponent"}{" "}
                  · {new Date(r.ended_at).toLocaleDateString()}
                </Typography>
              </Box>
              <Typography
                variant="body2"
                sx={{
                  fontFamily: '"JetBrains Mono", monospace',
                  color: delta > 0 ? "#8dd3b5" : "text.primary",
                  textAlign: "right",
                }}
              >
                {delta > 0 ? "+" : ""}
                {delta}
              </Typography>
              <ChevronRight size={15} aria-hidden="true" />
            </ListItemButton>
            {r.mode === "human" && r.opponent?.id && (
              <Button
                component={Link}
                to={`/players/${r.opponent.id}`}
                variant="text"
                color="inherit"
                size="small"
                aria-label={`View ${r.opponent.name} profile`}
                sx={{ minWidth: 0, px: 1, flexShrink: 0 }}
              >
                <UserRound size={17} aria-hidden="true" />
              </Button>
            )}
            {r.mode === "human" && r.opponent?.usernameConfigured && (
              <Button
                component={Link}
                to={{
                  pathname: "/friends",
                  search: new URLSearchParams({
                    challenge: r.opponent.username,
                    arena: r.arena,
                  }).toString(),
                }}
                variant="text"
                color="inherit"
                size="small"
                startIcon={<RefreshCw size={14} />}
                aria-label={`Rematch @${r.opponent.username} in ${ARENAS[r.arena].name}`}
                sx={{ mr: { xs: 0.5, sm: 1 }, flexShrink: 0 }}
              >
                <Box
                  component="span"
                  sx={{ display: { xs: "none", sm: "inline" } }}
                >
                  Rematch
                </Box>
              </Button>
            )}
          </ListItem>
        );
      })}
    </List>
  );
}
function History({ onSignIn }: { onSignIn: () => void }) {
  const { user } = useAuth();
  const { rows, error, loading } = useHistory();
  return (
    <Page>
      <PageTop section="MATCH HISTORY" />
      <PageHeading title="Match history" />
      <Paper
        component="section"
        variant="outlined"
        square
        sx={{
          backgroundColor: "#0d0d0d",
          borderLeft: 0,
          borderRight: 0,
          p: { xs: 2.25, sm: 3 },
        }}
      >
        <SectionHeading title="All matches">
          <Typography
            variant="overline"
            sx={{
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: ".75rem",
              color: "text.secondary",
            }}
          >
            {rows.length} RECORDED
          </Typography>
        </SectionHeading>
        {user && rows.length ? (
          <MatchRows rows={rows} userId={user.id} />
        ) : (
          <EmptyState
            title={
              loading
                ? "Loading your record…"
                : user
                  ? "No matches on record."
                  : "Sign in to view match history."
            }
          >
            {error || undefined}
          </EmptyState>
        )}
      </Paper>
      <Stack
        direction="row"
        useFlexGap
        spacing={1.5}
        sx={{
          flexWrap: "wrap",
          mt: 3,
        }}
      >
        {!user && (
          <Button
            variant="outlined"
            onClick={onSignIn}
            endIcon={<ArrowUpRight size={16} />}
          >
            Sign in
          </Button>
        )}
        <Button
          component={Link}
          to="/"
          variant="contained"
          endIcon={<ArrowRight size={16} />}
        >
          Back to the lobby
        </Button>
      </Stack>
      <Footer />
    </Page>
  );
}
