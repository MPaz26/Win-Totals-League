import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button, ErrorMessage, PageSpinner } from "../../components/ui";
import { TeamLogo, teamColor } from "../../components/team";
import { useUserId } from "../../lib/auth";
import { useNotice } from "../../lib/notice";
import { useCommunityRankings, useLpRankings, useTeams } from "../../lib/queries";
import { rpc } from "../../lib/supabase";
import type { Team } from "../../lib/types";
import { WatchTabs } from "./WatchTabs";

export function Rankings() {
  const userId = useUserId();
  const teams = useTeams();
  const saved = useLpRankings(userId);
  const community = useCommunityRankings();
  const notify = useNotice();
  const queryClient = useQueryClient();
  /** Unsaved edits; null shows the saved order. */
  const [draft, setDraft] = useState<number[] | null>(null);

  const teamMap = useMemo(() => new Map((teams.data ?? []).map((t) => [t.id, t])), [teams.data]);

  // First visit starts from the community's order (then last season's wins), so there's
  // something sensible to tweak rather than an alphabetical list.
  const starting = useMemo(() => {
    if (saved.data) return saved.data;
    if (!teams.data || !community.data) return null;
    const avg = new Map(community.data.map((c) => [c.team_id, c.avg_rank]));
    return [...teams.data]
      .sort((a, b) => (avg.get(a.id) ?? 99) - (avg.get(b.id) ?? 99) || (b.last_season_wins ?? 0) - (a.last_season_wins ?? 0))
      .map((t) => t.id);
  }, [saved.data, teams.data, community.data]);

  const order = draft ?? starting;
  const dirty = order !== null && (saved.data === null || (draft !== null && draft.join() !== saved.data?.join()));

  const save = useMutation({
    mutationFn: (ids: number[]) => rpc("set_lp_rankings", { p_order: ids }),
    onSuccess: (_, ids) => {
      queryClient.setQueryData(["lpRankings", userId], ids);
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ["lpSuggestions"] });
      queryClient.invalidateQueries({ queryKey: ["lpCommunity"] });
      notify("Rankings saved.");
    },
    onError: (err) => notify(err.message, "error"),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (teams.isPending || saved.isPending || (saved.data === null && community.isPending)) return <PageSpinner />;
  const error = teams.error ?? saved.error ?? community.error;
  if (error || !order) return <ErrorMessage error={error} />;
  const ids = order;

  const name = (id: number | string) => teamMap.get(Number(id))?.name ?? "Team";
  const move = (from: number, to: number) => setDraft(arrayMove(ids, from, Math.max(0, Math.min(ids.length - 1, to))));

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}, ranked ${ids.indexOf(Number(active.id)) + 1}.`,
    onDragOver: ({ active, over }) => (over ? `${name(active.id)} would move to ${ids.indexOf(Number(over.id)) + 1}.` : ""),
    onDragEnd: ({ active, over }) =>
      over ? `${name(active.id)} moved to ${ids.indexOf(Number(over.id)) + 1}.` : `${name(active.id)} dropped.`,
    onDragCancel: ({ active }) => `Cancelled. ${name(active.id)} stays put.`,
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    if (over && active.id !== over.id) move(ids.indexOf(Number(active.id)), ids.indexOf(Number(over.id)));
  }

  return (
    <div className="mx-auto max-w-xl pb-24">
      <WatchTabs />
      <h1 className="text-2xl font-extrabold tracking-tight">My rankings</h1>
      <p className="mt-1 mb-4 text-sm text-mute">
        1 is the team you most want to watch. Drag the handle, or use the arrows.
        {saved.data === null && " This starts from the community's order."}
      </p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ announcements }}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="space-y-1.5">
            {ids.map((id, i) => {
              const team = teamMap.get(id);
              return team ? (
                <Row key={id} team={team} index={i} last={i === ids.length - 1} onMove={(to) => move(i, to)} />
              ) : null;
            })}
          </ol>
        </SortableContext>
      </DndContext>

      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 pt-3">
            <span className="text-sm font-semibold text-mute">{saved.data ? "Unsaved changes" : "Save to start getting picks"}</span>
            <div className="flex gap-2">
              {draft && (
                <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={save.isPending}>Reset</Button>
              )}
              <Button size="sm" busy={save.isPending} onClick={() => save.mutate(ids)}>Save rankings</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ team, index, last, onMove }: { team: Team; index: number; last: boolean; onMove: (to: number) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: team.id });
  const arrow = "h-9 w-9 rounded-full text-mute hover:bg-raised hover:text-ink disabled:text-line disabled:hover:bg-transparent";

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-xl bg-panel py-1.5 pr-1.5 pl-2 ring-1 sm:gap-3 ${
        isDragging ? "relative z-10 ring-mint shadow-lg shadow-black/40" : "ring-line/70"
      }`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="flex h-9 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-faint hover:text-mute active:cursor-grabbing"
        aria-label={`Drag ${team.name}, ranked ${index + 1}`}
        {...attributes}
        {...listeners}
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden>
          <circle cx="7" cy="5" r="1.5" /><circle cx="13" cy="5" r="1.5" />
          <circle cx="7" cy="10" r="1.5" /><circle cx="13" cy="10" r="1.5" />
          <circle cx="7" cy="15" r="1.5" /><circle cx="13" cy="15" r="1.5" />
        </svg>
      </button>
      <span className="w-6 text-right text-sm font-extrabold tabular-nums" style={{ color: teamColor(team.abbr) }}>{index + 1}</span>
      <TeamLogo abbr={team.abbr} className="h-8 w-8" />
      <span className="min-w-0 flex-1 truncate font-bold">{team.name}</span>
      <button type="button" className={`${arrow} hidden text-[11px] font-bold sm:block`} disabled={index === 0} onClick={() => onMove(0)}
        aria-label={`Move ${team.name} to the top`}>
        Top
      </button>
      <button type="button" className={arrow} disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Move ${team.name} up`}>↑</button>
      <button type="button" className={arrow} disabled={last} onClick={() => onMove(index + 1)} aria-label={`Move ${team.name} down`}>↓</button>
    </li>
  );
}
