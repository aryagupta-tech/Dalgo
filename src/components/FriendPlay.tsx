import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, Copy, Swords, UserPlus, X } from "lucide-react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  Paper,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  ARENAS,
  type Arena,
  type FriendChallenge,
  type FriendChallengeView,
  type FriendIdentity,
} from "../../shared/types";
import { api, connectEvents } from "../api";
import { useAuth } from "../auth";

const arenas = Object.keys(ARENAS) as Arena[];
const emptyView = (): FriendChallengeView => ({
  serverNow: Date.now(),
  incoming: [],
  outgoing: [],
  recent: [],
});

function ChallengeRow({
  challenge,
  userId,
  busy,
  onAction,
}: {
  challenge: FriendChallenge;
  userId: string;
  busy: string;
  onAction: (
    challenge: FriendChallenge,
    action: "accept" | "decline" | "cancel",
  ) => void;
}) {
  const incoming = challenge.challenged.id === userId;
  const other = incoming ? challenge.challenger : challenge.challenged;
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "minmax(0, 1fr) auto" },
        alignItems: "center",
        gap: 2,
        px: { xs: 2, sm: 2.5 },
        py: 2.25,
        borderTop: 1,
        borderColor: "divider",
      }}
    >
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", minWidth: 0 }}
      >
        <Avatar
          src={other.avatar}
          variant="rounded"
          sx={{
            width: 38,
            height: 38,
            bgcolor: "#222",
            border: "1px solid #454545",
          }}
        >
          {other.name.slice(0, 1).toUpperCase()}
        </Avatar>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600 }} noWrap>
            {other.name}
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontFamily: '"JetBrains Mono", monospace' }}
          >
            {other.username ? `@${other.username} · ` : ""}
            {ARENAS[challenge.arena].name.toUpperCase()} ·{" "}
            {incoming ? "CHALLENGED YOU" : "INVITE SENT"}
          </Typography>
        </Box>
      </Stack>
      <Stack direction="row" spacing={1}>
        {incoming ? (
          <>
            <Button
              variant="contained"
              startIcon={<Check size={15} />}
              disabled={Boolean(busy)}
              onClick={() => onAction(challenge, "accept")}
            >
              Accept
            </Button>
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<X size={15} />}
              disabled={Boolean(busy)}
              onClick={() => onAction(challenge, "decline")}
            >
              Decline
            </Button>
          </>
        ) : (
          <Button
            variant="outlined"
            color="inherit"
            disabled={Boolean(busy)}
            onClick={() => onAction(challenge, "cancel")}
          >
            Cancel
          </Button>
        )}
      </Stack>
    </Box>
  );
}

