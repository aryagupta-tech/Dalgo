import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { api } from "../api";
import { ARENAS, type Arena, type Mode } from "../../shared/types";
import type {
  PublicPlayerHistory,
  PublicPlayerMatch,
  PublicPlayerProfile,
  RankedRating,
} from "../../shared/public-player";
import { Footer } from "./Chrome";

const mono = '"JetBrains Mono", monospace';
const boards: { arena: Arena; mode: Mode }[] = [
  { arena: "easy", mode: "human" },
  { arena: "easy", mode: "bot" },
  { arena: "medium", mode: "human" },
  { arena: "medium", mode: "bot" },
  { arena: "hard", mode: "human" },
  { arena: "hard", mode: "bot" },
];

function boardLabel(arena: Arena, mode: Mode) {
  return `${ARENAS[arena].name} · ${mode === "human" ? "Human" : "Bot"}`;
}

function RatingCard({ board }: { board: RankedRating | undefined }) {
  if (!board) return null;
  return (
    <Paper
      component="div"
      variant="outlined"
      sx={{ p: { xs: 2, sm: 2.5 }, borderRadius: 1, bgcolor: "#101010" }}
    >
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ fontFamily: mono }}
      >
        {boardLabel(board.arena, board.mode)}
      </Typography>
      <Stack
        direction="row"
        spacing={1}
        sx={{ mt: 1, alignItems: "baseline", justifyContent: "space-between" }}
      >
        <Typography variant="h4" sx={{ fontFamily: mono, fontWeight: 600 }}>
          {board.rating.toLocaleString()}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ fontFamily: mono }}
        >
          {board.rank ? `#${board.rank.toLocaleString()}` : "Unranked"}
        </Typography>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {board.matches} {board.matches === 1 ? "match" : "matches"} ·{" "}
        {board.wins} W · {board.losses} L · {board.draws} D
      </Typography>
    </Paper>
  );
}

function MatchCard({ match }: { match: PublicPlayerMatch }) {
  const outcome = match.outcome[0].toUpperCase() + match.outcome.slice(1);
  return (
    <Box
      component="li"
      sx={{
        listStyle: "none",
        py: 2,
        borderBottom: 1,
        borderColor: "divider",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1.5,
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {outcome} · {boardLabel(match.arena, match.mode)}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mt: 0.5 }}
        >
          {new Date(match.endedAt).toLocaleDateString()} ·{" "}
          {match.opponent ? (
            <Box
              component={Link}
              to={`/players/${match.opponent.id}`}
              sx={{ color: "inherit", textDecoration: "underline" }}
            >
              {match.opponent.username
                ? `@${match.opponent.username}`
                : match.opponent.name}
            </Box>
          ) : match.mode === "bot" ? (
            "Simulated bot"
          ) : (
            "Human opponent"
          )}
        </Typography>
      </Box>
      <Typography
        variant="body2"
        sx={{ fontFamily: mono, minWidth: 46, textAlign: "right" }}
      >
        {match.ratingDelta > 0 ? "+" : ""}
        {match.ratingDelta}
      </Typography>
      <Button
        component={Link}
        to={`/matches/${match.id}/review`}
        size="small"
        variant="outlined"
        endIcon={<ArrowRight size={15} />}
        aria-label={`Review ${outcome.toLowerCase()} match from ${new Date(match.endedAt).toLocaleDateString()}`}
      >
        Review
      </Button>
    </Box>
  );
}

