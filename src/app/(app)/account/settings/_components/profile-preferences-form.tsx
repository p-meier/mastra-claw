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
 * Profile preferences editor — the user's nickname (how the assistant
 * addresses them) and the free-form Markdown `user_preferences`
 * document that gets injected into every agent prompt.
 *
 * Both fields are pre-populated from the current row in user_profiles.
 * Save fires a Server Action that validates with Zod and writes via the
 * authenticated Supabase client (RLS scoped to the calling user).
 */

type Props = {
  initialNickname: string;
  initialUserPreferences: string;
};

export function ProfilePreferencesForm({
  initialNickname,
  initialUserPreferences,
}: Props) {
  const [nickname, setNickname] = useState(initialNickname);
  const [userPreferences, setUserPreferences] = useState(initialUserPreferences);
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'success' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [isPending, startTransition] = useTransition();

  const isDirty =
    nickname !== initialNickname || userPreferences !== initialUserPreferences;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus({ kind: 'idle' });
    startTransition(async () => {
      const result = await updateProfilePreferencesAction({
        nickname,
        userPreferences,
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
        <FieldLabel htmlFor="nickname">How should your assistant call you?</FieldLabel>
        <Input
          id="nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Patrick"
          maxLength={100}
          autoComplete="off"
          required
        />
        <p className="text-muted-foreground text-xs">
          The first name or handle the assistant uses to address you. Stored
          in <code className="font-mono">user_profiles.nickname</code>.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <FieldLabel htmlFor="userPreferences">Personal preferences (Markdown)</FieldLabel>
        <Textarea
          id="userPreferences"
          value={userPreferences}
          onChange={(e) => setUserPreferences(e.target.value)}
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
