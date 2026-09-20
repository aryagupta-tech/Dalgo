import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Check,
  Copy,
  RefreshCw,
  Swords,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  Alert,
  Avatar,
  Box,
  Button,
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
  type FriendRequest,
  type FriendsView,
} from "../../shared/types";
import { api, connectEvents } from "../api";
import { useAuth } from "../auth";

const arenas = Object.keys(ARENAS) as Arena[];
const emptyChallenges = (): FriendChallengeView => ({
  serverNow: Date.now(),
  incoming: [],
  outgoing: [],
  recent: [],
});
const emptyFriends = (): FriendsView => ({
  friends: [],
  incoming: [],
  outgoing: [],
});

function Person({ person }: { person: FriendIdentity }) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{ alignItems: "center", minWidth: 0 }}
    >
      <Avatar
        src={person.avatar}
        variant="rounded"
        sx={{
          width: 38,
          height: 38,
          bgcolor: "#222",
          border: "1px solid #454545",
        }}
      >
        {person.name.slice(0, 1).toUpperCase()}
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontWeight: 600 }} noWrap>
          {person.name}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontFamily: '"JetBrains Mono", monospace' }}
        >
          @{person.username}
        </Typography>
      </Box>
    </Stack>
  );
}

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
      <Box>
        <Person person={other} />
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            display: "block",
            mt: 1,
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          {ARENAS[challenge.arena].name.toUpperCase()} ·{" "}
          {incoming ? "CHALLENGED YOU" : "INVITE SENT"}
        </Typography>
      </Box>
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

function FriendRequestRow({
  request,
  incoming,
  busy,
  onAction,
}: {
  request: FriendRequest;
  incoming: boolean;
  busy: string;
  onAction: (
    request: FriendRequest,
    action: "accept" | "decline" | "cancel",
  ) => void;
}) {
  const other = incoming ? request.sender : request.receiver;
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "minmax(0, 1fr) auto" },
        alignItems: "center",
        gap: 2,
        px: { xs: 2, sm: 2.5 },
        py: 2,
        borderTop: 1,
        borderColor: "divider",
      }}
    >
      <Person person={other} />
      <Stack direction="row" spacing={1}>
        {incoming ? (
          <>
            <Button
              size="small"
              variant="contained"
              disabled={Boolean(busy)}
              onClick={() => onAction(request, "accept")}
            >
              Accept friend
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              disabled={Boolean(busy)}
              onClick={() => onAction(request, "decline")}
            >
              Decline
            </Button>
          </>
        ) : (
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            disabled={Boolean(busy)}
            onClick={() => onAction(request, "cancel")}
          >
            Cancel request
          </Button>
        )}
      </Stack>
    </Box>
  );
}

