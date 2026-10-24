// Shared by the jobs. The ESPN code lives in supabase/functions/_shared/espn.mts, so the
// update-scores Edge Function parses ESPN exactly the same way.

export { nbaDate } from "../../supabase/functions/_shared/espn.mts";

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}
