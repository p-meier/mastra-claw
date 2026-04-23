'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { updateOrganizationSettingAction } from '@/app/(app)/admin/settings/organization-actions';

type Props = {
  initialName: string | null;
  initialOrganizationPrompt: string | null;
  onContinue: () => void;
  onSkip: () => void;
};

const PROMPT_PLACEHOLDER = `# Company overview
Who we are, where we sit, what we do

## Industry & market
Sector, positioning, what makes us distinct

## Context for agents
Anything every assistant should carry into every conversation`;

/**
 * First-stage branding form. All fields are optional — empty values
 * preserve the default MastraClaw look-and-feel.
 *
 * Logo upload isn't wired yet — the `customerLogoPath` slot in
 * `platform_settings.organization` stays `null` until the branding
 * storage-bucket upload path lands. We capture only the text fields
 * here.
 */
export function BrandingStep({
  initialName,
  initialOrganizationPrompt,
  onContinue,
  onSkip,
}: Props) {
  const [name, setName] = useState(initialName ?? '');
  const [organizationPrompt, setOrganizationPrompt] = useState(
    initialOrganizationPrompt ?? '',
  );
  const [status, setStatus] = useState<
    { kind: 'idle' } | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [pending, startTransition] = useTransition();

  const onSaveAndContinue = () => {
    const trimmedName = name.trim();
    const trimmedPrompt = organizationPrompt.trim();
    setStatus({ kind: 'idle' });
    startTransition(async () => {
      const result = await updateOrganizationSettingAction({
        name: trimmedName === '' ? null : trimmedName,
        organizationPrompt:
          trimmedPrompt === '' ? null : organizationPrompt,
      });
      if (!result.ok) {
        setStatus({ kind: 'error', message: result.error });
        return;
      }
      onContinue();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <p>
          Make this platform feel like yours. Set a company name and an
          organization prompt — every agent run will carry the prompt as
          its outermost context layer. Leave everything blank to keep the
          defaults.
        </p>
        <p className="text-xs">
          All fields are optional. You can update them later under{' '}
          <strong>Admin Settings → Organization</strong>.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="branding-company-name">Company name</Label>
        <Input
          id="branding-company-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Acme GmbH"
          maxLength={200}
          disabled={pending}
        />
        <p className="text-xs text-muted-foreground">
          Displayed in the app chrome and browser tab.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="branding-organization-prompt">
          Organization prompt (Markdown)
        </Label>
        <Textarea
          id="branding-organization-prompt"
          value={organizationPrompt}
          onChange={(e) => setOrganizationPrompt(e.target.value)}
          placeholder={PROMPT_PLACEHOLDER}
          className="min-h-[240px] font-mono text-sm leading-relaxed"
          maxLength={20_000}
          disabled={pending}
        />
        <p className="text-xs text-muted-foreground">
          Free-form Markdown injected above the user prompt so every
          agent run carries the organization context.
        </p>
      </div>

      {status.kind === 'error' && (
        <p role="alert" className="text-sm text-destructive">
          {status.message}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          disabled={pending}
        >
          Skip this step
        </button>
        <Button type="button" onClick={onSaveAndContinue} disabled={pending}>
          {pending ? 'Saving…' : 'Save & continue'}
        </Button>
      </div>
    </div>
  );
}
