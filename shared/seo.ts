/** Metadata shared by server responses and in-app navigation. */
export const publicPages = {
  "/": {
    title: "dalgo — Live DSA Coding Matches",
    description:
      "Compete in live data structures and algorithms (DSA) matches. Solve coding problems in Python, C++, Java, or JavaScript and track your rating on dalgo.",
  },
  "/leaderboard": {
    title: "DSA Coding Leaderboard — dalgo",
    description:
      "Explore dalgo's live DSA coding leaderboard and compare arena ratings for data structures and algorithms matches.",
  },
  "/how-it-works": {
    title: "How Live DSA Matches Work — dalgo",
    description:
      "Learn how dalgo's 1v1 DSA coding matches work: choose an arena, face a player or bot, solve the same problem, and track your rating.",
  },
  "/privacy": {
    title: "Privacy and Contact — dalgo",
    description:
      "Read how dalgo handles accounts, match data, code submissions, and profile information, and contact the operator.",
  },
} as const;

export type PublicPagePath = keyof typeof publicPages;

export function publicPageForPath(pathname: string) {
  const path = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  return Object.prototype.hasOwnProperty.call(publicPages, path)
    ? { path: path as PublicPagePath, ...publicPages[path as PublicPagePath] }
    : null;
}
