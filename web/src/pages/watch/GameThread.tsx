import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { TeamLogo } from "../../components/team";
import { Button, Card, ErrorMessage, inputClass, PageSpinner } from "../../components/ui";
import { useUserId } from "../../lib/auth";
import { dayLabel, etToday, hasStarted, timeAgo, tipoffTime } from "../../lib/leaguePass";
import { useNotice } from "../../lib/notice";
import { useGame, useGameComments, useGameCommentsRealtime, useLpSettings, useTeams } from "../../lib/queries";
import { rpc } from "../../lib/supabase";
import type { Game, GameComment, Team } from "../../lib/types";
import { WatchTabs } from "./WatchTabs";

const MAX = 1000;

export function GameThread() {
  const { id = "" } = useParams();
  const userId = useUserId();
  const game = useGame(id);
  const teams = useTeams();
  const comments = useGameComments(id);
  const settings = useLpSettings(userId);
  useGameCommentsRealtime(id);
  const [spoilersOk, setSpoilersOk] = useState(false);

  const threads = useMemo(() => {
    const all = comments.data ?? [];
    const replies = new Map<number, GameComment[]>();
    for (const c of all) if (c.parent_id !== null) replies.set(c.parent_id, [...(replies.get(c.parent_id) ?? []), c]);
    // Newest conversations first; replies read top to bottom.
    return all.filter((c) => c.parent_id === null).reverse().map((c) => ({ top: c, replies: replies.get(c.id) ?? [] }));
  }, [comments.data]);

  if (game.isPending || teams.isPending || comments.isPending || settings.isPending) return <PageSpinner />;
  const error = game.error ?? teams.error ?? comments.error ?? settings.error;
  if (error) return <ErrorMessage error={error} />;
  if (!teams.data || !comments.data || !settings.data) return <PageSpinner />;

  const home = teams.data.find((t) => t.id === game.data?.home_team_id);
  const away = teams.data.find((t) => t.id === game.data?.away_team_id);
  if (!game.data || !home || !away) {
    return (
      <div className="mx-auto max-w-2xl">
        <WatchTabs />
        <ErrorMessage error={new Error("Game not found.")} />
      </div>
    );
  }

  const g = game.data;
  const gated = settings.data.hide_scores && hasStarted(g) && threads.length > 0 && !spoilersOk;

  return (
    <div className="mx-auto max-w-2xl">
      <WatchTabs />
      <Link to={g.game_date === etToday() ? "/watch" : `/watch?date=${g.game_date}`} className="mb-3 inline-block text-sm font-bold text-mint">
        ‹ {dayLabel(g.game_date)}
      </Link>

      <GameHeader game={g} home={home} away={away} hideScores={settings.data.hide_scores} />

      <Composer gameId={id} className="mt-4" placeholder={`Talk about ${away.abbr} @ ${home.abbr}…`} />

      <h2 className="mt-6 mb-3 text-xs font-extrabold uppercase tracking-[0.14em] text-mute">
        {threads.length === 0 ? "No comments yet" : `${comments.data.filter((c) => c.body !== null).length} comments`}
      </h2>

      {gated ? (
        <Card className="text-center">
          <p className="font-bold">Comments may give away the score</p>
          <p className="mt-1 text-sm text-mute">You have scores hidden. Show the comments anyway?</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => setSpoilersOk(true)}>Show comments</Button>
        </Card>
      ) : threads.length === 0 ? (
        <p className="text-sm text-mute">Start the conversation. Everyone on League Pass can read and reply.</p>
      ) : (
        <ul className="space-y-3">
          {threads.map(({ top, replies }) => (
            <li key={top.id}>
              <Thread gameId={id} top={top} replies={replies} userId={userId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GameHeader({ game, home, away, hideScores }: { game: Game; home: Team; away: Team; hideScores: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const hasScore = game.home_score !== null && game.away_score !== null;
  const showScore = hasScore && (!hideScores || revealed);

  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        {[
          { team: away, score: game.away_score, other: game.home_score },
          { team: home, score: game.home_score, other: game.away_score },
        ].map(({ team, score, other }, i) => (
          <div key={team.id} className={`flex min-w-0 flex-1 items-center gap-2.5 ${i === 1 ? "flex-row-reverse text-right" : ""}`}>
            <TeamLogo abbr={team.abbr} className="h-10 w-10" />
            <div className="min-w-0">
              <div className="truncate font-bold"><span className="sm:hidden">{team.abbr}</span><span className="hidden sm:inline">{team.name}</span></div>
              {showScore && (
                <div className={`text-2xl font-extrabold tabular-nums ${score! > other! ? "text-ink" : "text-mute"}`}>{score}</div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-center gap-3 text-xs font-semibold text-mute">
        <span>
          {game.status === "postponed" ? "Postponed" : game.status === "canceled" ? "Canceled" : `${dayLabel(game.game_date)} · ${tipoffTime(game.tipoff)}`}
          {game.national_tv && ` · ${game.national_tv}`}
        </span>
        {hasScore && !showScore && (
          <button type="button" onClick={() => setRevealed(true)} className="font-bold text-mint">Reveal score</button>
        )}
      </div>
    </Card>
  );
}

function Thread({ gameId, top, replies, userId }: { gameId: string; top: GameComment; replies: GameComment[]; userId: string }) {
  const [replying, setReplying] = useState(false);

  return (
    <Card flush>
      <div className="p-4">
        <Comment comment={top} userId={userId} onReply={top.body !== null ? () => setReplying(true) : undefined} />
      </div>
      {(replies.length > 0 || replying) && (
        <div className="space-y-3 border-t border-line/70 py-3 pr-4 pl-6 sm:pl-8">
          {replies.map((r) => (
            <div key={r.id} className="border-l-2 border-line pl-3">
              <Comment comment={r} userId={userId} onReply={() => setReplying(true)} />
            </div>
          ))}
          {replying && (
            <Composer gameId={gameId} parentId={top.id} autoFocus placeholder={`Reply to ${top.author.username}…`} onDone={() => setReplying(false)} />
          )}
        </div>
      )}
    </Card>
  );
}

function Comment({ comment, userId, onReply }: { comment: GameComment; userId: string; onReply?: () => void }) {
  const notify = useNotice();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => rpc("delete_game_comment", { p_id: comment.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gameComments"] });
      queryClient.invalidateQueries({ queryKey: ["commentCounts"] });
    },
    onError: (err) => notify(err.message, "error"),
  });

  if (comment.body === null) return <p className="text-sm italic text-faint">Comment deleted</p>;

  return (
    <div>
      <div className="flex items-baseline gap-2 text-xs">
        <span className="font-bold text-ink">{comment.author.username}</span>
        <time dateTime={comment.created_at} title={new Date(comment.created_at).toLocaleString()} className="text-faint">
          {timeAgo(comment.created_at)}
        </time>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm">{comment.body}</p>
      <div className="mt-1.5 flex gap-4 text-xs font-bold">
        {onReply && <button type="button" onClick={onReply} className="text-mute hover:text-ink">Reply</button>}
        {comment.user_id === userId && (
          <button
            type="button"
            disabled={remove.isPending}
            onClick={() => confirm("Delete this comment?") && remove.mutate()}
            className="text-mute hover:text-rose disabled:text-faint"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function Composer({ gameId, parentId, placeholder, autoFocus, onDone, className = "" }: {
  gameId: string;
  parentId?: number;
  placeholder: string;
  autoFocus?: boolean;
  /** Called after posting or canceling; a reply box closes, the main box stays. */
  onDone?: () => void;
  className?: string;
}) {
  const [body, setBody] = useState("");
  const notify = useNotice();
  const queryClient = useQueryClient();
  const post = useMutation({
    mutationFn: () => rpc<number>("post_game_comment", { p_game: gameId, p_body: body, p_parent: parentId ?? null }),
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({ queryKey: ["gameComments", gameId] });
      queryClient.invalidateQueries({ queryKey: ["commentCounts"] });
      onDone?.();
    },
    onError: (err) => notify(err.message, "error"),
  });

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (body.trim() && !post.isPending) post.mutate();
  };

  return (
    <form onSubmit={submit} className={className}>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
        }}
        maxLength={MAX}
        rows={parentId ? 2 : 3}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`${inputClass} resize-y`}
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        {body.length > MAX - 100 && <span className="mr-auto text-xs text-mute tabular-nums">{MAX - body.length} left</span>}
        {onDone && <Button variant="ghost" size="sm" onClick={onDone}>Cancel</Button>}
        <Button type="submit" size="sm" busy={post.isPending} disabled={!body.trim()}>
          {parentId ? "Reply" : "Post"}
        </Button>
      </div>
    </form>
  );
}
