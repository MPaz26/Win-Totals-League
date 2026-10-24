import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge, Button, Card, ErrorMessage, Field, inputClass, LeagueMark, PageSpinner, statusBadge, Toggle } from "../components/ui";
import { useUserId } from "../lib/auth";
import { PICK_TIMER_OPTIONS } from "../lib/draft";
import { useNotice } from "../lib/notice";
import { useMyLeagues, useMyStandings } from "../lib/queries";
import { rpc } from "../lib/supabase";
import type { OrderMode } from "../lib/types";

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export function Leagues() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
      <div>
        <h1 className="mb-4 text-2xl font-extrabold tracking-tight">Leagues</h1>
        <LeagueList />
      </div>
      <div className="self-start lg:mt-12">
        <CreateLeague />
      </div>
    </div>
  );
}

/** The caller's leagues, with their place in each finished one. Also on the home page. */
export function LeagueList() {
  const userId = useUserId();
  const leagues = useMyLeagues();
  const scores = useMyStandings(userId);

  return leagues.isPending ? (
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
