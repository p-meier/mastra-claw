'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type {
  Descriptor,
  DescriptorField,
  SecretFieldStatus,
} from '@/lib/descriptors/types';

/**
 * Generic configuration form rendered from a `Descriptor`. Used by:
 *  - the admin setup wizard's per-step body
 *  - the `/admin/settings` provider edit dialog
 *  - the `/admin/channels` channel edit dialog
 *
 * The form is descriptor-agnostic: it dispatches on `field.type` and
 * `field.showWhen` to render the right input and apply conditional
 * visibility, then calls the supplied `onSubmit` server action with the
 * raw value map. Empty secret fields are passed through as empty
 * strings — the server action layer treats those as "keep the stored
 * value" and backfills from Vault before running the descriptor probe.
 */

export type DescriptorFormSubmitResult =
  | { ok: true; models?: string[]; voiceCount?: number; note?: string }
  | { ok: false; error: string };

export type DescriptorFormProps = {
  descriptor: Pick<Descriptor, 'id' | 'displayName' | 'fields'>;
  initialNonSecretValues?: Record<string, unknown>;
  secretFieldStatus?: SecretFieldStatus;
  /**
   * Called when the user clicks Save. The action is responsible for
   * running the descriptor probe and persisting the result; the form
   * just renders success / inline error.
   */
  onSubmit: (
    values: Record<string, string>,
  ) => Promise<DescriptorFormSubmitResult>;
  /**
   * Optional probe-only action wired to a "Test connection" button. If
   * omitted, the only way to validate is to click Save (which the
   * action layer guards with its own probe).
   */
  onProbe?: (
    values: Record<string, string>,
  ) => Promise<DescriptorFormSubmitResult>;
  submitLabel?: string;
  /**
   * Slot for extra controls (e.g. the channel voice toggle) rendered
   * above the submit row.
   */
  extraControls?: ReactNode;
};

export function DescriptorConfigForm({
  descriptor,
  initialNonSecretValues,
  secretFieldStatus = {},
  onSubmit,
  onProbe,
  submitLabel = 'Save',
  extraControls,
}: DescriptorFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const field of descriptor.fields) {
      const fromProps = initialNonSecretValues?.[field.name];
      if (field.type === 'string-array' && Array.isArray(fromProps)) {
        initial[field.name] = (fromProps as unknown[]).join(', ');
      } else if (fromProps !== undefined && fromProps !== null) {
        initial[field.name] = String(fromProps);
      } else if (field.defaultValue !== undefined) {
        // First-time configuration: pre-fill with the descriptor's
        // baked-in default so the admin can click Save without typing.
        // Secret fields are intentionally NOT pre-filled — defaults
        // for credentials would be a security smell.
        initial[field.name] = field.secret ? '' : field.defaultValue;
      } else {
        initial[field.name] = '';
      }
    }
    return initial;
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>(() => {
    const seed = initialNonSecretValues?.defaultModel;
    return seed ? [String(seed)] : [];
  });
  const [pending, startTransition] = useTransition();

  const visibleFields = useMemo(
    () => descriptor.fields.filter((f) => isFieldVisible(f, values)),
    [descriptor.fields, values],
  );

  /**
   * Auto-load models when the form has a `model-select` field.
   *
   * Without this, the admin has to enter the API key, click "Test
   * connection", and only then sees a populated model dropdown — which
   * is what tripped users up: it looks like the form is broken because
   * the dropdown is greyed out.
   *
   * Behaviour:
   *  - Only fires when the descriptor declares a `model-select` field
   *    AND a probe action is wired AND the model list is still empty.
   *  - Debounces 800 ms after the most recent edit so a fast typist
   *    doesn't trigger one probe per keystroke.
   *  - Skips if no value is filled in for the API-key style field
   *    (`apiKey`) — there's nothing to validate yet.
   *  - The manual "Test connection" button stays available as a way
   *    to re-probe after the admin tweaks fields later.
   */
  const hasModelSelect = useMemo(
    () => descriptor.fields.some((f) => f.type === 'model-select'),
    [descriptor.fields],
  );
  const inFlightRef = useRef(false);
  useEffect(() => {
    if (!hasModelSelect) return;
    if (!onProbe) return;
    if (modelOptions.length > 0) return;
    if (!values.apiKey || values.apiKey.length < 8) return;
    // Wait for required non-secret fields (e.g. `baseUrl` for the
    // custom OpenAI-compatible provider). Without them the probe
    // would fail and surface a confusing error before the admin had
    // a chance to fill in the rest of the form.
    for (const field of descriptor.fields) {
      if (field.type === 'model-select') continue;
      if (field.secret) continue;
      if (!field.required) continue;
      if (!isFieldVisible(field, values)) continue;
      if (!values[field.name]) return;
    }

    const handle = window.setTimeout(() => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      startTransition(async () => {
        const result = await onProbe(values);
        inFlightRef.current = false;
        applyResult(result);
      });
    }, 800);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasModelSelect, modelOptions.length, values]);

  function update(name: string, value: string): void {
    setError(null);
    setSuccess(null);
    setValues((prev) => {
      const next = { ...prev, [name]: value };
      // When the user toggles a mode-driving select, clear values for
      // fields that became invisible — otherwise stale cross-mode
      // input gets POSTed and the action's required-field check
      // catches it for the wrong reason.
      for (const field of descriptor.fields) {
        if (!field.showWhen) continue;
        if (field.showWhen.field !== name) continue;
        if (!isFieldVisible(field, next) && next[field.name] !== '') {
          next[field.name] = '';
        }
      }
      return next;
    });
  }

  function applyResult(result: DescriptorFormSubmitResult): boolean {
    if (!result.ok) {
      setError(result.error);
      setSuccess(null);
      return false;
    }
    if (result.models && result.models.length > 0) {
      setModelOptions(result.models);
      // Auto-select a sensible default if the current selection is
      // empty or no longer in the list.
      setValues((prev) => {
        const current = prev.defaultModel;
        if (current && result.models!.includes(current)) return prev;
        return { ...prev, defaultModel: pickPreferredModel(result.models!) };
      });
    }
    setError(null);
    setSuccess(result.note ?? 'OK');
    return true;
  }

  function onProbeClick(): void {
    if (!onProbe) return;
    startTransition(async () => {
      const result = await onProbe(values);
      applyResult(result);
    });
  }

  function onSaveClick(): void {
    startTransition(async () => {
      const result = await onSubmit(values);
      applyResult(result);
    });
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSaveClick();
      }}
    >
      {visibleFields.map((field) => (
        <FieldRow
          key={field.name}
          field={field}
          value={values[field.name] ?? ''}
          onChange={(v) => update(field.name, v)}
          secretStatus={secretFieldStatus[field.name]}
          modelOptions={modelOptions}
        />
      ))}

      {extraControls}

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {success && !error && (
        <p className="text-sm text-muted-foreground">{success}</p>
      )}

      <div className="flex items-center justify-end gap-2">
        {onProbe && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onProbeClick}
          >
            Test connection
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Field row
// ---------------------------------------------------------------------------

