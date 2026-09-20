import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import { api, fallbackConfig, setTokenGetter } from "./api";
import {
  cacheAuthConfig,
  createSessionCoordinator,
  readCachedAuthConfig,
  retry,
} from "./auth-session";
import type { Admission, Config, FriendIdentity } from "../shared/types";
const AuthContext = createContext<{
  user: User | null;
  config: Config;
  loading: boolean;
  client: SupabaseClient | null;
  profile: FriendIdentity | null;
  profileLoading: boolean;
  profileError: string;
  refreshProfile: () => void;
  refreshAdmission: () => void;
}>({
  user: null,
  config: fallbackConfig,
  loading: true,
  client: null,
  profile: null,
  profileLoading: false,
  profileError: "",
  refreshProfile: () => {},
  refreshAdmission: () => {},
});
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({
    user: null as User | null,
    config: fallbackConfig,
    loading: true,
    client: null as SupabaseClient | null,
  });
  const [profile, setProfile] = useState<FriendIdentity | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileVersion, setProfileVersion] = useState(0);
  const [eligibilityVersion, setEligibilityVersion] = useState(0);
  useEffect(() => {
    let dispose = () => {};
    let stopped = false;
    (async () => {
      let config;
      try {
        config = await retry(() => api<Config>("/config"));
        cacheAuthConfig(window.localStorage, config);
      } catch {
        config = {
          ...fallbackConfig,
          ...readCachedAuthConfig(window.localStorage),
        };
      }
      if (stopped) return;
      const client =
        config.supabaseUrl && config.supabaseKey
          ? createClient(config.supabaseUrl, config.supabaseKey, {
              auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
                storage: window.localStorage,
              },
            })
          : null;
      if (client) {
        const sessions = createSessionCoordinator(client);
        setTokenGetter(sessions.accessToken);
        const { data: sub } = client.auth.onAuthStateChange((_e, session) => {
          sessions.update(session);
          setState((s) => ({ ...s, user: session?.user ?? null }));
        });
        const recover = async () => {
          try {
            const session = await sessions.restore();
            if (!stopped)
              setState({
                config,
                client,
                user: session?.user ?? null,
                loading: false,
              });
          } catch {
            if (!stopped)
              setState((current) => ({
                ...current,
                config,
                client,
                loading: false,
              }));
          }
        };
        const resume = () => {
          if (document.visibilityState === "visible") void recover();
        };
        window.addEventListener("focus", resume);
        document.addEventListener("visibilitychange", resume);
        dispose = () => {
          sub.subscription.unsubscribe();
          window.removeEventListener("focus", resume);
          document.removeEventListener("visibilitychange", resume);
          void client.auth.dispose();
        };
        await recover();
      } else setState({ config, client: null, user: null, loading: false });
    })();
    return () => {
      stopped = true;
      dispose();
    };
  }, []);
  const [eligibility, setEligibility] = useState<{
    userId: string;
    value: Admission;
  } | null>(null);
  useEffect(() => {
    let stopped = false;
    if (!state.user) {
      setProfile(null);
      setProfileLoading(false);
      setProfileError("");
      return;
    }
    setProfile(null);
    setProfileLoading(true);
    setProfileError("");
    api<FriendIdentity>("/profile")
      .then((value) => {
        if (stopped) return;
        if (value && typeof value.usernameConfigured === "boolean")
          setProfile(value);
        else {
          setProfile(null);
          setProfileError("Your profile could not be loaded.");
        }
      })
      .catch((reason) => {
        if (!stopped) {
          setProfile(null);
          setProfileError(
            reason instanceof Error
              ? reason.message
              : "Your profile could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!stopped) setProfileLoading(false);
      });
    return () => {
      stopped = true;
    };
  }, [state.user?.id, profileVersion]);
  useEffect(() => {
    let stopped = false;
    setEligibility(null);
    if (state.user && state.client && state.config.admissionMode) {
      const userId = state.user.id;
      api<Admission>("/admission")
        .then((value) => {
          if (!stopped) setEligibility({ userId, value });
        })
        .catch(() => {
          if (!stopped)
            setEligibility({
              userId,
              value: {
                mode: "disabled",
                canJoin: false,
                reason:
                  "Match availability could not be checked. Reload to retry.",
              },
            });
        });
    }
    return () => {
      stopped = true;
    };
  }, [
    state.user?.id,
    state.client,
    state.config.admissionMode,
    eligibilityVersion,
  ]);
  const admission =
    state.user && eligibility?.userId === state.user.id
      ? eligibility.value
      : null;
  const needsEligibility =
    !!state.config.admissionMode &&
    (!!state.user || state.config.admissionMode === "staging");
  const config = needsEligibility
    ? {
        ...state.config,
        playEnabled: state.config.playEnabled && !!admission?.canJoin,
        reason:
          admission?.reason ||
          (state.user
            ? "Checking match availability…"
            : "Live matches are limited to invited players."),
      }
    : state.config;
  return (
    <AuthContext.Provider
      value={{
        ...state,
        config,
        profile,
        profileLoading,
        profileError,
        refreshProfile: () => setProfileVersion((value) => value + 1),
        refreshAdmission: () => setEligibilityVersion((value) => value + 1),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  return useContext(AuthContext);
}
