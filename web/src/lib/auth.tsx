import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { disablePush } from "./push";
import { rows, supabase } from "./supabase";
import type { Profile } from "./types";

interface Auth {
  session: Session | null;
  /** True until the stored session has been read. */
  loading: boolean;
  profile: Profile | null;
  profileLoading: boolean;
}

const AuthContext = createContext<Auth>({ session: null, loading: true, profile: null, profileLoading: false });

export function useAuth() {
  return useContext(AuthContext);
}

/** Signs out, first stopping this device's notifications so the next person here doesn't get yours. */
export async function signOut() {
  await disablePush().catch((err) => console.warn("Couldn't remove this device's notifications", err));
  await supabase.auth.signOut();
}

/** The signed-in user's id. Only call below the auth gate. */
export function useUserId(): string {
  const { session } = useAuth();
  if (!session) throw new Error("useUserId called without a session");
  return session.user.id;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === "SIGNED_OUT") queryClient.clear();
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  const userId = session?.user.id;
  const profile = useQuery({
    queryKey: ["profile", userId],
    enabled: Boolean(userId),
    queryFn: () =>
      rows<Profile | null>(supabase.from("profiles").select("id, username").eq("id", userId!).maybeSingle()),
  });

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        profile: profile.data ?? null,
        profileLoading: Boolean(userId) && profile.isPending,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