function FieldRow({
  field,
  value,
  onChange,
  secretStatus,
  modelOptions,
}: {
  field: DescriptorField;
  value: string;
  onChange: (v: string) => void;
  secretStatus: 'stored' | 'missing' | undefined;
  modelOptions: string[];
}) {
  const id = `field-${field.name}`;
  const placeholder =
    field.secret && secretStatus === 'stored'
      ? '•••••• stored (leave blank to keep)'
      : (field.placeholder ?? '');

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>
        {field.label}
        {field.required && <span className="text-destructive">*</span>}
      </Label>

      {renderInput(field, id, value, onChange, placeholder, modelOptions)}

      {(field.helpText || field.helpUrl) && (
        <p className="text-xs text-muted-foreground">
          {field.helpText}
          {field.helpText && field.helpUrl ? ' ' : ''}
          {field.helpUrl && (
            <a
              href={field.helpUrl}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              docs ↗
            </a>
          )}
        </p>
      )}
    </div>
  );
}

function renderInput(
  field: DescriptorField,
  id: string,
  value: string,
  onChange: (v: string) => void,
  placeholder: string,
  modelOptions: string[],
): ReactNode {
  switch (field.type) {
    case 'password':
      return (
        <Input
          id={id}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'text':
      return (
        <Input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'url':
      return (
        <Input
          id={id}
          type="url"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
      return (
        <Input
          id={id}
          type="number"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <Switch
            id={id}
            checked={value === 'true'}
            onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
          />
          <span className="text-xs text-muted-foreground">
            {value === 'true' ? 'enabled' : 'disabled'}
          </span>
        </div>
      );
    case 'select': {
      const options = field.options ?? [];
      return (
        <Select value={value || undefined} onValueChange={onChange}>
          <SelectTrigger id={id}>
            <SelectValue placeholder={placeholder || 'Select…'} />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    case 'string-array':
      return (
        <Textarea
          id={id}
          value={value}
          placeholder={placeholder || 'comma-separated values'}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
        />
      );
    case 'json':
      return (
        <Textarea
          id={id}
          value={value}
          placeholder={placeholder || '{ "type": "service_account", … }'}
          onChange={(e) => onChange(e.target.value)}
          rows={8}
          className="font-mono text-xs"
        />
      );
    case 'model-select':
      return (
        <Select
          value={value || undefined}
          onValueChange={onChange}
          disabled={modelOptions.length === 0}
        >
          <SelectTrigger id={id}>
            <SelectValue
              placeholder={
                modelOptions.length === 0
                  ? 'Loading once you fill in the API key…'
                  : 'Pick a model'
              }
            />
          </SelectTrigger>
          <SelectContent>
            {modelOptions.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFieldVisible(
  field: DescriptorField,
  values: Record<string, string>,
): boolean {
  if (!field.showWhen) return true;
  const driver = values[field.showWhen.field] ?? '';
  if (Array.isArray(field.showWhen.equals)) {
    return field.showWhen.equals.includes(driver);
  }
  return driver === field.showWhen.equals;
}

const PREFERENCE_PATTERNS: RegExp[] = [
  /claude-sonnet-4[._-]?6/i,
  /claude-sonnet-4[._-]?5/i,
  /claude-sonnet-4/i,
  /claude-.*sonnet-4/i,
  /gpt-5/i,
  /gpt-4o/i,
  /sonnet/i,
];

function pickPreferredModel(models: string[]): string {
  for (const re of PREFERENCE_PATTERNS) {
    const match = models.find((m) => re.test(m));
    if (match) return match;
  }
  return models[0] ?? '';
}

