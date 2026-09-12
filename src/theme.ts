import { createTheme } from "@mui/material/styles";
import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff2";
import inter500 from "@fontsource/inter/files/inter-latin-500-normal.woff2";
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff2";
import inter700 from "@fontsource/inter/files/inter-latin-700-normal.woff2";
import space400 from "@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2";
import space500 from "@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff2";
import space600 from "@fontsource/space-grotesk/files/space-grotesk-latin-600-normal.woff2";
import space700 from "@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2";
import mono400 from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2";

const headingFont = '"Space Grotesk", Inter, system-ui, sans-serif';
const monoFont = '"JetBrains Mono", monospace';
const fonts = [
  ["Inter", 400, inter400],
  ["Inter", 500, inter500],
  ["Inter", 600, inter600],
  ["Inter", 700, inter700],
  ["Space Grotesk", 400, space400],
  ["Space Grotesk", 500, space500],
  ["Space Grotesk", 600, space600],
  ["Space Grotesk", 700, space700],
  ["JetBrains Mono", 400, mono400],
] as const;

export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#eeeeee", contrastText: "#080808" },
    secondary: { main: "#b3b3b3", contrastText: "#080808" },
    background: { default: "#080808", paper: "#111111" },
    text: { primary: "#f2f2f2", secondary: "#b3b3b3", disabled: "#949494" },
    divider: "#303030",
    success: { main: "#8dd3b5" },
    error: { main: "#f3a5a5" },
    warning: { main: "#dec48d" },
    info: { main: "#d6d6d6" },
    action: { hover: "#ffffff0a", selected: "#ffffff12", focus: "#ffffff1a" },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: "Inter, system-ui, sans-serif",
    h1: {
      fontFamily: headingFont,
      fontSize: "2.8rem",
      fontWeight: 500,
      lineHeight: 1.15,
      letterSpacing: "-0.05em",
    },
    h2: {
      fontFamily: headingFont,
      fontSize: "1.45rem",
      fontWeight: 500,
      lineHeight: 1.3,
      letterSpacing: "-0.025em",
    },
    h3: {
      fontFamily: headingFont,
      fontSize: "1.1rem",
      fontWeight: 500,
      lineHeight: 1.4,
    },
    h4: { fontFamily: headingFont, fontWeight: 500 },
    h5: { fontFamily: headingFont, fontWeight: 500 },
    h6: { fontFamily: headingFont, fontWeight: 500 },
    body1: { fontSize: "0.9375rem", lineHeight: 1.7 },
    body2: { fontSize: "0.8125rem", lineHeight: 1.6 },
    button: { textTransform: "none", fontWeight: 600, letterSpacing: 0 },
    overline: {
      fontFamily: monoFont,
      fontSize: "0.625rem",
      letterSpacing: "0.1em",
      lineHeight: 1.8,
    },
    caption: { fontSize: "0.75rem", lineHeight: 1.5 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: () => [
        ...fonts.map(([fontFamily, fontWeight, url]) => ({
          "@font-face": {
            fontFamily,
            fontWeight,
            fontStyle: "normal",
            fontDisplay: "swap",
            src: `url(${url}) format("woff2")`,
          },
        })),
        {
          html: {
            colorScheme: "dark",
            fontSynthesis: "none",
            WebkitFontSmoothing: "antialiased",
          },
          body: { margin: 0 },
          "#root": { minHeight: "100dvh" },
          a: { color: "inherit", textDecoration: "none" },
          svg: { flexShrink: 0 },
          "code, pre": { fontFamily: monoFont },
          "::selection": { background: "#484848" },
          ":focus-visible": { outline: "2px solid #eeeeee", outlineOffset: 3 },
          "@media (prefers-reduced-motion: reduce)": {
            "*, *::before, *::after": {
              animationDuration: "0.01ms !important",
              animationIterationCount: "1 !important",
              transitionDuration: "0.01ms !important",
              scrollBehavior: "auto !important",
            },
          },
        },
      ],
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: "none" } },
    },
    MuiButtonBase: {
      defaultProps: { disableRipple: true },
      styleOverrides: {
        root: {
          "&.Mui-focusVisible": {
            outline: "2px solid #eeeeee",
            outlineOffset: 3,
          },
        },
      },
    },
    MuiButton: {
      defaultProps: {
        variant: "outlined",
        color: "primary",
        disableElevation: true,
      },
      styleOverrides: {
        root: { minHeight: 40, paddingInline: 16, whiteSpace: "nowrap" },
        outlined: {
          borderColor: "#3b3b3b",
          "&:hover": { borderColor: "#777777", backgroundColor: "#ffffff0a" },
        },
        contained: {
          "&.MuiButton-colorPrimary:hover": { backgroundColor: "#d6d6d6" },
        },
        text: { color: "#b3b3b3", "&:hover": { color: "#f2f2f2" } },
        sizeSmall: { minHeight: 32, paddingInline: 10, fontSize: "0.75rem" },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { color: "#b3b3b3", "&:hover": { color: "#f2f2f2" } },
      },
    },
    MuiChip: {
      defaultProps: { size: "small", variant: "outlined" },
      styleOverrides: {
        root: {
          borderRadius: 5,
          borderColor: "#3b3b3b",
          fontFamily: monoFont,
          fontSize: "0.625rem",
          height: 22,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: "none",
          minHeight: 40,
          fontSize: "0.8125rem",
          minWidth: 72,
        },
      },
    },
    MuiTabs: { styleOverrides: { root: { minHeight: 40 } } },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          color: "#b3b3b3",
          borderColor: "#303030",
          "&.Mui-selected": { color: "#f2f2f2", backgroundColor: "#292929" },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: "#303030" },
        head: {
          color: "#949494",
          fontSize: "0.6875rem",
          letterSpacing: "0.06em",
          fontFamily: monoFont,
        },
      },
    },
    MuiNativeSelect: {
      styleOverrides: {
        select: {
          fontSize: "0.8125rem",
          "& option": { backgroundColor: "#191919", color: "#f2f2f2" },
        },
      },
    },
    MuiDialog: {
      defaultProps: { maxWidth: "sm", fullWidth: true },
      styleOverrides: {
        paper: {
          border: "1px solid #303030",
          backgroundImage: "none",
          maxHeight: "calc(100dvh - 32px)",
          margin: 16,
        },
      },
    },
    MuiDialogContent: {
      styleOverrides: {
        root: { padding: 24, "&:first-of-type": { paddingTop: 8 } },
      },
    },
    MuiAlert: {
      defaultProps: { variant: "outlined" },
      styleOverrides: {
        root: { fontSize: "0.8125rem", backgroundColor: "#111111" },
        message: { minWidth: 0, overflowWrap: "anywhere" },
      },
    },
    MuiLinearProgress: {
      styleOverrides: { root: { borderRadius: 2, backgroundColor: "#303030" } },
    },
  },
});
