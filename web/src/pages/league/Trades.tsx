import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { TeamLogo } from "../../components/team";
import { Button, Card, ErrorMessage, Field, inputClass, Spinner } from "../../components/ui";
import { useUserId } from "../../lib/auth";
import { managerName, shortDate } from "../../lib/draft";
import { useNotice } from "../../lib/notice";
import { useTrades } from "../../lib/queries";
import { rpc } from "../../lib/supabase";
import type { League, Member, Team, TeamRecord, Trade } from "../../lib/types";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const TRADE_RULES =
  "Wins a team has already earned stay with whoever owned it. The new owner's count starts the day after the trade, " +
  "so games on the trade day still go to the old owner. A team can be traded once every 7 days.";

/** Offer, answer and list trades. Rules: see 20261118000100_trades.sql. */
export function Trades({ league, members, teams, records }: {
  league: League;
  members: Member[];
  teams: Map<number, Team>;
  records: TeamRecord[];
}) {
  const userId = useUserId();
  const notify = useNotice();
  const queryClient = useQueryClient();
  const trades = useTrades(league.id);
  const [offering, setOffering] = useState(false);

  const refresh = () => {
    for (const key of ["trades", "scoreboard", "teamRecords"]) queryClient.invalidateQueries({ queryKey: [key, league.id] });
  };
  const onError = (err: Error) => {
    notify(err.message, "error");
    refresh();
  };
  const respond = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) => rpc("respond_to_trade", { p_trade: id, p_accept: accept }),
    onSuccess: (_, { accept }) => {
      notify(accept ? "Trade accepted. Your new teams count from tomorrow." : "Trade declined.");
      refresh();
    },
    onError,
  });
  const cancel = useMutation({
    mutationFn: (id: string) => rpc("cancel_trade", { p_trade: id }),
    onSuccess: () => {
      notify("Offer withdrawn.");
      refresh();
    },
    onError,
  });

  if (trades.error) return <ErrorMessage error={trades.error} />;

  const nameOf = (user: string) => {
    const m = members.find((x) => x.user_id === user);
    return m ? managerName({ team_name: m.team_name, username: m.profile.username }) : "A former manager";
  };
  const side = (t: Trade, from: string) => t.teams.filter((x) => x.from_user_id === from).map((x) => teams.get(x.team_id)!);
  const mine = (trades.data ?? []).filter((t) => t.status === "pending" && (t.proposer_id === userId || t.recipient_id === userId));
  const done = (trades.data ?? []).filter((t) => t.status === "accepted");

  // When each team can next be traded: 7 days after its last accepted trade.
  const lockedUntil = new Map<number, Date>();
  for (const t of done) {
    const until = new Date(Date.parse(t.decided_at!) + WEEK_MS);
    if (until.getTime() <= Date.now()) continue;
    for (const x of t.teams) if (!lockedUntil.has(x.team_id) || lockedUntil.get(x.team_id)! < until) lockedUntil.set(x.team_id, until);
  }

  return (
    <Card
      flush
      title="Trades"
      actions={!offering && members.length > 1 && (
        <Button size="sm" onClick={() => setOffering(true)}>Offer a trade</Button>
      )}
    >
      {offering && (
        <OfferForm
          league={league}
          members={members}
          teams={teams}
          records={records}
          lockedUntil={lockedUntil}
          nameOf={nameOf}
          onDone={() => {
            setOffering(false);
            refresh();
          }}
        />
      )}

      {trades.isPending ? (
        <div className="flex justify-center pb-5"><Spinner /></div>
      ) : (
        <>
          {mine.length > 0 && (
            <ul className="divide-y divide-line/50 border-t border-line/70">
              {mine.map((t) => {
                const incoming = t.recipient_id === userId;
                const busy = (respond.isPending && respond.variables?.id === t.id) || (cancel.isPending && cancel.variables === t.id);
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                    <span className="min-w-0 flex-1 basis-56 text-sm">
                      <span className="block font-semibold">
                        {incoming ? `${nameOf(t.proposer_id)} offers you` : `You offered ${nameOf(t.recipient_id)}`}
                      </span>
                      <TradeLine get={side(t, incoming ? t.proposer_id : t.recipient_id)} give={side(t, userId)} />
                    </span>
                    {incoming ? (
                      <span className="flex gap-2">
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => respond.mutate({ id: t.id, accept: false })}>
                          Decline
                        </Button>
                        <Button size="sm" busy={busy && respond.variables?.accept} disabled={busy}
                          onClick={() => window.confirm(`Accept this trade? ${TRADE_RULES}`) && respond.mutate({ id: t.id, accept: true })}>
                          Accept
                        </Button>
                      </span>
                    ) : (
                      <Button size="sm" variant="ghost" busy={busy} onClick={() => cancel.mutate(t.id)}>Withdraw</Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {done.length > 0 ? (
            <ul className="divide-y divide-line/50 border-t border-line/70">
              {done.map((t) => (
                <li key={t.id} className="px-4 py-3 text-sm sm:px-5">
                  <span className="block text-xs text-faint">{shortDate(t.effective_date!)}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-semibold">{nameOf(t.proposer_id)}</span>
                    <span className="text-mute">sent</span>
                    <TeamChips teams={side(t, t.proposer_id)} />
                    <span className="text-mute">to</span>
                    <span className="font-semibold">{nameOf(t.recipient_id)}</span>
                    <span className="text-mute">for</span>
                    <TeamChips teams={side(t, t.recipient_id)} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            !offering && mine.length === 0 && (
              <p className="px-4 pb-5 text-sm text-mute sm:px-5">No trades yet. {TRADE_RULES}</p>
            )
          )}
        </>
      )}
    </Card>
  );
}

/** An open offer from the viewer's side. */
function TradeLine({ get, give }: { get: Team[]; give: Team[] }) {
  return (
    <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
      <span className="flex flex-wrap items-center gap-1.5"><span className="text-xs text-mute">You get</span><TeamChips teams={get} /></span>
      <span className="flex flex-wrap items-center gap-1.5"><span className="text-xs text-mute">You send</span><TeamChips teams={give} /></span>
    </span>
  );
}

function TeamChips({ teams }: { teams: Team[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {teams.map((t) => (
        <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-raised px-2 py-0.5 text-xs font-bold ring-1 ring-line" title={t.name}>
          <TeamLogo abbr={t.abbr} className="h-4 w-4" />
          {t.abbr}
        </span>
      ))}
    </span>
  );
}

function OfferForm({ league, members, teams, records, lockedUntil, nameOf, onDone }: {
  league: League;
  members: Member[];
  teams: Map<number, Team>;
  records: TeamRecord[];
  lockedUntil: Map<number, Date>;
  nameOf: (user: string) => string;
  onDone: () => void;
}) {
  const userId = useUserId();
  const notify = useNotice();
  const others = members.filter((m) => m.user_id !== userId);
  const [partner, setPartner] = useState(others[0]?.user_id ?? "");
  const [give, setGive] = useState<Set<number>>(new Set());
  const [get, setGet] = useState<Set<number>>(new Set());

  const rosterOf = (user: string) =>
    records
      .filter((r) => r.user_id === user && r.owned)
      .map((r) => teams.get(r.team_id)!)
      .sort((a, b) => a.name.localeCompare(b.name));

  const offer = useMutation({
    mutationFn: () => rpc("propose_trade", { p_league: league.id, p_to: partner, p_give: [...give], p_get: [...get] }),
    onSuccess: () => {
      notify(`Offer sent to ${nameOf(partner)}.`);
      onDone();
    },
    onError: (err: Error) => notify(err.message, "error"),
  });

  const toggle = (set: Set<number>, update: (s: Set<number>) => void, id: number) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    update(next);
  };

  return (
    <div className="space-y-4 border-t border-line/70 px-4 py-4 sm:px-5">
      <Field label="Trade with">
        <select
          className={inputClass}
          value={partner}
          onChange={(e) => {
            setPartner(e.target.value);
            setGet(new Set());
          }}
        >
          {others.map((m) => <option key={m.user_id} value={m.user_id}>{nameOf(m.user_id)}</option>)}
        </select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <TeamPicker label="You send" teams={rosterOf(userId)} selected={give} lockedUntil={lockedUntil}
          onToggle={(id) => toggle(give, setGive, id)} />
        <TeamPicker label="You get" teams={rosterOf(partner)} selected={get} lockedUntil={lockedUntil}
          onToggle={(id) => toggle(get, setGet, id)} />
      </div>
      <p className="text-xs text-faint">Any number of teams each way. {TRADE_RULES}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
        <Button busy={offer.isPending} disabled={!partner || give.size === 0 || get.size === 0} onClick={() => offer.mutate()}>
          Send offer
        </Button>
      </div>
    </div>
  );
}

function TeamPicker({ label, teams, selected, lockedUntil, onToggle }: {
  label: string;
  teams: Team[];
  selected: Set<number>;
  lockedUntil: Map<number, Date>;
  onToggle: (id: number) => void;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-mute">{label}</span>
      {teams.length === 0 ? (
        <p className="text-sm text-faint">No teams.</p>
      ) : (
        <ul className="divide-y divide-line/50 overflow-hidden rounded-xl bg-night/60 ring-1 ring-line/60">
          {teams.map((t) => {
            const locked = lockedUntil.get(t.id);
            return (
              <li key={t.id}>
                <label className={`flex items-center gap-3 px-3 py-2 ${locked ? "opacity-50" : "cursor-pointer hover:bg-raised/60"}`}>
                  <input type="checkbox" className="h-4 w-4 accent-mint" checked={selected.has(t.id)} disabled={!!locked}
                    onChange={() => onToggle(t.id)} />
                  <TeamLogo abbr={t.abbr} className="h-6 w-6" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{t.name}</span>
                    {locked && (
                      <span className="block text-xs text-faint">
                        Tradable again {locked.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
