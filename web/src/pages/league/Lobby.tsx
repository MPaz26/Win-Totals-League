import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, Field, inputClass } from "../../components/ui";
import { useUserId } from "../../lib/auth";
import { PICK_TIMER_OPTIONS, rosterSizes, timerLabel } from "../../lib/draft";
import { useNotice } from "../../lib/notice";
import { rpc } from "../../lib/supabase";
import type { League, OrderMode } from "../../lib/types";
import type { LeagueData } from "../League";

export function Lobby({ league, members }: LeagueData) {
  const userId = useUserId();
  const navigate = useNavigate();
  const notify = useNotice();
  const queryClient = useQueryClient();
  const isCommish = league.commissioner_id === userId;
  const manual = league.order_mode === "manual";

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["league", league.id] });
    queryClient.invalidateQueries({ queryKey: ["members", league.id] });
  };
  const onError = (err: Error) => notify(err.message, "error");

  const remove = useMutation({
    mutationFn: (user: string) => rpc("remove_member", { p_league: league.id, p_user: user }),
    onSuccess: (_, user) => {
      if (user === userId) {
        queryClient.invalidateQueries({ queryKey: ["myLeagues"] });
        navigate("/");
        notify(`You left ${league.name}.`);
      } else refresh();
    },
    onError,
  });

  const reorder = useMutation({
    mutationFn: (order: string[]) => rpc("set_draft_order", { p_league: league.id, p_order: order }),
    onSuccess: refresh,
    onError,
  });

  const start = useMutation({
    mutationFn: () => rpc("start_draft", { p_league: league.id }),
    onSuccess: refresh,
    onError,
  });

  function move(index: number, delta: number) {
    const order = members.map((m) => m.user_id);
    [order[index], order[index + delta]] = [order[index + delta], order[index]];
    reorder.mutate(order);
  }

  function startDraft() {
    if (window.confirm(`Start the draft with ${members.length} members? Nobody else can join after this.`)) {
      start.mutate();
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <InviteCard code={league.invite_code} />

        <Card
          title={`Members (${members.length})`}
          actions={manual ? <span className="text-xs text-zinc-500">Draft order</span> : undefined}
        >
          <ol className="divide-y divide-zinc-100">
            {members.map((m, i) => (
              <li key={m.user_id} className="flex items-center gap-3 py-2.5">
                {manual && <span className="w-6 text-right text-sm tabular-nums text-zinc-400">{m.draft_slot}</span>}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {m.profile.username}
                  {m.user_id === userId && <span className="font-normal text-zinc-500"> (you)</span>}
                </span>
                {m.user_id === league.commissioner_id && <Badge tone="orange">Commissioner</Badge>}
                {isCommish && manual && (
                  <span className="flex">
                    <Button variant="ghost" size="sm" aria-label="Move up" disabled={i === 0 || reorder.isPending}
                      onClick={() => move(i, -1)}>↑</Button>
                    <Button variant="ghost" size="sm" aria-label="Move down"
                      disabled={i === members.length - 1 || reorder.isPending} onClick={() => move(i, 1)}>↓</Button>
                  </span>
                )}
                {isCommish && m.user_id !== userId && (
                  <Button variant="ghost" size="sm" disabled={remove.isPending}
                    onClick={() => window.confirm(`Remove ${m.profile.username}?`) && remove.mutate(m.user_id)}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ol>
          {!manual && (
            <p className="mt-3 text-xs text-zinc-500">The draft order is randomized when the commissioner starts the draft.</p>
          )}
        </Card>
      </div>

      <div className="space-y-6">
        {isCommish ? <SettingsForm key={settingsKey(league)} league={league} /> : <SettingsSummary league={league} />}

        <Card>
          <p className="text-sm text-zinc-600">
            {members.length < 2
              ? "Waiting for at least one more member to join."
              : `30 teams across ${members.length} members: ${rosterSizes(members.length)}.`}
          </p>
          {isCommish ? (
            <Button className="mt-4 w-full" disabled={members.length < 2} busy={start.isPending} onClick={startDraft}>
              Start the draft
            </Button>
          ) : (
            <>
              <p className="mt-2 text-sm text-zinc-600">The commissioner will start the draft. This page updates live.</p>
              <Button variant="danger" size="sm" className="mt-4" busy={remove.isPending}
                onClick={() => window.confirm(`Leave ${league.name}?`) && remove.mutate(userId)}>
                Leave league
              </Button>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function InviteCard({ code }: { code: string }) {
  const notify = useNotice();
  const link = new URL(`${import.meta.env.BASE_URL}join/${code}`, window.location.origin).toString();

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      notify("Invite link copied.");
    } catch {
      notify("Couldn't copy. Select the link and copy it manually.", "error");
    }
  }

  return (
    <Card title="Invite friends">
      <div className="flex gap-2">
        <input readOnly value={link} className={`${inputClass} font-mono text-xs`} onFocus={(e) => e.target.select()} />
        <Button variant="secondary" onClick={copy}>Copy</Button>
      </div>
      <p className="mt-2 text-xs text-zinc-500">Anyone with this link can join until the draft starts.</p>
    </Card>
  );
}

function settingsKey(l: League) {
  return `${l.snake}-${l.order_mode}-${l.pick_seconds}`;
}

function SettingsSummary({ league }: { league: League }) {
  return (
    <Card title="Draft settings">
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between"><dt className="text-zinc-500">Format</dt><dd>{league.snake ? "Snake" : "Same order every round"}</dd></div>
        <div className="flex justify-between"><dt className="text-zinc-500">Order</dt><dd>{league.order_mode === "random" ? "Random" : "Set by commissioner"}</dd></div>
        <div className="flex justify-between"><dt className="text-zinc-500">Pick timer</dt><dd>{timerLabel(league.pick_seconds)}</dd></div>
      </dl>
    </Card>
  );
}

function SettingsForm({ league }: { league: League }) {
  const notify = useNotice();
  const queryClient = useQueryClient();
  const [snake, setSnake] = useState(league.snake);
  const [orderMode, setOrderMode] = useState<OrderMode>(league.order_mode);
  const [pickSeconds, setPickSeconds] = useState(league.pick_seconds);
  const dirty = snake !== league.snake || orderMode !== league.order_mode || pickSeconds !== league.pick_seconds;

  const save = useMutation({
    mutationFn: () =>
      rpc("update_league_settings", {
        p_league: league.id,
        p_snake: snake,
        p_order_mode: orderMode,
        p_pick_seconds: pickSeconds,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["league", league.id] });
      notify("Settings saved.");
    },
    onError: (err) => notify(err.message, "error"),
  });

  // Keep a non-preset timer (set some other way) selectable instead of silently changing it.
  const timerOptions = PICK_TIMER_OPTIONS.some((o) => o.seconds === league.pick_seconds)
    ? PICK_TIMER_OPTIONS
    : [...PICK_TIMER_OPTIONS, { seconds: league.pick_seconds, label: timerLabel(league.pick_seconds) }];

  return (
    <Card title="Draft settings">
      <div className="space-y-4">
        <Field label="Pick timer">
          <select className={inputClass} value={pickSeconds} onChange={(e) => setPickSeconds(Number(e.target.value))}>
            {timerOptions.map((o) => (
              <option key={o.seconds} value={o.seconds}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Draft order">
          <select className={inputClass} value={orderMode} onChange={(e) => setOrderMode(e.target.value as OrderMode)}>
            <option value="random">Randomize when the draft starts</option>
            <option value="manual">Set manually (use the arrows)</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={snake} onChange={(e) => setSnake(e.target.checked)} />
          Snake draft
        </label>
        <Button variant="secondary" className="w-full" disabled={!dirty} busy={save.isPending} onClick={() => save.mutate()}>
          Save settings
        </Button>
      </div>
    </Card>
  );
}
