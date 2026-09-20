import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Github, X } from "lucide-react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import { useAuth } from "../auth";
export function Brand({
  compactAtMedium = false,
}: {
  compactAtMedium?: boolean;
}) {
  return (
    <Box
      component={Link}
      to="/"
      aria-label="Dalgo home"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 1.1,
        color: "text.primary",
        textDecoration: "none",
      }}
    >
      <svg width="29" height="29" viewBox="0 0 29 29" aria-hidden="true">
        <path
          d="m3 5 9 9.5L3 24M17 5l9 9.5L17 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
        />
      </svg>
      <Typography
        component="span"
        sx={{
          fontFamily: '"Space Grotesk", Inter, sans-serif',
          fontSize: "1.8rem",
          fontWeight: 700,
          letterSpacing: "-0.055em",
          display: compactAtMedium
            ? { xs: "inline", sm: "none", md: "inline" }
            : "inline",
        }}
      >
        dalgo
      </Typography>
    </Box>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <Dialog
      open
      onClose={onClose}
      aria-label={title}
      aria-labelledby={titleId}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            width: "calc(100% - 32px)",
            maxWidth: 520,
            m: 2,
            maxHeight: "calc(100dvh - 32px)",
            border: "1px solid #505050",
            borderRadius: "7px",
            backgroundColor: "#161616",
            backgroundImage: "none",
          },
        },
        backdrop: {
          sx: { backgroundColor: "#000000b8", backdropFilter: "blur(3px)" },
        },
      }}
    >
      <DialogTitle
        id={`${titleId}-header`}
        component="div"
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1.5,
          p: 3,
          pb: 2,
        }}
      >
        <Typography
          id={titleId}
          component="span"
          variant="overline"
          sx={{
            textTransform: "uppercase",
            fontFamily: '"JetBrains Mono", monospace',
            color: "text.secondary",
            fontSize: ".75rem",
            letterSpacing: ".075em",
          }}
        >
          <Box component="span" aria-hidden="true">
            DALGO /{" "}
          </Box>
          {title}
        </Typography>
        <IconButton aria-label="Close dialog" onClick={onClose} size="small">
          <X size={19} />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ px: 3, pb: 3, pt: 0 }}>{children}</DialogContent>
    </Dialog>
  );
}
/** Preserve known application routes without accepting arbitrary redirect input. */
export function oauthReturnUrl(
  location: Pick<Location, "origin" | "pathname">,
) {
  const path = location.pathname;
  const allowed =
    /^\/(?:match\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|friends|history|profile|leaderboard|privacy)?$/i.test(
      path,
    );
  return new URL(allowed ? path : "/", location.origin).href;
}
export function SignIn({ onClose }: { onClose: () => void }) {
  const { client } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function login(provider: "google" | "github") {
    if (!client) return;
    setBusy(true);
    setError("");
    try {
      const r = await client.auth.signInWithOAuth({
        provider,
        options: { redirectTo: oauthReturnUrl(window.location) },
      });
      if (r.error) throw r.error;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Sign in" onClose={onClose}>
      <Typography
        component="h2"
        variant="h4"
        sx={{ fontSize: "1.875rem", mb: 2 }}
      >
        Sign in to Dalgo
      </Typography>
      <Typography color="text.secondary">
        Continue with Google or GitHub, then choose your unique username.
      </Typography>
      {client ? (
        <Stack spacing={1.25} sx={{ mt: 3 }}>
          <Button
            variant="outlined"
            disabled={busy}
            onClick={() => login("google")}
            endIcon={<ArrowUpRight size={17} />}
            sx={{
              minHeight: 48,
              justifyContent: "flex-start",
              "& .MuiButton-endIcon": { ml: "auto" },
            }}
          >
            <Typography
              component="span"
              aria-hidden="true"
              sx={{ mr: 1.5, fontSize: "1.2rem", fontWeight: 700 }}
            >
              G
            </Typography>
            Continue with Google
          </Button>
          <Button
            variant="outlined"
            disabled={busy}
            onClick={() => login("github")}
            startIcon={<Github size={19} />}
            endIcon={<ArrowUpRight size={17} />}
            sx={{
              minHeight: 48,
              justifyContent: "flex-start",
              "& .MuiButton-endIcon": { ml: "auto" },
            }}
          >
            Continue with GitHub
          </Button>
        </Stack>
      ) : (
        <Alert severity="info" icon={false} sx={{ mt: 3 }}>
          <Typography
            component="strong"
            variant="body2"
            sx={{ fontWeight: 600 }}
          >
            Sign-in is temporarily unavailable.
          </Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            Please try again later.
          </Typography>
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mt: 3 }}
      >
        Each arena starts at 1,200. Human and bot ratings are separate.{" "}
        <Box
          component={Link}
          to="/privacy"
          onClick={onClose}
          sx={{ color: "text.primary", textUnderlineOffset: "3px" }}
        >
          Privacy and data requests
        </Box>
        .
      </Typography>
    </Modal>
  );
}
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Stack
      direction="row"
      spacing={2.25}
      sx={{
        alignItems: "flex-start",
        py: 3.6,
      }}
    >
      <Avatar
        variant="square"
        aria-hidden="true"
        sx={{
          width: 24,
          height: 26,
          backgroundColor: "transparent",
          color: "#949494",
          fontSize: "1.75rem",
        }}
      >
        —
      </Avatar>
      <Box>
        <Typography
          component="h3"
          variant="body2"
          sx={{
            fontWeight: 500,
            mb: 0.75,
          }}
        >
          {title}
        </Typography>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ maxWidth: 440, lineHeight: 1.7 }}
        >
          {children}
        </Typography>
      </Box>
    </Stack>
  );
}
export function Footer() {
  return (
    <Stack
      component="footer"
      direction={{ xs: "column", sm: "row" }}
      spacing={1.2}
      sx={{
        justifyContent: "space-between",
        py: 2.75,
        mt: 3.5,
        borderTop: 1,
        borderColor: "divider",
        color: "text.secondary",
        fontFamily: '"JetBrains Mono", monospace',
        fontSize: ".75rem",
        letterSpacing: ".03em",
      }}
    >
      <Box component="span">DALGO · DSA 1V1</Box>
      <Stack
        component="span"
        direction="row"
        useFlexGap
        spacing={1.5}
        sx={{ flexWrap: "wrap" }}
      >
        <Box component="span">Python · C++ · Java · JavaScript</Box>
        <Box
          component={Link}
          to="/privacy"
          sx={{ color: "inherit", textUnderlineOffset: "3px" }}
        >
          Privacy & contact
        </Box>
        <Box
          component="a"
          href="mailto:aryaguptaa.vns@gmail.com"
          sx={{ color: "inherit", textUnderlineOffset: "3px" }}
        >
          Support
        </Box>
      </Stack>
    </Stack>
  );
}
