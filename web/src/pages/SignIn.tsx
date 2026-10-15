import { useState, type FormEvent } from "react";
import { Button, Card, Field, inputClass } from "../components/ui";
import { supabase } from "../lib/supabase";

/** Passwordless email sign-in. The link brings you back to the page you started on (e.g. an invite). */
export function SignIn({ intro }: { intro?: string }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.href },
    });
    // On success the browser is already leaving for Google.
    if (error) setError(error.message);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.href },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSentTo(email.trim());
  }

  return (
    <Card className="mx-auto max-w-md">
      {sentTo ? (
        <div className="space-y-3 text-sm">
          <h1 className="text-lg font-semibold">Check your email</h1>
          <p className="text-zinc-600">
            We sent a sign-in link to <strong>{sentTo}</strong>. Open it on this device to continue.
          </p>
          <Button variant="ghost" size="sm" onClick={() => setSentTo(null)}>
            Use a different email
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <h1 className="text-lg font-semibold">Sign in</h1>
            <p className="mt-1 text-sm text-zinc-600">
              {intro ?? "Draft NBA teams with friends and win on their regular-season wins."} No password needed.
            </p>
          </div>
          <Button variant="secondary" className="w-full" onClick={signInWithGoogle}>
            <GoogleLogo />
            Continue with Google
          </Button>
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <span className="h-px flex-1 bg-zinc-200" />
            or get a link by email
            <span className="h-px flex-1 bg-zinc-200" />
          </div>
          <Field label="Email">
            <input
              type="email"
              required
              autoComplete="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <Button type="submit" variant="secondary" busy={busy} className="w-full">
            Email me a sign-in link
          </Button>
        </form>
      )}
    </Card>
  );
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
