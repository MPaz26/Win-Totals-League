import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge, Button, Card, ErrorMessage, Field, InlineEdit, inputClass, LeagueMark, PageSpinner, statusBadge, Toggle } from "../components/ui";
import { useAuth, useUserId } from "../lib/auth";
import { PICK_TIMER_OPTIONS } from "../lib/draft";
import { useNotice } from "../lib/notice";
import { useMyLeagues, useMyStandings, useWeeklyRecap } from "../lib/queries";
import { rpc, supabase } from "../lib/supabase";
import type { OrderMode } from "../lib/types";
import { USERNAME } from "./ProfileSetup";

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function Home() {
  const userId = useUserId();
  const leagues = useMyLeagues();
  const scores = useMyStandings(userId);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
      <div>
        <h1 className="mb-4 text-2xl font-extrabold tracking-tight">Leagues</h1>
        {leagues.isPending ? (
          <PageSpinner />
        ) : leagues.error ? (
          <ErrorMessage error={leagues.error} />
        ) : leagues.data.length === 0 ? (
          <Card className="py-10 text-center">
            <div className="text-4xl" aria-hidden>🏀</div>
            <p className="mt-3 font-bold">No leagues yet</p>
            <p className="mt-1 text-sm text-mute">Create one, or open an invite link from a friend.</p>
          </Card>
        ) : (
          <ul className="space-y-3">
            {leagues.data.map((l) => {
              const me = scores.data?.get(l.id);
              const badge = statusBadge[l.status];
              return (
                <li key={l.id}>
                  <Link
                    to={`/league/${l.id}`}
                    className="group flex items-center gap-3 rounded-2xl bg-panel p-3.5 active:bg-raised sm:gap-4 sm:p-4 ring-1 ring-line/70 transition hover:bg-raised hover:ring-line"
                  >
                    <LeagueMark name={l.name} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold">{l.name}</div>
                      <div className="mt-0.5 text-xs text-mute">
                        {l.commissioner_id === userId ? "Commissioner" : "Member"}
                        {l.status === "complete" && me && ` · ${me.wins}–${me.losses}`}
                      </div>
                    </div>
                    {l.status === "complete" && me ? (
                      <div className="text-right">
                        <div className="text-lg leading-none font-extrabold text-mint">{ordinal(me.place)}</div>
                        <div className="mt-1 text-[10px] font-bold tracking-wide text-faint uppercase">Place</div>
                      </div>
                    ) : (
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    )}
                    <span className="text-faint transition group-hover:translate-x-0.5 group-hover:text-mute" aria-hidden>›</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="space-y-6 self-start lg:mt-12">
        <CreateLeague />
        <AccountSettings />
      </div>
    </div>
  );
}

function CreateLeague() {
  const navigate = useNavigate();
  const notify = useNotice();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [snake, setSnake] = useState(true);
  const [orderMode, setOrderMode] = useState<OrderMode>("random");
  const [pickSeconds, setPickSeconds] = useState(90);

  const create = useMutation({
    mutationFn: () =>
      rpc<string>("create_league", {
        p_name: name.trim(),
        p_snake: snake,
        p_order_mode: orderMode,
        p_pick_seconds: pickSeconds,
      }),
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["myLeagues"] });
      navigate(`/league/${id}`);
    },
    onError: (err) => notify(err.message, "error"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <Card title="Create a league">
      <form onSubmit={submit} className="space-y-4">
        <Field label="League name">
          <input
            required
            maxLength={60}
            placeholder="The Over/Under Club"
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Pick timer" hint="When time runs out, the best team left (by last season's wins) is picked.">
          <select className={inputClass} value={pickSeconds} onChange={(e) => setPickSeconds(Number(e.target.value))}>
            {PICK_TIMER_OPTIONS.map((o) => (
              <option key={o.seconds} value={o.seconds}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Draft order">
          <select
            className={inputClass}
            value={orderMode}
            onChange={(e) => setOrderMode(e.target.value as OrderMode)}
          >
            <option value="random">Randomize when the draft starts</option>
            <option value="manual">I'll set it</option>
          </select>
        </Field>
        <Toggle checked={snake} onChange={setSnake} label="Snake draft (order reverses each round)" />
        <Button type="submit" busy={create.isPending} disabled={!name.trim()} className="w-full">
          Create league
        </Button>
        <p className="text-center text-xs text-faint">You can change these settings in the lobby until the draft starts.</p>
      </form>
    </Card>
  );
}

function AccountSettings() {
  const userId = useUserId();
  const { profile } = useAuth();
  const notify = useNotice();
  const queryClient = useQueryClient();
  const recap = useWeeklyRecap(userId);

  const save = useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await supabase
        .from("email_preferences")
        .upsert({ user_id: userId, weekly_recap: on, updated_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
    },
    onSuccess: (_, on) => {
      queryClient.setQueryData(["emailPrefs", userId], on);
      notify(on ? "Weekly recaps on." : "Weekly recaps off.");
    },
    onError: (err) => notify(err.message, "error"),
  });

  async function rename(username: string) {
    const { error } = await supabase.from("profiles").update({ username }).eq("id", userId);
    if (error?.code === "23505") throw new Error("That username is taken.");
    if (error) throw new Error(error.message);
    // Usernames show up in every league's members and standings.
    for (const key of ["profile", "members", "scoreboard", "myScores"]) queryClient.invalidateQueries({ queryKey: [key] });
    notify("Username updated.");
  }

  return (
    <Card title="Account">
      <div className="mb-4 border-b border-line/70 pb-4">
        <div className="mb-1 text-xs font-bold uppercase tracking-wide text-mute">Username</div>
        <div className="font-semibold">
          <InlineEdit value={profile?.username ?? ""} label="username" maxLength={24}
            validate={(v) => (USERNAME.test(v) ? null : "2–24 characters: letters, numbers, spaces, _ . -")} onSave={rename} />
        </div>
      </div>
      <Toggle
        checked={save.isPending ? save.variables : (recap.data ?? true)}
        onChange={(on) => save.mutate(on)}
        label={
          <span>
            <span className="block font-semibold">Weekly recap</span>
            <span className="block text-xs text-mute">Standings and your teams' wins, every Monday during the season.</span>
          </span>
        }
      />
    </Card>
  );
}