export function PublicPlayerPage() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<PublicPlayerProfile | null>(null);
  const [history, setHistory] = useState<PublicPlayerMatch[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setProfile(null);
    setHistory([]);
    setCursor(null);
    setError("");
    setHistoryError("");
    Promise.all([
      api<PublicPlayerProfile>(`/players/${id}`),
      api<PublicPlayerHistory>(`/players/${id}/matches`),
    ])
      .then(([player, matches]) => {
        if (cancelled) return;
        setProfile(player);
        setHistory(matches.matches);
        setCursor(matches.nextCursor);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load this player.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function loadMore() {
    if (!id || !cursor || loadingMore) return;
    setLoadingMore(true);
    setHistoryError("");
    try {
      const next = await api<PublicPlayerHistory>(
        `/players/${id}/matches?cursor=${encodeURIComponent(cursor)}`,
      );
      setHistory((current) => [...current, ...next.matches]);
      setCursor(next.nextCursor);
    } catch (reason) {
      setHistoryError(
        reason instanceof Error
          ? reason.message
          : "Could not load more matches.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <Box
      component="main"
      sx={{
        maxWidth: 1250,
        mx: "auto",
        px: { xs: 2.25, sm: 3.5, lg: 5.75 },
        pt: { xs: 2.5, sm: 3, lg: 3.75 },
      }}
    >
      <Button
        component={Link}
        to="/leaderboard"
        color="inherit"
        startIcon={<ArrowLeft size={16} />}
        sx={{ mb: 3 }}
      >
        Leaderboard
      </Button>
      {loading ? (
        <Stack
          direction="row"
          spacing={1.5}
          role="status"
          sx={{ alignItems: "center" }}
        >
          <CircularProgress size={20} />
          <Typography>Loading player…</Typography>
        </Stack>
      ) : error ? (
        <Alert severity="error">{error}</Alert>
      ) : profile ? (
        <>
          <Stack
            component="header"
            direction="row"
            spacing={{ xs: 2, sm: 3 }}
            sx={{ mb: 3.5, alignItems: "center" }}
          >
            <Avatar
              src={profile.player.avatar}
              alt=""
              sx={{
                width: { xs: 64, sm: 88 },
                height: { xs: 64, sm: 88 },
                bgcolor: "#262626",
                fontSize: "2rem",
              }}
            >
              {profile.player.name[0]}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                component="h1"
                variant="h3"
                sx={{ overflowWrap: "anywhere" }}
              >
                {profile.player.name}
              </Typography>
              {profile.player.username && (
                <Typography color="text.secondary">
                  @{profile.player.username}
                </Typography>
              )}
            </Box>
          </Stack>
          <Stack
            direction="row"
            spacing={{ xs: 2, sm: 4 }}
            useFlexGap
            sx={{ mb: 4, flexWrap: "wrap" }}
          >
            {(["matches", "wins", "losses", "draws"] as const).map((key) => (
              <Box key={key}>
                <Typography variant="h5" sx={{ fontFamily: mono }}>
                  {profile.record[key]}
                </Typography>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ textTransform: "capitalize" }}
                >
                  {key}
                </Typography>
              </Box>
            ))}
          </Stack>
          <Typography component="h2" variant="h5" sx={{ mb: 2 }}>
            Ratings and ranks
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(2, minmax(0, 1fr))",
                lg: "repeat(3, minmax(0, 1fr))",
              },
              gap: 1.5,
              mb: 5,
            }}
          >
            {boards.map(({ arena, mode }) => (
              <RatingCard
                key={`${arena}-${mode}`}
                board={profile.ratings.find(
                  (r) => r.arena === arena && r.mode === mode,
                )}
              />
            ))}
          </Box>
          <Typography component="h2" variant="h5" sx={{ mb: 1 }}>
            Match history
          </Typography>
          {history.length ? (
            <Box
              component="ul"
              sx={{ m: 0, p: 0 }}
              aria-label={`${profile.player.name}'s matches`}
            >
              {history.map((match) => (
                <MatchCard key={match.id} match={match} />
              ))}
            </Box>
          ) : (
            <Typography color="text.secondary">
              No completed matches yet.
            </Typography>
          )}
          {historyError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {historyError}
            </Alert>
          )}
          {cursor && (
            <Button
              onClick={loadMore}
              disabled={loadingMore}
              variant="outlined"
              sx={{ mt: 2.5 }}
            >
              {loadingMore ? "Loading…" : "Show more matches"}
            </Button>
          )}
        </>
      ) : null}
      <Footer />
    </Box>
  );
}
