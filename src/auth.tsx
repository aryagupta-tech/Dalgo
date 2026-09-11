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
import type { Config } from "../shared/types";
const AuthContext = createContext<{
  user: User | null;
  config: Config;
  loading: boolean;
  client: SupabaseClient | null;
}>({ user: null, config: fallbackConfig, loading: true, client: null });
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({
    user: null as User | null,
    config: fallbackConfig,
    loading: true,
    client: null as SupabaseClient | null,
  });
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
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  return useContext(AuthContext);
}