export function FriendPlay({ onSignIn }: { onSignIn: () => void }) {
  const { user, config } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<FriendIdentity | null>(null);
  const [view, setView] = useState<FriendChallengeView>(emptyView);
  const [arena, setArena] = useState<Arena>("easy");
  const [friendUsername, setFriendUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setView(emptyView());
      return;
    }
    let stopped = false;
    setLoading(true);
    setError("");
    Promise.all([
      api<FriendIdentity>("/profile"),
      api<FriendChallengeView>("/challenges"),
    ])
      .then(([identity, challenges]) => {
        if (!stopped) {
          setProfile(identity);
          setView(challenges);
        }
      })
      .catch((reason: Error) => {
        if (!stopped) setError(reason.message);
      })
      .finally(() => {
        if (!stopped) setLoading(false);
      });
    let socket: WebSocket | undefined;
    void connectEvents("/challenges/events", (message) => {
      if (!stopped && message?.type === "challenges") setView(message.data);
    })
      .then((connected) => {
        if (stopped) connected.close();
        else socket = connected;
      })
      .catch(() => {});
    return () => {
      stopped = true;
      socket?.close();
    };
  }, [user?.id]);

  const pending = useMemo(
    () =>
      [...view.incoming, ...view.outgoing].sort(
        (a, b) => b.createdAt - a.createdAt,
      ),
    [view],
  );

  async function createChallenge() {
    setBusy("create");
    setError("");
    try {
      const challenge = await api<FriendChallenge>("/challenges", {
        method: "POST",
        body: JSON.stringify({
          username: friendUsername,
          arena,
          requestId: crypto.randomUUID(),
        }),
      });
      setFriendUsername("");
      setView((current) => ({
        ...current,
        serverNow: Date.now(),
        outgoing: [
          challenge,
          ...current.outgoing.filter((item) => item.id !== challenge.id),
        ],
      }));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function respond(
    challenge: FriendChallenge,
    action: "accept" | "decline" | "cancel",
  ) {
    setBusy(challenge.id + action);
    setError("");
    try {
      const result = await api<FriendChallenge>(
        `/challenges/${challenge.id}${action === "cancel" ? "" : `/${action}`}`,
        { method: action === "cancel" ? "DELETE" : "POST" },
      );
      setView((current) => ({
        ...current,
        serverNow: Date.now(),
        incoming: current.incoming.filter((item) => item.id !== result.id),
        outgoing: current.outgoing.filter((item) => item.id !== result.id),
        recent: [
          result,
          ...current.recent.filter((item) => item.id !== result.id),
        ],
        ...(result.matchId ? { currentMatchId: result.matchId } : {}),
      }));
      if (result.matchId && action === "accept")
        navigate(`/match/${result.matchId}`);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function copyUsername() {
    if (!profile) return;
    try {
      await navigator.clipboard.writeText(profile.username);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError(
        "Copying is unavailable. Select the username and copy it manually.",
      );
    }
  }

  return (
    <Box
      component="main"
      sx={{
        maxWidth: 1160,
        mx: "auto",
        px: { xs: 2.25, sm: 3.5, lg: 5.75 },
        pt: { xs: 2.5, lg: 3.75 },
      }}
    >
      <Typography
        variant="overline"
        sx={{
          fontFamily: '"JetBrains Mono", monospace',
          color: "text.secondary",
          letterSpacing: ".08em",
        }}
      >
        CLUBHOUSE / PLAY A FRIEND
      </Typography>
      <Stack
        component="header"
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{
          justifyContent: "space-between",
          alignItems: { sm: "flex-end" },
          my: { xs: 3, lg: 4 },
        }}
      >
        <Box>
          <Typography
            component="h1"
            variant="h2"
            sx={{
              fontSize: { xs: "2.35rem", sm: "2.8rem" },
              letterSpacing: "-.05em",
            }}
          >
            Play a friend.
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1.25 }}>
            Enter a friend’s username, choose an arena, and send a private challenge.
          </Typography>
        </Box>
        <Chip label="RATED HUMAN MATCH" variant="outlined" />
      </Stack>

      {!user ? (
        <Paper
          variant="outlined"
          sx={{ p: { xs: 2.5, sm: 4 }, bgcolor: "#101010" }}
        >
          <Typography variant="h5">Sign in and choose your username.</Typography>
          <Typography color="text.secondary" sx={{ mt: 1, mb: 3 }}>
            Your username is created once and stays with your account.
          </Typography>
          <Button
            variant="contained"
            onClick={onSignIn}
            startIcon={<UserPlus size={17} />}
          >
            Sign in
          </Button>
        </Paper>
      ) : (
        <Stack spacing={3}>
          {error && (
            <Alert severity="error" onClose={() => setError("")}>
              {error}
            </Alert>
          )}
          {view.currentMatchId && (
            <Alert severity="info" icon={false}>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
                sx={{
                  justifyContent: "space-between",
                  alignItems: { sm: "center" },
                }}
              >
                <Typography>Your friend match is ready.</Typography>
                <Button
                  component={Link}
                  to={`/match/${view.currentMatchId}`}
                  variant="contained"
                >
                  Enter match
                </Button>
              </Stack>
            </Alert>
          )}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                md: "minmax(0, .8fr) minmax(0, 1.2fr)",
              },
              gap: 3,
            }}
          >
            <Paper
              variant="outlined"
              sx={{ p: { xs: 2.25, sm: 3 }, bgcolor: "#101010" }}
            >
              <Typography variant="overline" color="text.secondary">
                YOUR USERNAME
              </Typography>
              {loading && !profile ? (
                <CircularProgress size={24} sx={{ display: "block", mt: 2 }} />
              ) : (
                <>
                  <Typography
                    sx={{
                      mt: 1.5,
                      fontFamily: '"JetBrains Mono", monospace',
                      fontSize: { xs: "1.05rem", sm: "1.3rem" },
                      overflowWrap: "anywhere",
                    }}
                  >
                    {profile?.username ? `@${profile.username}` : "Unavailable"}
                  </Typography>
                  <Button
                    variant="outlined"
                    color="inherit"
                    startIcon={<Copy size={15} />}
                    onClick={copyUsername}
                    disabled={!profile?.usernameConfigured}
                    sx={{ mt: 2 }}
                  >
                    {copied ? "Copied" : "Copy username"}
                  </Button>
                </>
              )}
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 2, lineHeight: 1.65 }}
              >
                Friends use this username to challenge you. It is chosen when
                your account is created and does not reveal sign-in details.
              </Typography>
            </Paper>

            <Paper
              variant="outlined"
              sx={{ p: { xs: 2.25, sm: 3 }, bgcolor: "#101010" }}
            >
              <Typography component="h2" variant="h5">
                Challenge a friend
              </Typography>
              <TextField
                fullWidth
                label="Friend's username"
                placeholder="algorithm_arya"
                value={friendUsername}
                onChange={(event) =>
                  setFriendUsername(event.target.value.toLowerCase())
                }
                slotProps={{ htmlInput: { maxLength: 20 } }}
                sx={{ mt: 2.5 }}
              />
              <RadioGroup
                row
                value={arena}
                onChange={(_, value) => setArena(value as Arena)}
                sx={{ mt: 1.5 }}
              >
                {arenas.map((value) => (
                  <FormControlLabel
                    key={value}
                    value={value}
                    control={<Radio size="small" />}
                    label={ARENAS[value].name}
                  />
                ))}
              </RadioGroup>
              <Button
                variant="contained"
                startIcon={<Swords size={17} />}
                disabled={
                  !config.playEnabled ||
                  !friendUsername.trim() ||
                  Boolean(busy) ||
                  pending.length > 0
                }
                onClick={createChallenge}
                sx={{ mt: 1.5 }}
              >
                {busy === "create" ? "Sending…" : "Send challenge"}
              </Button>
              {!config.playEnabled && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 1.5 }}
                >
                  {config.reason || "Live matches are currently paused."}
                </Typography>
              )}
            </Paper>
          </Box>

          <Paper
            variant="outlined"
            sx={{ bgcolor: "#0d0d0d", overflow: "hidden" }}
          >
            <Stack
              direction="row"
              sx={{
                px: { xs: 2, sm: 2.5 },
                py: 2.25,
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Typography component="h2" variant="h6">
                Open challenges
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontFamily: '"JetBrains Mono", monospace' }}
              >
                {pending.length} OPEN
              </Typography>
            </Stack>
            {pending.length ? (
              pending.map((challenge) => (
                <ChallengeRow
                  key={challenge.id}
                  challenge={challenge}
                  userId={user.id}
                  busy={busy}
                  onAction={respond}
                />
              ))
            ) : (
              <Box
                sx={{
                  px: { xs: 2, sm: 2.5 },
                  py: 4,
                  borderTop: 1,
                  borderColor: "divider",
                }}
              >
                <Typography color="text.secondary">
                  No open challenges. Share your username or invite a friend
                  above.
                </Typography>
              </Box>
            )}
          </Paper>

          {view.recent.length > 0 && (
            <Paper
              variant="outlined"
              sx={{ bgcolor: "#0d0d0d", overflow: "hidden" }}
            >
              <Typography
                component="h2"
                variant="h6"
                sx={{ px: { xs: 2, sm: 2.5 }, py: 2.25 }}
              >
                Recent challenges
              </Typography>
              {view.recent.slice(0, 6).map((challenge) => {
                const other =
                  challenge.challenger.id === user.id
                    ? challenge.challenged
                    : challenge.challenger;
                return (
                  <Stack
                    key={challenge.id}
                    direction="row"
                    spacing={2}
                    sx={{
                      px: { xs: 2, sm: 2.5 },
                      py: 2,
                      borderTop: 1,
                      borderColor: "divider",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <Box>
                      <Typography>{other.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {ARENAS[challenge.arena].name} · {challenge.status}
                      </Typography>
                    </Box>
                    {challenge.matchId && (
                      <Button
                        component={Link}
                        to={`/match/${challenge.matchId}`}
                        size="small"
                      >
                        Open match
                      </Button>
                    )}
                  </Stack>
                );
              })}
            </Paper>
          )}
        </Stack>
      )}
    </Box>
  );
}
