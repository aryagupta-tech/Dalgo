import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { Box, Button, Stack, Typography } from "@mui/material";
import { Footer } from "./Chrome";

const steps = [
  {
    title: "Choose your arena",
    body: "Easy, Medium, and Hard matches last 10, 20, and 30 minutes. Each arena has its own rating, so you can choose the level you want to play.",
  },
  {
    title: "Face another player or a bot",
    body: "Dalgo searches for another player first. If no suitable player is available after 15 seconds, the match is clearly labelled as a bot match. You can also challenge a friend by username.",
  },
  {
    title: "Solve the same problem",
    body: "Both players receive the same coding problem and share a match clock. Write your solution in Python, C++, Java, or JavaScript. The first submission to pass every hidden test wins.",
  },
  {
    title: "Review the result",
    body: "The result shows the verdict and rating change. Human and bot ratings are separate, and you can inspect submitted code after a finished match when it is available.",
  },
];

export function HowItWorksPage() {
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
        dalgo / HOW IT WORKS
      </Typography>
      <Box component="header" sx={{ my: { xs: 3, lg: 4 }, maxWidth: 740 }}>
        <Typography component="h1" variant="h2" sx={{ mb: 1.5 }}>
          How live DSA matches work
        </Typography>
        <Typography color="text.secondary" sx={{ lineHeight: 1.7 }}>
          Practice data structures and algorithms by solving a timed problem
          against another player or a simulated bot. Each match has a clear
          result and rating outcome.
        </Typography>
      </Box>
      <Stack component="ol" sx={{ listStyle: "none", p: 0, m: 0 }}>
        {steps.map((step, index) => (
          <Box
            component="li"
            key={step.title}
            sx={{
              borderTop: 1,
              borderColor: "divider",
              py: { xs: 3, sm: 3.5 },
            }}
          >
            <Typography
              component="span"
              color="text.secondary"
              sx={{
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: ".75rem",
              }}
            >
              {String(index + 1).padStart(2, "0")}
            </Typography>
            <Typography component="h2" variant="h5" sx={{ mt: 1, mb: 1 }}>
              {step.title}
            </Typography>
            <Typography
              color="text.secondary"
              sx={{ lineHeight: 1.75, maxWidth: 720 }}
            >
              {step.body}
            </Typography>
          </Box>
        ))}
      </Stack>
      <Box
        component="section"
        sx={{ borderTop: 1, borderColor: "divider", py: { xs: 3, sm: 3.5 } }}
      >
        <Typography component="h2" variant="h5" sx={{ mb: 1 }}>
          Ratings start at 800
        </Typography>
        <Typography
          color="text.secondary"
          sx={{ lineHeight: 1.75, maxWidth: 720 }}
        >
          Easy, Medium, and Hard each have separate human and bot ratings. A win
          or loss changes the relevant rating; a draw leaves it unchanged. You
          can compare human ratings on the leaderboard.
        </Typography>
      </Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ mt: 2, alignItems: { sm: "center" } }}
      >
        <Button
          component={Link}
          to="/"
          variant="contained"
          endIcon={<ArrowRight size={17} />}
        >
          Choose an arena
        </Button>
        <Button
          component={Link}
          to="/leaderboard"
          variant="text"
          color="inherit"
        >
          View leaderboard
        </Button>
      </Stack>
      <Footer />
    </Box>
  );
}
