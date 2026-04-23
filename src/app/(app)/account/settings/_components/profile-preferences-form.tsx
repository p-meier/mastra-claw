'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import { updateProfilePreferencesAction } from '../actions';

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="text-sm font-medium leading-none">
      {children}
    </label>
  );
}

/**
 * Profile preferences editor — the user's preferred name (how the
 * assistant addresses them) and the free-form Markdown `user_prompt`
 * document that gets injected into every agent prompt.
 *
 * Both fields are pre-populated from the current row in user_profiles.
 * Save fires a Server Action that validates with Zod and writes via the
 * authenticated Supabase client (RLS scoped to the calling user).
 */

type Props = {
  initialPreferredName: string;
  initialUserPrompt: string;
};

export function ProfilePreferencesForm({
  initialPreferredName,
  initialUserPrompt,
}: Props) {
  const [preferredName, setPreferredName] = useState(initialPreferredName);
  const [userPrompt, setUserPrompt] = useState(initialUserPrompt);
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'success' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [isPending, startTransition] = useTransition();

  const isDirty =
    preferredName !== initialPreferredName || userPrompt !== initialUserPrompt;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus({ kind: 'idle' });
    startTransition(async () => {
      const result = await updateProfilePreferencesAction({
        preferredName,
        userPrompt,
      });
      if (result.ok) {
        setStatus({ kind: 'success' });
      } else {
        setStatus({ kind: 'error', message: result.error });
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor="preferredName">How should your assistant call you?</FieldLabel>
        <Input
          id="preferredName"
          value={preferredName}
          onChange={(e) => setPreferredName(e.target.value)}
          placeholder="Patrick"
          maxLength={100}
          autoComplete="off"
          required
        />
        <p className="text-muted-foreground text-xs">
          The first name or handle the assistant uses to address you. Stored
          in <code className="font-mono">user_profiles.preferred_name</code>.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor="userPrompt">Personal preferences (Markdown)</FieldLabel>
        <Textarea
          id="userPrompt"
          value={userPrompt}
          onChange={(e) => setUserPrompt(e.target.value)}
          placeholder={`# User Information\nName, age, location\n\n## Professional Background\n…\n\n## Personal Background\n…\n\n## Communication Style\n…`}
          className="min-h-[420px] font-mono text-sm leading-relaxed"
          required
        />
        <p className="text-muted-foreground text-xs">
          Free-form Markdown describing you. Wrapped in{' '}
          <code className="font-mono">&lt;preferences&gt;</code> tags and
          injected verbatim into every agent system prompt. Edit anytime —
          changes apply on the next message.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          {status.kind === 'success' && (
            <span className="text-emerald-600 dark:text-emerald-400">
              Saved.
            </span>
          )}
          {status.kind === 'error' && (
            <span className="text-destructive">{status.message}</span>
          )}
        </div>
        <Button type="submit" disabled={!isDirty || isPending}>
          {isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}
