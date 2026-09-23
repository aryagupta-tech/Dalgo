import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  LogOut,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Paper,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { ARENAS, type Mode, type Rating } from "../../shared/types";
import { useAuth } from "../auth";
import { arenaKeys, useRatings } from "../data";
import { EmptyState, Footer } from "./Chrome";
import { ProfileAvatarEditor } from "./ProfileAvatarEditor";

const mono = '"JetBrains Mono", monospace';

function joinedLabel(createdAt: string | undefined) {
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(date);
}

function accountProvider(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  if (value.toLowerCase() === "github") return "GitHub";
  if (value.toLowerCase() === "google") return "Google";
  return null;
}

function totalStats(ratings: Rating[]) {
  return ratings.reduce(
    (total, rating) => ({
      matches: total.matches + rating.matches,
      wins: total.wins + rating.wins,
      losses: total.losses + rating.losses,
      draws: total.draws + rating.draws,
    }),
    { matches: 0, wins: 0, losses: 0, draws: 0 },
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <Box
      component="div"
      sx={{
        minWidth: 0,
        px: { xs: 1.75, sm: 2.25 },
        py: { xs: 2, sm: 2.25 },
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        backgroundColor: "#101010",
      }}
    >
      <Typography
        component="dt"
        variant="overline"
        color="text.secondary"
        sx={{ fontFamily: mono }}
      >
        {label}
      </Typography>
      <Typography
        component="dd"
        sx={{
          m: 0,
          mt: 0.7,
          fontFamily: mono,
          fontSize: { xs: "1.35rem", sm: "1.6rem" },
          lineHeight: 1.2,
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function ProfileAction({
  to,
  icon,
  title,
}: {
  to: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <Button
      component={Link}
      to={to}
      color="inherit"
      sx={{
        minHeight: 54,
        px: 1.75,
        py: 1.25,
        justifyContent: "flex-start",
        gap: 1.5,
        borderColor: "divider",
        textAlign: "left",
        whiteSpace: "normal",
      }}
    >
      {icon}
      <Box component="span" sx={{ minWidth: 0, flex: 1 }}>
        <Typography component="span" variant="body2" sx={{ display: "block" }}>
          {title}
        </Typography>
      </Box>
      <ArrowRight size={15} aria-hidden="true" />
    </Button>
  );
}

export function ProfilePage({ onSignIn }: { onSignIn: () => void }) {
  const {
    user,
    client,
    loading: authLoading,
    profile,
    profileLoading,
    profileError,
    refreshProfile,
  } = useAuth();
  const {
    ratings,
    error: ratingsError,
    loading: ratingsLoading,
  } = useRatings();
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [avatarOverride, setAvatarOverride] = useState("");
  const stats = useMemo(() => totalStats(ratings), [ratings]);
  const joined = joinedLabel(user?.created_at);
  const provider = accountProvider(user?.app_metadata?.provider);
  const displayName =
    profile?.name ||
    (typeof user?.user_metadata?.full_name === "string"
      ? user.user_metadata.full_name
      : "dalgo player");
  const ratingsUnavailable = !!ratingsError && ratings.length === 0;
  const winRate = ratingsUnavailable
    ? "—"
    : stats.matches
      ? `${Math.round((stats.wins / stats.matches) * 100)}%`
      : "—";
  const recordValue = (value: number) =>
    ratingsUnavailable ? "—" : String(value);

  async function signOut() {
    if (!client || signOutBusy) return;
    setSignOutBusy(true);
    setSignOutError("");
    try {
      const result = await client.auth.signOut();
      if (result.error) setSignOutError(result.error.message);
    } catch (reason) {
      setSignOutError(
        reason instanceof Error
          ? reason.message
          : "Sign out failed. Try again.",
      );
    } finally {
      setSignOutBusy(false);
    }
  }

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
      <Typography
        component="span"
        variant="overline"
        color="text.secondary"
        sx={{ fontFamily: mono, letterSpacing: ".075em" }}
      >
        <Box component="span" sx={{ textTransform: "none" }}>
          dalgo
        </Box>{" "}
        <Box component="span" sx={{ px: { xs: 0.75, sm: 1.6 } }}>
          /
        </Box>{" "}
        PROFILE
      </Typography>
      <Box component="header" sx={{ my: { xs: 3, lg: 4 } }}>
        <Typography
          component="h1"
          variant="h2"
          sx={{
            fontSize: { xs: "2.375rem", sm: "2.5rem", lg: "2.8rem" },
            fontWeight: 500,
            lineHeight: 1.15,
            letterSpacing: "-.05em",
          }}
        >
          Your profile
        </Typography>
      </Box>

      {authLoading ? (
        <Paper
          aria-label="Loading your profile"
          variant="outlined"
          sx={{ p: { xs: 2.25, sm: 3 }, backgroundColor: "#0d0d0d" }}
        >
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <Skeleton variant="rounded" width={72} height={72} />
            <Box sx={{ flex: 1 }}>
              <Skeleton width="45%" height={32} />
              <Skeleton width="28%" />
            </Box>
          </Stack>
        </Paper>
      ) : !user ? (
        <Paper
          variant="outlined"
          sx={{ p: { xs: 2.25, sm: 3 }, backgroundColor: "#0d0d0d" }}
        >
          <EmptyState title="Sign in to view your profile." />
          <Button variant="contained" onClick={onSignIn}>
            Sign in
          </Button>
        </Paper>
      ) : (
        <Stack spacing={3}>
          <Paper
            component="section"
            aria-labelledby="profile-identity-heading"
            variant="outlined"
            sx={{
              p: { xs: 2.25, sm: 3 },
              backgroundColor: "#0d0d0d",
              borderRadius: 1.5,
            }}
          >
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={{ xs: 2, sm: 2.5 }}
              sx={{ alignItems: { xs: "flex-start", sm: "center" } }}
            >
              <Avatar
                src={avatarOverride || profile?.avatar}
                slotProps={{ img: { alt: "" } }}
                sx={{
                  width: { xs: 68, sm: 78 },
                  height: { xs: 68, sm: 78 },
                  borderRadius: 1.5,
                  border: "1px solid #444",
                  backgroundColor: "#202020",
                  fontSize: "1.7rem",
                }}
              >
                {displayName[0]?.toUpperCase() || <UserRound size={28} />}
              </Avatar>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography
                  id="profile-identity-heading"
                  component="h2"
                  variant="h4"
                  sx={{ overflowWrap: "anywhere" }}
                >
                  {displayName}
                </Typography>
                <Typography
                  color="text.secondary"
                  sx={{ mt: 0.5, fontFamily: mono, overflowWrap: "anywhere" }}
                >
                  {profileLoading
                    ? "Loading username…"
                    : profile?.usernameConfigured
                      ? `@${profile.username}`
                      : "Username setup pending"}
                </Typography>
                {(joined || provider) && (
                  <Stack
                    direction="row"
                    useFlexGap
                    spacing={2}
                    sx={{
                      flexWrap: "wrap",
                      mt: 1.5,
                      color: "text.secondary",
                    }}
                  >
                    {joined && (
                      <Stack
                        direction="row"
                        spacing={0.75}
                        sx={{ alignItems: "center" }}
                      >
                        <CalendarDays size={14} aria-hidden="true" />
                        <Typography variant="caption">
                          Joined {joined}
                        </Typography>
                      </Stack>
                    )}
                    {provider && (
                      <Stack
                        direction="row"
                        spacing={0.75}
                        sx={{ alignItems: "center" }}
                      >
                        <ShieldCheck size={14} aria-hidden="true" />
                        <Typography variant="caption">
                          Signed in with {provider}
                        </Typography>
                      </Stack>
                    )}
                  </Stack>
                )}
              </Box>
              <ProfileAvatarEditor
                disabled={profileLoading}
                onSaved={(updated) => {
                  setAvatarOverride(updated.avatar ?? "");
                  refreshProfile();
                }}
              />
            </Stack>
            {profileError && (
              <Alert severity="error" sx={{ mt: 2.5 }}>
                {profileError}
              </Alert>
            )}
          </Paper>

          <Paper
            component="section"
            aria-labelledby="profile-record-heading"
            variant="outlined"
            sx={{
              p: { xs: 1.5, sm: 2.5 },
              backgroundColor: "#0d0d0d",
            }}
          >
            <Typography
              id="profile-record-heading"
              component="h2"
              variant="h6"
              sx={{ px: { xs: 0.5, sm: 0 } }}
            >
              Match record
            </Typography>
            {ratingsLoading ? (
              <Stack direction="row" spacing={2} sx={{ pt: 2 }}>
                {[1, 2, 3, 4].map((key) => (
                  <Skeleton key={key} height={64} sx={{ flex: 1 }} />
                ))}
              </Stack>
            ) : (
              <Box
                component="dl"
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "repeat(2, minmax(0, 1fr))",
                    md: "repeat(5, minmax(0, 1fr))",
                  },
                  gap: 1,
                  m: 0,
                  mt: 2,
                }}
              >
                <ProfileStat
                  label="MATCHES"
                  value={recordValue(stats.matches)}
                />
                <ProfileStat label="WINS" value={recordValue(stats.wins)} />
                <ProfileStat label="LOSSES" value={recordValue(stats.losses)} />
                <ProfileStat label="DRAWS" value={recordValue(stats.draws)} />
                <ProfileStat label="WIN RATE" value={winRate} />
              </Box>
            )}
          </Paper>

          <Paper
            component="section"
            aria-labelledby="profile-ratings-heading"
            variant="outlined"
            sx={{ p: { xs: 1.5, sm: 2.5 }, backgroundColor: "#0d0d0d" }}
          >
            <Stack
              direction="row"
              spacing={2}
              sx={{
                alignItems: "baseline",
                justifyContent: "space-between",
                px: { xs: 0.5, sm: 0 },
              }}
            >
              <Typography
                id="profile-ratings-heading"
                component="h2"
                variant="h6"
              >
                Arena ratings
              </Typography>
            </Stack>
            <TableContainer sx={{ mt: 1.25 }}>
              <Table
                size="small"
                aria-label="Your arena ratings"
                sx={{ tableLayout: "fixed" }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell>ARENA</TableCell>
                    <TableCell>HUMAN</TableCell>
                    <TableCell>BOT</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {arenaKeys.map((arena) => (
                    <TableRow key={arena}>
                      <TableCell component="th" scope="row" sx={{ py: 2 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {ARENAS[arena].name}
                        </Typography>
                      </TableCell>
                      {(["human", "bot"] as Mode[]).map((mode) => {
                        const rating = ratings.find(
                          (item) => item.arena === arena && item.mode === mode,
                        );
                        return (
                          <TableCell key={mode} sx={{ py: 2 }}>
                            {ratingsLoading ? (
                              <Skeleton width={54} />
                            ) : rating ? (
                              <>
                                <Typography
                                  sx={{ fontFamily: mono, fontSize: "1.05rem" }}
                                >
                                  {rating.rating}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                >
                                  {rating.matches} played
                                </Typography>
                              </>
                            ) : (
                              <Typography color="text.secondary">—</Typography>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {ratingsError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {ratingsError}
              </Alert>
            )}
          </Paper>

          <Paper
            component="section"
            aria-labelledby="profile-actions-heading"
            variant="outlined"
            sx={{ p: { xs: 1.5, sm: 2.5 }, backgroundColor: "#0d0d0d" }}
          >
            <Typography
              id="profile-actions-heading"
              component="h2"
              variant="h6"
              sx={{ px: { xs: 0.5, sm: 0 }, mb: 1.5 }}
            >
              Account
            </Typography>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" },
                gap: 1,
              }}
            >
              <ProfileAction
                to="/history"
                icon={<Clock3 size={19} aria-hidden="true" />}
                title="Match history"
              />
              <ProfileAction
                to="/friends"
                icon={<UsersRound size={19} aria-hidden="true" />}
                title="Friends"
              />
              <ProfileAction
                to="/privacy"
                icon={<ShieldCheck size={19} aria-hidden="true" />}
                title="Privacy & support"
              />
            </Box>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1.5}
              sx={{
                alignItems: { sm: "center" },
                mt: 2.5,
                pt: 2.5,
                borderTop: "1px solid",
                borderColor: "divider",
              }}
            >
              <Button
                onClick={() => void signOut()}
                disabled={signOutBusy || !client}
                startIcon={<LogOut size={16} />}
                color="inherit"
              >
                {signOutBusy ? "Signing out…" : "Sign out"}
              </Button>
            </Stack>
            {signOutError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {signOutError}
              </Alert>
            )}
          </Paper>
        </Stack>
      )}
      <Footer />
    </Box>
  );
}
