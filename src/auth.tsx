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
import type { Admission, Config, FriendIdentity } from "../shared/types";
const AuthContext = createContext<{
  user: User | null;
  config: Config;
  loading: boolean;
  client: SupabaseClient | null;
  profile: FriendIdentity | null;
  profileLoading: boolean;
  refreshProfile: () => void;
  refreshAdmission: () => void;
}>({
  user: null,
  config: fallbackConfig,
  loading: true,
  client: null,
  profile: null,
  profileLoading: false,
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
  const [profileVersion, setProfileVersion] = useState(0);
  const [eligibilityVersion, setEligibilityVersion] = useState(0);
  useEffect(() => {
    let dispose = () => {};
    let stopped = false;
    (async () => {
      let config;
      try {
        config = await api<Config>("/config");
      } catch {
        config = fallbackConfig;
      }
      const client =
        config.supabaseUrl && config.supabaseKey
          ? createClient(config.supabaseUrl, config.supabaseKey)
          : null;
      if (stopped) return;
      if (client) {
        setTokenGetter(async () => {
          const { data } = await client.auth.getSession();
          return data.session?.access_token ?? null;
        });
        const { data } = await client.auth.getSession();
        if (stopped) return;
        setState({
          config,
          client,
          user: data.session?.user ?? null,
          loading: false,
        });
        const { data: sub } = client.auth.onAuthStateChange((_e, session) =>
          setState((s) => ({ ...s, user: session?.user ?? null })),
        );
        dispose = () => sub.subscription.unsubscribe();
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
      return;
    }
    setProfileLoading(true);
    api<FriendIdentity>("/profile")
      .then((value) => {
        if (!stopped)
          setProfile(
            value && typeof value.usernameConfigured === "boolean"
              ? value
              : null,
          );
      })
      .catch(() => {
        if (!stopped) setProfile(null);
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
            : "Live staging matches are limited to invited testers."),
      }
    : state.config;
  return (
    <AuthContext.Provider
      value={{
        ...state,
        config,
        profile,
        profileLoading,
        refreshProfile: () => setProfileVersion((value) => value + 1),
        refreshAdmission: () =>
          setEligibilityVersion((value) => value + 1),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  return useContext(AuthContext);
}
