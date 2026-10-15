import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge, Button, Card, ErrorMessage, Field, inputClass, PageSpinner } from "../components/ui";
import { useUserId } from "../lib/auth";
import { PICK_TIMER_OPTIONS } from "../lib/draft";
import { useNotice } from "../lib/notice";
import { useMyLeagues, useMyStandings } from "../lib/queries";
import { rpc } from "../lib/supabase";
import type { LeagueStatus, OrderMode } from "../lib/types";

const statusBadge: Record<LeagueStatus, { label: string; tone: "zinc" | "orange" | "green" }> = {
  lobby: { label: "Lobby", tone: "zinc" },
  drafting: { label: "Drafting now", tone: "orange" },
  complete: { label: "In season", tone: "green" },
};

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
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <Card title="Your leagues">
        {leagues.isPending ? (
          <PageSpinner />
        ) : leagues.error ? (
          <ErrorMessage error={leagues.error} />
        ) : leagues.data.length === 0 ? (
          <p className="text-sm text-zinc-600">
            You're not in any leagues yet. Create one, or open an invite link from a friend.
          </p>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {leagues.data.map((l) => {
              const me = scores.data?.get(l.id);
              const badge = statusBadge[l.status];
              return (
                <li key={l.id}>
                  <Link
                    to={`/league/${l.id}`}
                    className="-mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-3 hover:bg-zinc-50"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{l.name}</div>
                      <div className="text-xs text-zinc-500">
                        {l.commissioner_id === userId ? "Commissioner" : "Member"}
                        {l.status === "complete" && me && ` · ${me.wins}–${me.losses} · ${ordinal(me.place)} place`}
                      </div>
                    </div>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <CreateLeague />
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
    <Card title="Create a league" className="self-start">
      <form onSubmit={submit} className="space-y-4">
        <Field label="League name">
          <input
            required
            maxLength={60}
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
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={snake} onChange={(e) => setSnake(e.target.checked)} />
          Snake draft (order reverses each round)
        </label>
        <Button type="submit" busy={create.isPending} disabled={!name.trim()} className="w-full">
          Create league
        </Button>
        <p className="text-xs text-zinc-500">You can change these settings in the lobby until the draft starts.</p>
      </form>
    </Card>
  );
}
