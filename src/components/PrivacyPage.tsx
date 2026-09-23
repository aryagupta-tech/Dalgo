import { ArrowLeft, Mail } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Box,
  Button,
  Link as MuiLink,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { Footer } from "./Chrome";

const supportEmail = "aryaguptaa.vns@gmail.com";

function PrivacySection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Box component="section">
      <Typography component="h2" variant="h5" sx={{ mb: 1.25 }}>
        {title}
      </Typography>
      <Stack spacing={1.25} color="text.secondary" sx={{ lineHeight: 1.75 }}>
        {children}
      </Stack>
    </Box>
  );
}

export function PrivacyPage() {
  return (
    <Box
      component="main"
      sx={{
        maxWidth: 980,
        mx: "auto",
        px: { xs: 2.25, sm: 3.5, lg: 5.75 },
        pt: { xs: 2.5, sm: 3, lg: 3.75 },
      }}
    >
      <Typography
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
        / PRIVACY & CONTACT
      </Typography>
      <Stack
        component="header"
        spacing={1.5}
        sx={{ my: { xs: 3, lg: 4 }, maxWidth: 760 }}
      >
        <Typography component="h1" variant="h2">
          Privacy and data requests
        </Typography>
        <Typography color="text.secondary" sx={{ lineHeight: 1.7 }}>
          This notice explains how dalgo uses and stores data, and how to
          request access or deletion.
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ fontFamily: '"JetBrains Mono", monospace' }}
        >
          LAST UPDATED 20 SEPTEMBER 2026
        </Typography>
      </Stack>

      <Paper
        variant="outlined"
        square
        sx={{
          backgroundColor: "#0d0d0d",
          borderLeft: 0,
          borderRight: 0,
          px: { xs: 0, sm: 3 },
          py: { xs: 3, sm: 4 },
        }}
      >
        <Stack spacing={{ xs: 4, sm: 5 }}>
          <PrivacySection title="Operator and contact">
            <Typography>
              Dalgo is operated by Arya Gupta. For support, privacy questions,
              or account and data requests, email{" "}
              <MuiLink href={`mailto:${supportEmail}`} color="inherit">
                {supportEmail}
              </MuiLink>
              .
            </Typography>
            <Button
              href={`mailto:${supportEmail}?subject=dalgo%20support%20request`}
              variant="outlined"
              startIcon={<Mail size={17} />}
              sx={{ alignSelf: "flex-start" }}
            >
              Email dalgo support
            </Button>
          </PrivacySection>

          <PrivacySection title="Information dalgo stores">
            <Typography>
              Google sign-in provides an account identifier and may provide a
              display name, email address, and avatar. Dalgo also stores your
              chosen username, six arena ratings, friend requests, accepted
              friendships, match challenges, match participation, verdicts,
              rating changes, and submission records.
            </Typography>
            <Typography>
              Usernames, display names, profile pictures, ratings, and match
              statistics may appear to other players or on leaderboards.
              Uploaded profile pictures are stored in a public Supabase bucket
              so they can be displayed throughout dalgo. For matches started
              after public code reviews launch, anyone can view both players’
              scored Submit code after the result is saved. Sample Run code,
              hidden tests, and live code are never shown to opponents.
            </Typography>
          </PrivacySection>

          <PrivacySection title="Code execution and service providers">
            <Typography>
              Live Run and Submit actions send source code and test inputs from
              Cloudflare to dalgo's private Codebox service on Google Cloud
              (production) or AWS (staging). Expected hidden answers and service
              credentials are excluded from execution payloads.
            </Typography>
            <Typography>
              Dalgo uses Supabase for authentication and stored application
              data, Cloudflare for the website and live match coordination, and
              Google Cloud and AWS for private code execution. These services
              process data only as needed to provide dalgo.
            </Typography>
          </PrivacySection>

          <PrivacySection title="Retention">
            <Typography>
              Submitted source is retained in dalgo's database and live match
              storage for up to 30 days. Public scored Submit code is available
              during that period for eligible completed matches. Codebox source
              and output records
              are removed after 24 hours. Compact verdicts, match history, and
              rating changes may be retained after source removal.
            </Typography>
            <Typography>
              Operational logs may contain error details, timing, capacity, and
              match identifiers. They are configured not to record submitted
              source code.
            </Typography>
          </PrivacySection>

          <PrivacySection title="Browser storage">
            <Typography>
              Live editor drafts and sign-in sessions use browser storage. You
              can remove these through your browser's site-data controls.
            </Typography>
          </PrivacySection>

          <PrivacySection title="Access and deletion requests">
            <Typography>
              Email the support address from the email connected to your dalgo
              account and include your username. Dalgo may ask for additional
              verification before disclosing or deleting account data.
            </Typography>
            <Typography>
              A completed deletion removes authentication access, profile data,
              ratings, friend relationships, challenges, submissions, and linked
              records required to remove the account. Shared match history may
              be deleted or anonymized so other players' records remain
              accurate.
            </Typography>
          </PrivacySection>

          <PrivacySection title="Changes to this notice">
            <Typography>
              This page will be updated when dalgo changes its providers,
              retention periods, public features, or contact details. The date
              above identifies the current version.
            </Typography>
          </PrivacySection>
        </Stack>
      </Paper>

      <Button
        component={Link}
        to="/"
        variant="text"
        color="inherit"
        startIcon={<ArrowLeft size={16} />}
        sx={{ mt: 3 }}
      >
        Back to the lobby
      </Button>
      <Footer />
    </Box>
  );
}
