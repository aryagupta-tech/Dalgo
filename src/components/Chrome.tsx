import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
import { createGoogleNonce, loadGoogleIdentity } from "../google-identity";
import type { SupabaseClient } from "@supabase/supabase-js";
export function Brand({
  compactAtMedium = false,
}: {
  compactAtMedium?: boolean;
}) {
  return (
    <Box
      component={Link}
      to="/"
      aria-label="dalgo home"
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
          <Box
            component="span"
            aria-hidden="true"
            sx={{ textTransform: "none" }}
          >
            dalgo
          </Box>
          {" / "}
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
  const allowedOrigins = new Set([
    "https://dalgo.site",
    "https://staging.dalgo.site",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ]);
  const path = location.pathname;
  const allowed =
    /^\/(?:match\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|friends|history|profile|leaderboard|privacy)?$/i.test(
      path,
    );
  const origin = allowedOrigins.has(location.origin)
    ? location.origin
    : "https://dalgo.site";
  return new URL(allowed ? path : "/", origin).href;
}
function GoogleSignInButton({
  client,
  clientId,
  busy,
  onBusy,
  onSuccess,
  onError,
}: {
  client: SupabaseClient;
  clientId: string;
  busy: boolean;
  onBusy: () => void;
  onSuccess: () => void;
  onError: (message: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onBusy, onSuccess, onError });
  const [loading, setLoading] = useState(true);
  callbacks.current = { onBusy, onSuccess, onError };

  useEffect(() => {
    const parent = container.current;
    if (!parent) return;
    let active = true;
    let observer: ResizeObserver | null = null;
    let renderedWidth = 0;

    void (async () => {
      try {
        const [{ nonce, hashedNonce }, google] = await Promise.all([
          createGoogleNonce(),
          loadGoogleIdentity(),
        ]);
        if (!active) return;
        google.initialize({
          client_id: clientId,
          nonce: hashedNonce,
          use_fedcm_for_prompt: true,
          callback: (response) => {
            if (!response.credential || !active) {
              if (active)
                callbacks.current.onError(
                  "Google sign-in did not return an identity.",
                );
              return;
            }
            callbacks.current.onBusy();
            void client.auth
              .signInWithIdToken({
                provider: "google",
                token: response.credential,
                nonce,
              })
              .then(({ error }) => {
                if (error) throw error;
                if (active) callbacks.current.onSuccess();
              })
              .catch((reason: unknown) => {
                if (active)
                  callbacks.current.onError((reason as Error).message);
              });
          },
        });

        const render = () => {
          if (!active || !parent.isConnected) return;
          const width = Math.max(
            200,
            Math.min(400, Math.floor(parent.getBoundingClientRect().width)),
          );
          if (width === renderedWidth) return;
          renderedWidth = width;
          parent.replaceChildren();
          google.renderButton(parent, {
            type: "standard",
            theme: "filled_black",
            size: "large",
            text: "continue_with",
            shape: "rectangular",
            logo_alignment: "left",
            width,
          });
        };
        render();
        observer = new ResizeObserver(render);
        observer.observe(parent);
        setLoading(false);
      } catch (reason) {
        if (active) {
          setLoading(false);
          callbacks.current.onError((reason as Error).message);
        }
      }
    })();

    return () => {
      active = false;
      observer?.disconnect();
    };
  }, [client, clientId]);

  return (
    <Box
      ref={container}
      data-testid="google-signin"
      aria-label="Continue with Google"
      aria-busy={loading || busy}
      sx={{
        width: "100%",
        minHeight: 44,
        opacity: busy ? 0.55 : 1,
        pointerEvents: busy ? "none" : "auto",
        "& > div": { mx: "auto" },
      }}
    />
  );
}

export function SignIn({ onClose }: { onClose: () => void }) {
  const { client, config } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loginWithGithub() {
    if (!client) return;
    setBusy(true);
    setError("");
    try {
      const r = await client.auth.signInWithOAuth({
        provider: "github",
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
        sx={{ fontSize: "1.875rem", mb: 1 }}
      >
        Sign in to dalgo
      </Typography>
      {client ? (
        <Stack spacing={1.25} sx={{ mt: 1 }}>
          {config.googleClientId ? (
            <GoogleSignInButton
              client={client}
              clientId={config.googleClientId}
              busy={busy}
              onBusy={() => {
                setBusy(true);
                setError("");
              }}
              onSuccess={onClose}
              onError={(message) => {
                setError(message);
                setBusy(false);
              }}
            />
          ) : (
            <Alert severity="warning" icon={false}>
              Google sign-in is temporarily unavailable.
            </Alert>
          )}
          <Button
            variant="outlined"
            disabled={busy}
            onClick={loginWithGithub}
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
  children?: ReactNode;
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
        {children && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ maxWidth: 440, lineHeight: 1.7 }}
          >
            {children}
          </Typography>
        )}
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
      <Box component="span">dalgo · DSA 1V1</Box>
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
