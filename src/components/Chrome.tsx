import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Github, X } from "lucide-react";
import { useAuth } from "../auth";
export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="Dalgo home">
      <svg width="29" height="29" viewBox="0 0 29 29" aria-hidden="true">
        <path
          d="m3 5 9 9.5L3 24M17 5l9 9.5L17 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
        />
      </svg>
      <span>dalgo</span>
    </Link>
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
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    const cancel = (e: Event) => {
      e.preventDefault();
      closeRef.current();
    };
    dialog.addEventListener("cancel", cancel);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className="modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <div className="modal-heading">
        <span className="overline">DALGO / {title.toUpperCase()}</span>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
/** Preserve known application routes without accepting arbitrary redirect input. */
export function oauthReturnUrl(
  location: Pick<Location, "origin" | "pathname">,
) {
  const path = location.pathname;
  const allowed =
    /^\/(?:match\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|demo\/(?:easy|medium|hard)|history|profile|leaderboard)?$/i.test(
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
      <h2>Your place at the table.</h2>
      <p>Keep your ratings and match history with a Dalgo account.</p>
      {client ? (
        <div className="auth-options">
          <button
            className="button"
            disabled={busy}
            onClick={() => login("google")}
          >
            <span className="google-mark">G</span>Continue with Google
            <ArrowUpRight size={17} />
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() => login("github")}
          >
            <Github size={19} />
            Continue with GitHub
            <ArrowUpRight size={17} />
          </button>
        </div>
      ) : (
        <div className="notice">
          <strong>Sign-in isn’t connected yet.</strong>
          <p>
            You can try the complete demo without an account. Real matches and
            saved ratings open after service verification.
          </p>
          <Link className="button primary" to="/demo/easy" onClick={onClose}>
            Try the demo
            <ArrowUpRight size={17} />
          </Link>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="fine-print">
        Each arena starts at 1,200. Human and bot ratings are separate.
      </p>
    </Modal>
  );
}
export function DemoNotice() {
  return (
    <div className="demo-notice">
      <span className="badge badge-demo">DEMO</span>
      <span>Demo: code is not executed and ratings are not saved.</span>
    </div>
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
    <div className="empty-state">
      <span className="empty-symbol" aria-hidden="true">
        —
      </span>
      <div>
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </div>
  );
}
export function Footer() {
  return (
    <footer className="page-footer">
      <span>
        DALGO <span className="footer-divider">/</span> DSA COMPETITION
      </span>
      <span>Free beta · v0.2</span>
    </footer>
  );
}
