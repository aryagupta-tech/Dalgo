import { publicPageForPath } from "../shared/seo";

const homeApplicationSchema = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "dalgo",
  url: "https://dalgo.site/",
  description:
    "Live data structures and algorithms coding matches with ranked play.",
  applicationCategory: "EducationalApplication",
  operatingSystem: "Any",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
};

function setMeta(selector: string, attribute: string, value: string) {
  document.head.querySelector(selector)?.setAttribute(attribute, value);
}

/** Keep client-side navigation as accurate as a direct page load. */
export function updateDocumentMetadata(pathname: string) {
  const page = publicPageForPath(pathname);
  const isStaging = window.location.hostname === "staging.dalgo.site";
  const title = page?.title ?? "dalgo";
  const description = page?.description ?? "Live DSA coding matches on dalgo.";
  document.title = title;
  setMeta('meta[name="description"]', "content", description);
  setMeta('meta[property="og:title"]', "content", title);
  setMeta('meta[property="og:description"]', "content", description);

  const canonical = document.head.querySelector<HTMLLinkElement>(
    'link[rel="canonical"]',
  );
  const ogUrl = document.head.querySelector<HTMLMetaElement>(
    'meta[property="og:url"]',
  );
  if (page) {
    const url = `https://dalgo.site${page.path}`;
    if (canonical) canonical.href = url;
    else {
      const link = document.createElement("link");
      link.rel = "canonical";
      link.href = url;
      document.head.appendChild(link);
    }
    if (ogUrl) ogUrl.content = url;
    else {
      const meta = document.createElement("meta");
      meta.setAttribute("property", "og:url");
      meta.content = url;
      document.head.appendChild(meta);
    }
  } else {
    canonical?.remove();
    ogUrl?.remove();
  }

  let robots = document.head.querySelector<HTMLMetaElement>(
    'meta[name="robots"]',
  );
  if (isStaging || !page) {
    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.appendChild(robots);
    }
    robots.content = "noindex";
  } else robots?.remove();

  let schema = document.head.querySelector<HTMLScriptElement>(
    'script[type="application/ld+json"]',
  );
  if (page?.path === "/") {
    if (!schema) {
      schema = document.createElement("script");
      schema.type = "application/ld+json";
      schema.textContent = JSON.stringify(homeApplicationSchema);
      document.head.appendChild(schema);
    }
  } else schema?.remove();
}
