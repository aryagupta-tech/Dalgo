import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogContent,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { FriendIdentity } from "../../shared/types";
import { api } from "../api";
import { useAuth } from "../auth";

const usernamePattern = /^[a-z0-9][a-z0-9_]{2,19}$/;

export function UsernameOnboarding() {
  const {
    user,
    client,
    profile,
    profileLoading,
    refreshProfile,
    refreshAdmission,
  } = useAuth();
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    setUsername("");
    setError("");
    setCompleted(false);
  }, [user?.id]);

  const normalized = useMemo(() => username.trim().toLowerCase(), [username]);
  const valid = usernamePattern.test(normalized);

  if (
    !user ||
    profileLoading ||
    profile?.usernameConfigured ||
    completed ||
    !profile
  )
    return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await api<FriendIdentity>("/profile/username", {
        method: "PUT",
        body: JSON.stringify({ username: normalized }),
      });
      setCompleted(true);
      refreshProfile();
      refreshAdmission();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      aria-labelledby="username-onboarding-title"
      maxWidth="xs"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            width: "calc(100% - 32px)",
            m: 2,
            border: "1px solid #505050",
            borderRadius: "7px",
            backgroundColor: "#111",
            backgroundImage: "none",
          },
        },
        backdrop: { sx: { backgroundColor: "#000000dc" } },
      }}
    >
      <DialogContent sx={{ p: { xs: 2.5, sm: 4 } }}>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{
            fontFamily: '"JetBrains Mono", monospace',
            letterSpacing: ".09em",
          }}
        >
          DALGO / USERNAME
        </Typography>
        <Typography
          id="username-onboarding-title"
          component="h1"
          variant="h4"
          sx={{ mt: 1.5 }}
        >
          Choose your username
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1.25, lineHeight: 1.65 }}>
          Friends use this username to find and challenge you. It cannot be
          changed later.
        </Typography>
        <Box component="form" onSubmit={submit} sx={{ mt: 3 }}>
          <TextField
            autoFocus
            fullWidth
            label="Username"
            placeholder="algorithm_arya"
            value={username}
            onChange={(event) =>
              setUsername(
                event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""),
              )
            }
            error={Boolean(username) && !valid}
            helperText="3–20 lowercase letters, numbers, or underscores. Start with a letter or number."
            slotProps={{
              htmlInput: {
                maxLength: 20,
                autoComplete: "username",
                spellCheck: false,
              },
            }}
          />
          {normalized && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 1.25, fontFamily: '"JetBrains Mono", monospace' }}
            >
              Your public username: @{normalized}
            </Typography>
          )}
          {error && (
            <Alert severity="error" icon={false} sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
          <Stack
            direction={{ xs: "column", sm: "row" }}
            spacing={1.25}
            sx={{ mt: 3 }}
          >
            <Button
              type="submit"
              variant="contained"
              disabled={!valid || busy}
              sx={{ flex: 1 }}
            >
              {busy ? "Saving…" : "Save username"}
            </Button>
            <Button
              type="button"
              variant="text"
              color="inherit"
              disabled={busy}
              onClick={() => client?.auth.signOut()}
            >
              Sign out
            </Button>
          </Stack>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
