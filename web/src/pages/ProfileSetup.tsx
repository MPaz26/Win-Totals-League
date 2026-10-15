import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Button, Card, Field, inputClass } from "../components/ui";
import { useUserId } from "../lib/auth";
import { supabase } from "../lib/supabase";

// Same rule as the profiles.username check constraint.
const USERNAME = /^[A-Za-z0-9_. -]{2,24}$/;

export function ProfileSetup() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");

  const save = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("profiles").insert({ id: userId, username: name });
      if (error?.code === "23505") throw new Error("That username is taken.");
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["profile", userId] }),
  });

  const trimmed = username.trim();
  const valid = USERNAME.test(trimmed);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (valid) save.mutate(trimmed);
  }

  return (
    <Card className="mx-auto max-w-md">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Pick a username</h1>
          <p className="mt-1 text-sm text-zinc-600">This is how you'll show up on draft boards and scoreboards.</p>
        </div>
        <Field label="Username" hint="2–24 characters: letters, numbers, spaces, _ . -">
          <input
            required
            autoFocus
            maxLength={24}
            className={inputClass}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </Field>
        {save.error && <p className="text-sm text-red-700">{save.error.message}</p>}
        <Button type="submit" busy={save.isPending} disabled={!valid} className="w-full">
          Continue
        </Button>
      </form>
    </Card>
  );
}
