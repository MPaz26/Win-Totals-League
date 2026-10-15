import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Button, Card, ErrorMessage, LeagueMark, PageSpinner } from "../components/ui";
import { useAuth } from "../lib/auth";
import { useNotice } from "../lib/notice";
import { useLeaguePreview } from "../lib/queries";
import { rpc } from "../lib/supabase";
import { ProfileSetup } from "./ProfileSetup";
import { SignIn } from "./SignIn";

/** Invite landing page. Works signed out (league_preview is granted to anon). */
export function Join() {
  const { code = "" } = useParams();
  const { session, profile, profileLoading } = useAuth();
  const preview = useLeaguePreview(code, session?.user.id);
  const navigate = useNavigate();
  const notify = useNotice();
  const queryClient = useQueryClient();

  const join = useMutation({
    mutationFn: () => rpc<string>("join_league", { p_invite_code: code }),
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["myLeagues"] });
      navigate(`/league/${id}`);
    },
    onError: (err) => notify(err.message, "error"),
  });

  if (preview.isPending || profileLoading) return <PageSpinner />;
  if (preview.error) return <ErrorMessage error={preview.error} />;

  const league = preview.data;
  if (!league) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <h1 className="text-lg font-extrabold">Invite not found</h1>
        <p className="mt-1 text-sm text-mute">This invite link is invalid. Ask your commissioner for a new one.</p>
      </Card>
    );
  }
  if (league.is_member) return <Navigate to={`/league/${league.id}`} replace />;

  const header = (
    <div className="mx-auto mb-6 flex max-w-md flex-col items-center text-center">
      <LeagueMark name={league.name} className="mb-4 h-20 w-20 text-2xl shadow-xl shadow-black/30" />
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-mint">{league.commissioner} invited you to</p>
      <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{league.name}</h1>
      <p className="mt-1 text-sm text-mute">
        {league.member_count} {league.member_count === 1 ? "manager" : "managers"} so far
      </p>
    </div>
  );

  if (!session) return <>{header}<SignIn intro="Sign in to join this league." /></>;
  if (!profile) return <>{header}<ProfileSetup /></>;

  return (
    <>
      {header}
      <Card className="mx-auto max-w-md text-center">
        {league.status !== "lobby" ? (
          <p className="text-sm text-mute">This league has already started drafting, so it can't take new members.</p>
        ) : league.member_count >= 30 ? (
          <p className="text-sm text-mute">This league is full.</p>
        ) : (
          <Button onClick={() => join.mutate()} busy={join.isPending} className="w-full">
            Join as {profile.username}
          </Button>
        )}
      </Card>
    </>
  );
}
