import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { api } from "../api";
import { ARENAS, LANGUAGES, type MatchView } from "../../shared/types";
import { useAuth } from "../auth";
import { MatchChat } from "./MatchChat";
import type { PublicMatchReview } from "../../shared/review";
import { Footer } from "./Chrome";

const mono = '"JetBrains Mono", monospace';

function verdictLabel(value: string) {
  return value.replaceAll("_", " ");
}

export function MatchReviewPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [participantMatch, setParticipantMatch] = useState<MatchView | null>(null);
  const [review, setReview] = useState<PublicMatchReview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [playerIndex, setPlayerIndex] = useState(0);
  const [attemptIndex, setAttemptIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setReview(null);
    setError("");
    setLoading(true);
    api<PublicMatchReview>(`/matches/${id}/review`)
      .then((value) => {
        if (!cancelled) setReview(value);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!user || !id) {
      setParticipantMatch(null);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const refresh = async () => {
      try {
        const value = await api<MatchView>(`/matches/${id}`);
        if (!stopped) {
          setParticipantMatch(value);
          if (!value.chatEndsAt || value.chatEndsAt <= Date.now()) {
            if (timer) clearInterval(timer);
            timer = null;
          }
        }
        return Boolean(value.chatEndsAt && value.chatEndsAt > Date.now());
      } catch {
        if (!stopped) setParticipantMatch(null);
        if (timer) clearInterval(timer);
        timer = null;
        return false;
      }
    };
    void refresh().then((keepPolling) => {
      if (!stopped && keepPolling && !timer) timer = setInterval(() => void refresh(), 3000);
    });
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, [id, user?.id]);

  const player = review?.players[playerIndex];
  const submissions = player?.submissions ?? [];
  const submission = submissions[attemptIndex];
  const outcome = !review
    ? ""
    : review.result.reason === "void"
      ? "Match voided"
      : !review.result.winnerId
        ? "Draw"
        : `${review.players.find((p) => p.id === review.result.winnerId)?.name ?? "Player"} won`;

  return (
    <Box
      component="main"
      sx={{ maxWidth: 1250, mx: "auto", px: { xs: 2, md: 4 }, py: { xs: 3, md: 5 } }}
    >
      <Button component={Link} to="/history" startIcon={<ArrowLeft size={16} />} sx={{ mb: 3 }}>
        Match history
      </Button>
      {loading ? (
        <Stack sx={{ py: 10, alignItems: "center" }}>
          <CircularProgress size={28} aria-label="Loading match review" />
        </Stack>
      ) : error || !review ? (
        <Alert severity="info">{error || "Match review is unavailable."}</Alert>
      ) : (
        <>
          <Typography variant="overline" color="text.secondary" sx={{ fontFamily: mono }}>
            {ARENAS[review.arena].name.toUpperCase()} / {review.mode.toUpperCase()} MATCH
          </Typography>
          <Typography component="h1" variant="h3" sx={{ mt: 1, mb: 1 }}>
            {review.problem.title}
          </Typography>
          <Stack direction="row" spacing={2} sx={{ alignItems: "center", mb: 4 }}>
            <Typography color="text.secondary">
              {outcome} · {new Date(review.endsAt).toLocaleString()}
            </Typography>
            {participantMatch?.result && participantMatch.chatEndsAt && participantMatch.chatEndsAt > Date.now() && user && (
              <MatchChat match={participantMatch} userId={user.id} />
            )}
          </Stack>

          <Stack direction={{ xs: "column", md: "row" }} spacing={3} sx={{ alignItems: "stretch" }}>
            <Box component="section" aria-label="Problem statement" sx={{ minWidth: 0, flex: 1 }}>
              <Typography component="h2" variant="h5" sx={{ mb: 2 }}>
                Problem
              </Typography>
              <Typography sx={{ whiteSpace: "pre-wrap", lineHeight: 1.75 }}>
                {review.problem.description}
              </Typography>
              {review.problem.examples.map((example, index) => (
                <Paper
                  key={index}
                  variant="outlined"
                  sx={{ mt: 2, p: 2, bgcolor: "#111", borderColor: "divider" }}
                >
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Example {index + 1}
                  </Typography>
                  <Typography component="pre" variant="body2" sx={{ fontFamily: mono, whiteSpace: "pre-wrap", overflowWrap: "anywhere", m: 0 }}>
                    Input: {JSON.stringify(example.args)}{"\n"}Output: {JSON.stringify(example.expected)}
                  </Typography>
                  {example.explanation && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                      {example.explanation}
                    </Typography>
                  )}
                </Paper>
              ))}
              {!!review.problem.constraints.length && (
                <>
                  <Typography component="h3" variant="h6" sx={{ mt: 3, mb: 1 }}>
                    Constraints
                  </Typography>
                  {review.problem.constraints.map((constraint) => (
                    <Typography key={constraint} variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                      {constraint}
                    </Typography>
                  ))}
                </>
              )}
            </Box>

            <Box component="section" aria-label="Submitted code" sx={{ minWidth: 0, flex: 1.1 }}>
              <Typography component="h2" variant="h5" sx={{ mb: 2 }}>
                Submissions
              </Typography>
              <Tabs
                value={playerIndex}
                onChange={(_, value: number) => {
                  setPlayerIndex(value);
                  setAttemptIndex(0);
                }}
                aria-label="Match players"
                variant="fullWidth"
                sx={{ borderBottom: 1, borderColor: "divider" }}
              >
                {review.players.map((person) => (
                  <Tab
                    key={person.id}
                    label={person.name}
                    icon={<Avatar src={person.avatar} sx={{ width: 24, height: 24, fontSize: 12 }}>{person.name.charAt(0)}</Avatar>}
                    iconPosition="start"
                  />
                ))}
              </Tabs>
              {player && (
                <Stack direction="row" sx={{ mt: 2, mb: 2, alignItems: "center", justifyContent: "space-between" }}>
                  <Box>
                    <Typography variant="subtitle1">{player.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {player.isBot ? "Simulated bot" : `Pre-match rating ${player.rating} · ${review.result.deltas[player.id] > 0 ? "+" : ""}${review.result.deltas[player.id] ?? 0} points`}
                    </Typography>
                  </Box>
                  {!player.isBot && (
                    <Button component={Link} to={`/players/${player.id}`} size="small" endIcon={<ArrowUpRight size={14} />}>
                      Profile
                    </Button>
                  )}
                </Stack>
              )}
              {review.codeStatus === "not_available" && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Code from matches played before public reviews is private.
                </Alert>
              )}
              {review.codeStatus === "expired" && (
                <Alert severity="info" sx={{ mb: 2 }}>
                  Submission code is available for 30 days after the match. This code has expired.
                </Alert>
              )}
              {player?.isBot ? (
                <Alert severity="info">Simulated bots do not submit source code.</Alert>
              ) : !submissions.length ? (
                <Alert severity="info">No scored submissions were made by this player.</Alert>
              ) : (
                <>
                  <Tabs
                    value={attemptIndex}
                    onChange={(_, value: number) => setAttemptIndex(value)}
                    aria-label={`${player?.name ?? "Player"} submissions`}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}
                  >
                    {submissions.map((item, index) => (
                      <Tab key={item.id} label={`Submit ${index + 1}`} />
                    ))}
                  </Tabs>
                  {submission && (
                    <>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                        {LANGUAGES[submission.language].name} · {verdictLabel(submission.verdict)} · {new Date(submission.receivedAt).toLocaleTimeString()}
                      </Typography>
                      {submission.source ? (
                        <Box
                          component="pre"
                          aria-label={`${player?.name ?? "Player"} code, submit ${attemptIndex + 1}`}
                          sx={{
                            fontFamily: mono,
                            fontSize: 13,
                            lineHeight: 1.65,
                            bgcolor: "#0b0b0b",
                            color: "text.primary",
                            border: "1px solid",
                            borderColor: "divider",
                            borderRadius: 1,
                            p: 2,
                            m: 0,
                            overflow: "auto",
                            maxHeight: 620,
                            whiteSpace: "pre",
                          }}
                        >
                          {submission.source}
                        </Box>
                      ) : review.codeStatus === "available" ? (
                        <Alert severity="info">Code is unavailable for this submission.</Alert>
                      ) : null}
                    </>
                  )}
                </>
              )}
            </Box>
          </Stack>
        </>
      )}
      <Footer />
    </Box>
  );
}
