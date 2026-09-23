export interface GoogleCredentialResponse {
  credential?: string;
}

interface GoogleIdentityApi {
  initialize(config: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    nonce?: string;
    use_fedcm_for_prompt?: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type: "standard";
      theme: "filled_black";
      size: "large";
      text: "continue_with";
      shape: "rectangular";
      logo_alignment: "left";
      width: number;
    },
  ): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdentityApi } };
  }
}

let scriptPromise: Promise<GoogleIdentityApi> | null = null;

export function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  const loaded = window.google?.accounts?.id;
  if (loaded) return Promise.resolve(loaded);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]',
    );
    const script = existing ?? document.createElement("script");
    const finish = () => {
      const api = window.google?.accounts?.id;
      if (api) resolve(api);
      else {
        scriptPromise = null;
        reject(new Error("Google sign-in did not load. Please try again."));
      }
    };
    const fail = () => {
      scriptPromise = null;
      reject(
        new Error("Google sign-in could not be loaded. Please try again."),
      );
    };

    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });
    if (!existing) {
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  });
  return scriptPromise;
}

export async function createGoogleNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = btoa(String.fromCharCode(...bytes));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(nonce),
  );
  const hashedNonce = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return { nonce, hashedNonce };
}
