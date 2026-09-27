/** Metadata for the small set of public, crawlable pages. */
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

/** Keep canonical URLs and social metadata aligned with the requested public page. */
export function addPageMetadata(
  response: Response,
  pathname: string,
): Response {
  const page = publicPageForPath(pathname);
  if (!page || !response.headers.get("Content-Type")?.includes("text/html"))
    return response;
  const canonical = `https://dalgo.site${page.path}`;
  const rewrite = new HTMLRewriter()
    .on("title", {
      element(element) {
        element.setInnerContent(page.title);
      },
    })
    .on('meta[name="description"]', {
      element(element) {
        element.setAttribute("content", page.description);
      },
    })
    .on('meta[property="og:title"]', {
      element(element) {
        element.setAttribute("content", page.title);
      },
    })
    .on('meta[property="og:description"]', {
      element(element) {
        element.setAttribute("content", page.description);
      },
    })
    .on('meta[property="og:url"]', {
      element(element) {
        element.setAttribute("content", canonical);
      },
    })
    .on('link[rel="canonical"]', {
      element(element) {
        element.setAttribute("href", canonical);
      },
    });
  if (page.path !== "/")
    rewrite.on('script[type="application/ld+json"]', {
      element(element) {
        element.remove();
      },
    });
  return rewrite.transform(response);
}
