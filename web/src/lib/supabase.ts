import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

// Placeholders keep module init from throwing; main.tsx shows a setup message instead.
export const supabase = createClient(url || "http://localhost", anonKey || "missing");

/** Calls a Postgres function and surfaces its RAISE EXCEPTION text as the error message. */
export async function rpc<T = void>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Unwraps a PostgREST query result. */
export async function rows<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as T;
}
