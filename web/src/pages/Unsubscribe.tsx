import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { Card, ErrorMessage, PageSpinner } from "../components/ui";
import { rpc } from "../lib/supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Target of the unsubscribe link in recap emails. Works signed out; the token is the authorization. */
export function Unsubscribe() {
  const { token = "" } = useParams();
  const unsubscribe = useMutation({
    mutationFn: () => rpc<boolean>("unsubscribe_weekly_recap", { p_token: token }),
  });
  const { mutate } = unsubscribe;
  const valid = UUID.test(token);

  useEffect(() => {
    if (valid) mutate();
  }, [valid, mutate]);

  if (valid && (unsubscribe.isIdle || unsubscribe.isPending)) return <PageSpinner />;
  if (unsubscribe.error) return <ErrorMessage error={unsubscribe.error} />;

  return (
    <Card className="mx-auto max-w-md text-center">
      {valid && unsubscribe.data ? (
        <>
          <h1 className="text-lg font-extrabold">You're unsubscribed</h1>
          <p className="mt-1 text-sm text-mute">You won't get weekly recap emails anymore.</p>
        </>
      ) : (
        <>
          <h1 className="text-lg font-extrabold">Link not recognized</h1>
          <p className="mt-1 text-sm text-mute">This unsubscribe link is invalid.</p>
        </>
      )}
      <p className="mt-4 text-sm text-mute">
        You can turn recaps on or off any time from{" "}
        <Link to="/profile" className="font-semibold text-mint hover:underline">your profile</Link>.
      </p>
    </Card>
  );
}
