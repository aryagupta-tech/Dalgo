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
import { fallbackConfig, setTokenGetter } from "./api";
import { useApiQuery } from "./use-api-query";
import {
  cacheAuthConfig,
  createSessionCoordinator,
  readCachedAuthConfig,
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
  const configuration = useApiQuery<Config>("/config", { public: true });
  const [cachedConfig] = useState(() => ({
    ...fallbackConfig,
    ...readCachedAuthConfig(window.localStorage),
  }));
  const baseConfig = configuration.data ?? cachedConfig;
  const { supabaseUrl, supabaseKey } = baseConfig;
  const waitingForConfig =
    !supabaseUrl && !supabaseKey && configuration.loading;
  const [state, setState] = useState({
    user: null as User | null,
    loading: true,
    client: null as SupabaseClient | null,
  });
  const [profileVersion, setProfileVersion] = useState(0);
  const [eligibilityVersion, setEligibilityVersion] = useState(0);
  useEffect(() => {
    if (configuration.data)
      cacheAuthConfig(window.localStorage, configuration.data);
  }, [configuration.data]);
  useEffect(() => {
    let dispose = () => {};
    let stopped = false;
    if (waitingForConfig) return;
    const client =
      supabaseUrl && supabaseKey
        ? createClient(supabaseUrl, supabaseKey, {
            auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: true,
              storage: window.localStorage,
            },
          })
        : null;
    (async () => {
      if (client) {
        const sessions = createSessionCoordinator(client);
        setTokenGetter(sessions.accessToken);
        const { data: sub } = client.auth.onAuthStateChange((_e, session) => {
          sessions.update(session);
          if (!stopped)
            setState((s) => ({ ...s, user: session?.user ?? null }));
        });
        const recover = async () => {
          try {
            const session = await sessions.restore();
            if (!stopped)
              setState({ client, user: session?.user ?? null, loading: false });
          } catch {
            if (!stopped)
              setState((current) => ({
                ...current,
                client,
                loading: false,
              }));
          }
        };
        const resume = () => {
          if (document.visibilityState === "visible") void recover();
        };
        window.addEventListener("focus", resume);
        window.addEventListener("online", resume);
        document.addEventListener("visibilitychange", resume);
        dispose = () => {
          sub.subscription.unsubscribe();
          window.removeEventListener("focus", resume);
          window.removeEventListener("online", resume);
          document.removeEventListener("visibilitychange", resume);
          void client.auth.dispose();
        };
        await recover();
      } else setState({ client: null, user: null, loading: false });
    })();
    return () => {
      stopped = true;
      dispose();
      setTokenGetter(async () => null);
    };
  }, [supabaseUrl, supabaseKey, waitingForConfig]);
  const ready = !!state.user && !!state.client && !state.loading;
  const profileQuery = useApiQuery<FriendIdentity>(ready ? "/profile" : null, {
    identity: state.user?.id,
    version: profileVersion,
  });
  const profile =
    profileQuery.data &&
    typeof profileQuery.data.usernameConfigured === "boolean"
      ? profileQuery.data
      : null;
  const admissionQuery = useApiQuery<Admission>(ready ? "/admission" : null, {
    identity: `${state.user?.id}:${baseConfig.admissionMode}:${baseConfig.playEnabled}`,
    version: eligibilityVersion,
    pollMs: 30_000,
  });
  const admission = admissionQuery.error ? null : admissionQuery.data;
  const needsEligibility =
    !!baseConfig.admissionMode &&
    (!!state.user || baseConfig.admissionMode === "staging");
  const config = needsEligibility
    ? {
        ...baseConfig,
        playEnabled: baseConfig.playEnabled && !!admission?.canJoin,
        reason:
          admission?.reason ||
          (state.user
            ? admissionQuery.error || "Checking match availability…"
            : "Live matches are limited to invited players."),
      }
    : baseConfig;
  return (
    <AuthContext.Provider
      value={{
        ...state,
        config,
        profile,
        profileLoading: profileQuery.loading,
        profileError:
          profileQuery.error ||
          (profileQuery.data && !profile
            ? "Your profile could not be loaded."
            : ""),
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
