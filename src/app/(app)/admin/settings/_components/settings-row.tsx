'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { saveSettingAction } from '../actions';

/**
 * Single editable settings row. Renders a label + the current effective
 * value + an inline editor that lets the admin set or clear the
 * `app_settings` override. Clearing falls back to the Tier 0 default.
 */
export type SettingsRowProps = {
  /** The Zod-validated key in `app_settings`. */
  settingKey: string;
  label: string;
  description?: string;
  /** The currently effective value (override OR default). */
  effectiveValue: string;
  /** The Tier 0 default. Used to render the "Reset" button only when needed. */
  defaultValue: string;
  /** True when an `app_settings` row exists for this key. */
  isOverridden: boolean;
  /** Hint shown in the input. */
  placeholder?: string;
  /** Render the input as a textarea instead of single-line. */
  multiline?: boolean;
  /** Disable inline editing — value is wizard-managed. */
  readOnly?: boolean;
};

export function SettingsRow({
  settingKey,
  label,
  description,
  effectiveValue,
  defaultValue,
  isOverridden,
  placeholder,
  multiline,
  readOnly,
}: SettingsRowProps) {
  const [draft, setDraft] = useState(effectiveValue);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty = draft !== effectiveValue;

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      const res = await saveSettingAction(settingKey, draft);
      if (!res.ok) setError(res.error);
    });
  };

  const handleReset = () => {
    setError(null);
    startTransition(async () => {
      const res = await saveSettingAction(settingKey, null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDraft(defaultValue);
    });
  };

  return (
    <div className="border-b py-5 last:border-b-0">
      <div className="mb-2 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">{label}</h3>
            <span
              className={
                'rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] ' +
                (isOverridden
                  ? 'bg-amber-500/15 text-amber-300'
                  : 'bg-muted text-muted-foreground')
              }
            >
              {isOverridden ? 'overridden' : 'default'}
            </span>
          </div>
          {description ? (
            <p className="text-muted-foreground mt-1 text-xs">{description}</p>
          ) : null}
          <p className="text-muted-foreground/70 mt-1 font-mono text-[10px]">
            {settingKey}
          </p>
        </div>
      </div>

      {readOnly ? (
        <div className="bg-muted text-muted-foreground rounded-md px-3 py-2 font-mono text-xs">
          {effectiveValue || '(empty)'}
        </div>
      ) : multiline ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="border-input bg-background focus:border-amber-400/50 focus:ring-amber-400/15 w-full rounded-md border px-3 py-2 font-mono text-sm outline-none focus:ring-4"
          disabled={isPending}
        />
      ) : (
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="border-input bg-background focus:border-amber-400/50 focus:ring-amber-400/15 h-10 w-full rounded-md border px-3 font-mono text-sm outline-none focus:ring-4"
          disabled={isPending}
        />
      )}

      {error ? (
        <p className="mt-2 text-xs text-rose-400">{error}</p>
      ) : null}

      {!readOnly ? (
        <div className="mt-3 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={!dirty || isPending}
          >
            {isPending ? 'Saving…' : 'Save'}
          </Button>
          {isOverridden ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleReset}
              disabled={isPending}
            >
              Reset to default
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
