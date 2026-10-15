// Shared by the jobs.

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

// The NBA's calendar day, so a 1am-ET run doesn't file results under the wrong date.
export function nbaDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
}

/** GET a JSON endpoint (ESPN), retrying with backoff before giving up. */
export async function fetchJson(url: string, attempts = 3): Promise<unknown> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= attempts) throw new Error(`ESPN fetch failed after ${attempts} tries: ${String(err)}`);
      await new Promise((r) => setTimeout(r, 2_000 * i));
    }
  }
}