export function FriendPlay({ onSignIn }: { onSignIn: () => void }) {
  const { user, config } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedArena = searchParams.get("arena");
  const requestedUsername = searchParams.get("challenge") ?? "";
  const [profile, setProfile] = useState<FriendIdentity | null>(null);
  const [view, setView] = useState<FriendChallengeView>(emptyChallenges);
  const [friends, setFriends] = useState<FriendsView>(emptyFriends);
  const [arena, setArena] = useState<Arena>(
    arenas.includes(requestedArena as Arena)
      ? (requestedArena as Arena)
      : "easy",
  );
  const [friendUsername, setFriendUsername] = useState(requestedUsername);
  const [requestUsername, setRequestUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const refreshFriends = useCallback(async (quiet = false) => {
    try {
      setFriends(await api<FriendsView>("/friends"));
    } catch (reason) {
      if (!quiet) setError((reason as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setView(emptyChallenges());
      setFriends(emptyFriends());
      return;
    }
    let stopped = false;
    setLoading(true);
    setError("");
    Promise.all([
      api<FriendIdentity>("/profile"),
      api<FriendChallengeView>("/challenges"),
      api<FriendsView>("/friends"),
    ])
      .then(([identity, challenges, friendState]) => {
        if (!stopped) {
          setProfile(identity);
          setView(challenges);
          setFriends(friendState);
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
    const poll = window.setInterval(() => {
      if (!stopped) void refreshFriends(true);
    }, 6000);
    return () => {
      stopped = true;
      socket?.close();
      window.clearInterval(poll);
    };
  }, [refreshFriends, user?.id]);

  const pending = useMemo(
    () =>
      [...view.incoming, ...view.outgoing].sort(
        (a, b) => b.createdAt - a.createdAt,
      ),
    [view],
  );

  async function sendChallenge(username: string, selectedArena: Arena) {
    setBusy("challenge-create");
    setError("");
    try {
      const challenge = await api<FriendChallenge>("/challenges", {
        method: "POST",
        body: JSON.stringify({
          username,
          arena: selectedArena,
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

  async function respondToChallenge(
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

  async function sendFriendRequest() {
    setBusy("friend-request-create");
    setError("");
    try {
      await api<FriendRequest>("/friends/requests", {
        method: "POST",
        body: JSON.stringify({
          username: requestUsername,
          requestId: crypto.randomUUID(),
        }),
      });
      setRequestUsername("");
      await refreshFriends();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function respondToFriendRequest(
    request: FriendRequest,
    action: "accept" | "decline" | "cancel",
  ) {
    setBusy(request.id + action);
    setError("");
    try {
      await api<FriendRequest>(
        `/friends/requests/${request.id}${action === "cancel" ? "" : `/${action}`}`,
        { method: action === "cancel" ? "DELETE" : "POST" },
      );
      await refreshFriends();
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
        pb: 7,
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
        DALGO / FRIENDS
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
            Play with friends
          </Typography>
        </Box>
      </Stack>

      {!user ? (
        <Paper
          variant="outlined"
          sx={{ p: { xs: 2.5, sm: 4 }, bgcolor: "#101010" }}
        >
          <Typography variant="h5">Sign in to play with friends</Typography>
          <Button
            variant="contained"
            onClick={onSignIn}
            startIcon={<UserPlus size={17} />}
            sx={{ mt: 2.5 }}
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
          {requestedUsername && (
            <Alert severity="info" icon={<RefreshCw size={18} />}>
              Rematch @{requestedUsername} · {ARENAS[arena].name}
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
            </Paper>

            <Paper
              variant="outlined"
              sx={{ p: { xs: 2.25, sm: 3 }, bgcolor: "#101010" }}
            >
              <Typography component="h2" variant="h5">
                Challenge a player
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
                aria-label="Challenge arena"
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
                onClick={() => void sendChallenge(friendUsername, arena)}
                sx={{ mt: 1.5 }}
              >
                {busy === "challenge-create" ? "Sending…" : "Send challenge"}
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
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              sx={{
                px: { xs: 2, sm: 2.5 },
                py: 2.25,
                justifyContent: "space-between",
                alignItems: { sm: "center" },
              }}
            >
              <Box>
                <Typography component="h2" variant="h6">
                  Add a friend
                </Typography>
              </Box>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                sx={{ width: { xs: "100%", sm: "auto" } }}
              >
                <TextField
                  size="small"
                  label="Player username"
                  value={requestUsername}
                  onChange={(event) =>
                    setRequestUsername(event.target.value.toLowerCase())
                  }
                  slotProps={{ htmlInput: { maxLength: 20 } }}
                />
                <Button
                  variant="outlined"
                  startIcon={<UserPlus size={16} />}
                  disabled={!requestUsername.trim() || Boolean(busy)}
                  onClick={() => void sendFriendRequest()}
                >
                  {busy === "friend-request-create"
                    ? "Sending…"
                    : "Send request"}
                </Button>
              </Stack>
            </Stack>
            {[...friends.incoming, ...friends.outgoing].length ? (
              <>
                {friends.incoming.map((request) => (
                  <FriendRequestRow
                    key={request.id}
                    request={request}
                    incoming
                    busy={busy}
                    onAction={respondToFriendRequest}
                  />
                ))}
                {friends.outgoing.map((request) => (
                  <FriendRequestRow
                    key={request.id}
                    request={request}
                    incoming={false}
                    busy={busy}
                    onAction={respondToFriendRequest}
                  />
                ))}
              </>
            ) : (
              <Box
                sx={{
                  px: { xs: 2, sm: 2.5 },
                  py: 3,
                  borderTop: 1,
                  borderColor: "divider",
                }}
              >
                <Typography color="text.secondary">
                  No pending friend requests.
                </Typography>
              </Box>
            )}
          </Paper>

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
                Friends
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontFamily: '"JetBrains Mono", monospace' }}
              >
                {friends.friends.length}{" "}
                {friends.friends.length === 1 ? "friend" : "friends"}
              </Typography>
            </Stack>
            {friends.friends.length ? (
              friends.friends.map(({ id, friend, friendsSince }) => (
                <Box
                  key={id}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: {
                      xs: "1fr",
                      sm: "minmax(0, 1fr) auto",
                    },
                    gap: 2,
                    alignItems: "center",
                    px: { xs: 2, sm: 2.5 },
                    py: 2,
                    borderTop: 1,
                    borderColor: "divider",
                  }}
                >
                  <Box>
                    <Person person={friend} />
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mt: 1 }}
                    >
                      Friends since{" "}
                      {new Date(friendsSince).toLocaleDateString()}
                    </Typography>
                  </Box>
                  <Button
                    variant="outlined"
                    startIcon={<Swords size={16} />}
                    disabled={
                      !config.playEnabled || Boolean(busy) || pending.length > 0
                    }
                    onClick={() => void sendChallenge(friend.username, arena)}
                  >
                    Challenge · {ARENAS[arena].name}
                  </Button>
                </Box>
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
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{ alignItems: "center" }}
                >
                  <Users size={18} />
                  <Typography color="text.secondary">
                    No friends yet.
                  </Typography>
                </Stack>
              </Box>
            )}
          </Paper>

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
                Match challenges
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontFamily: '"JetBrains Mono", monospace' }}
              >
                {pending.length} pending
              </Typography>
            </Stack>
            {pending.length ? (
              pending.map((challenge) => (
                <ChallengeRow
                  key={challenge.id}
                  challenge={challenge}
                  userId={user.id}
                  busy={busy}
                  onAction={respondToChallenge}
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
                  No pending match challenges.
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
