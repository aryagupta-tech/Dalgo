import { publicPageForPath } from "../shared/seo";
export { publicPages, publicPageForPath } from "../shared/seo";
export type { PublicPagePath } from "../shared/seo";

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
