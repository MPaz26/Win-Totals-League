import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { Button, Card, ErrorMessage, PageSpinner } from "../components/ui";
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
      <Card className="mx-auto max-w-md">
        <h1 className="text-lg font-semibold">Invite not found</h1>
        <p className="mt-1 text-sm text-zinc-600">This invite link is invalid. Ask your commissioner for a new one.</p>
      </Card>
    );
  }
  if (league.is_member) return <Navigate to={`/league/${league.id}`} replace />;

  const header = (
    <div className="mx-auto mb-6 max-w-md text-center">
      <p className="text-sm text-zinc-500">{league.commissioner} invited you to</p>
      <h1 className="text-2xl font-semibold">{league.name}</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {league.member_count} {league.member_count === 1 ? "member" : "members"} so far
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
          <p className="text-sm text-zinc-600">This league has already started drafting, so it can't take new members.</p>
        ) : league.member_count >= 30 ? (
          <p className="text-sm text-zinc-600">This league is full.</p>
        ) : (
          <Button onClick={() => join.mutate()} busy={join.isPending} className="w-full">
            Join as {profile.username}
          </Button>
        )}
      </Card>
    </>
  );
}
