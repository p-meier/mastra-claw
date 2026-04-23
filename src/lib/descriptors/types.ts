/**
 * Descriptor type system shared by the model-provider registry
 * (`src/lib/providers`) and the channel registry (`src/lib/channels`).
 *
 * Both subsystems describe a configurable subject (an LLM provider, an
 * ElevenLabs voice, a Telegram bot, a Slack workspace, …) the same way:
 * a list of input fields, a probe function that validates a candidate
 * value set, and metadata for the UI. The shared form component
 * `descriptor-config-form.tsx` and the shared server-action helpers
 * read this contract directly — that's how a single editor surface can
 * drive every provider and every channel without per-type code paths.
 */

/** All input field shapes the descriptor form component knows how to render. */
export type DescriptorFieldType =
  // Single-line secret. Rendered as <input type="password">. Stored in
  // Vault. Edit forms display a "•••••• stored" placeholder when a value
  // already exists; leaving the field blank means "keep the stored
  // value", entering anything means "replace it".
  | 'password'
  // Single-line non-secret. Stored in app_settings as a string.
  | 'text'
  // Single-line URL. Validated as URL on submit.
  | 'url'
  // Numeric input.
  | 'number'
  // Boolean toggle.
  | 'boolean'
  // Static dropdown. Requires `options`.
  | 'select'
  // Comma-separated list of strings rendered as a textarea or chip
  // input. Used for things like Discord `mentionRoleIds`.
  | 'string-array'
  // Multi-line input validated as JSON. Used for the Google Chat
  // service-account credentials blob.
  | 'json'
  // Empty dropdown that gets populated from a successful probe result.
  // Used for "pick the default text model" right after the LLM probe
  // returns the available model list.
  | 'model-select';

export type DescriptorFieldOption = {
  value: string;
  label: string;
};

export type DescriptorField = {
  /** Stable machine name; used as the storage key inside Vault / app_settings. */
  name: string;
  label: string;
  type: DescriptorFieldType;
  /**
   * Whether the field is required. The form refuses to submit if a
   * required field is empty AND no stored secret can fill the gap.
   */
  required: boolean;
  /**
   * Secret-vs-config split:
   *  - `true`  → value lives in Vault under
   *              `app:{namespace}:{descriptorId}:{fieldName}`
   *  - `false` → value lives in `app_settings` under the descriptor's
   *              JSON config row
   */
  secret: boolean;

  helpText?: string;
  helpUrl?: string;
  placeholder?: string;
  /**
   * Pre-fill the input with this value when no `initialNonSecretValues`
   * is supplied (i.e. when the admin is adding a new instance, not
   * editing an existing one). Use this for known-good defaults like the
   * standard ElevenLabs voice/model id so the admin can just click
   * Save instead of having to look them up.
   */
  defaultValue?: string;

  /** Static options when `type === 'select'`. */
  options?: DescriptorFieldOption[];

  /**
   * Conditional rendering. When set, the field is only shown — and only
   * counted as required — if the referenced field has one of the listed
   * values. Lets one descriptor switch its visible field set without
   * needing two separate descriptors.
   */
  showWhen?: { field: string; equals: string | string[] };

  /**
   * For `type === 'model-select'`: which list of probed models this
   * field pulls from. Image-video descriptors expose one field per
   * modality; everything else defaults to `'text'`. Ignored for any
   * other field type.
   */
  modelKind?: 'text' | 'embedding' | 'image' | 'video';
};

/**
 * Discriminated union returned by every probe. Successful probes may
 * carry extra payload that downstream form steps consume — e.g. the LLM
 * probe returns the available model list so the next step's
 * `model-select` field can be populated without a second round-trip.
 *
 * Probes never throw. They MUST catch all errors and return
 * `{ ok: false, error }` so the UI can render the message inline.
 */
export type ProbeResult<TExtra extends object = object> =
  | ({ ok: true; note?: string } & TExtra)
  | { ok: false; error: string };

/**
 * Optional probe payload fields shared across all descriptor types. A
 * concrete descriptor (provider, channel) can narrow this with its own
 * extension type if it needs more.
 */
export type DescriptorProbeExtras = {
  /** LLM model list, populated for text/image-video providers. */
  models?: string[];
  /** ElevenLabs voice count, populated for the TTS probe. */
  voiceCount?: number;
};

/**
 * Base descriptor — the contract every provider and channel implements.
 * The two subsystems extend this with their own specific fields
 * (`category` for providers, `buildAdapter` + `capabilities` for
 * channels).
 */
export type Descriptor = {
  /** Stable machine id. Used as a key in registries and storage paths. */
  id: string;
  displayName: string;
  /** Short marketing-style sentence. Used in selection dropdowns. */
  blurb: string;
  /** Optional badge ("Recommended", "Beta", "Coming soon"). */
  badge?: string;
  fields: DescriptorField[];
  /**
   * Pure validator. Receives the merged value map (the server-side
   * action layer pre-fills any secret fields the user left blank from
   * Vault before calling probe, so the descriptor sees the effective
   * config). May legitimately return `{ ok: true, note }` without
   * touching an external API for descriptors where a connectivity
   * check is impossible without a full OAuth dance — the form surfaces
   * the `note` so the admin understands the limited validation.
   */
  probe: (
    values: Record<string, unknown>,
  ) => Promise<ProbeResult<DescriptorProbeExtras>>;
};

/**
 * Per-field "is the secret already stored in Vault" indicator. The
 * server builds this for every edit form so the client can render
 * `"•••••• stored"` placeholders without ever seeing the secret value.
 */
export type SecretFieldStatus = Record<string, 'stored' | 'missing'>;
