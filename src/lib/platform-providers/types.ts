/**
 * Shared provider types. Imported by the admin UI / server actions AND
 * by agent code inside `src/mastra/`. No runtime dependencies beyond
 * plain TS — this module must stay importable from both Next.js RSC
 * and the Mastra runtime.
 */

export type ProviderCategory = 'text' | 'image-video' | 'voice' | 'embedding';

export const PROVIDER_CATEGORIES: readonly ProviderCategory[] = [
  'text',
  'image-video',
  'voice',
  'embedding',
] as const;

export type DescriptorFieldType =
  | 'password'
  | 'text'
  | 'url'
  | 'number'
  | 'boolean'
  | 'select'
  | 'string-array'
  | 'json'
  | 'model-select';

export type DescriptorFieldOption = {
  value: string;
  label: string;
};

/**
 * Which list of probed models a `model-select` field should pull from.
 * Image-video descriptors expose one field per modality; everything else
 * defaults to `'text'`.
 */
export type ModelKind = 'text' | 'image' | 'video' | 'embedding';

/**
 * Plain, crossable-boundary shape of a descriptor field. The server-only
 * `Descriptor` type (in `src/lib/descriptors/types.ts`) extends this
 * with the probe function, which cannot cross into a client component.
 */
export type SerializableDescriptorField = {
  name: string;
  label: string;
  type: DescriptorFieldType;
  required: boolean;
  secret: boolean;
  helpText?: string;
  helpUrl?: string;
  placeholder?: string;
  defaultValue?: string;
  options?: DescriptorFieldOption[];
  showWhen?: { field: string; equals: string | string[] };
  /** Only meaningful for `type: 'model-select'`. Defaults to `'text'`. */
  modelKind?: ModelKind;
};

export type DescriptorProbeExtras = {
  /** Flat list for single-modality probes (text / embedding / voice / custom). */
  models?: string[];
  /** Image-video probes return modality-scoped lists. */
  imageModels?: string[];
  videoModels?: string[];
  voiceCount?: number;
};

export type ProbeResult<TExtra extends object = object> =
  | ({ ok: true; note?: string } & TExtra)
  | { ok: false; error: string };

export type SecretFieldStatus = Record<string, 'stored' | 'missing'>;

export type ResolvedProviderCategory = {
  /** Active provider for this category, or null until the wizard activates one. */
  active: {
    id: string;
    config: Record<string, unknown>;
  } | null;
  /** All provider ids that have a stored config row in this category. */
  configured: string[];
};

/**
 * Returned by `getActiveProvider(supabase, category)`. The secrets map is
 * keyed by descriptor-field `name` (e.g. `apiKey`). Empty map means the
 * provider has no secret fields configured (valid for providers whose
 * descriptors declare no `secret: true` fields).
 */
export type ActiveProvider = {
  id: string;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
};
