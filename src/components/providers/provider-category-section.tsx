'use client';

import { DescriptorCard } from '@/components/descriptors/descriptor-card';
import {
  DescriptorConfigForm,
  type DescriptorFormSubmitResult,
} from '@/components/descriptors/descriptor-config-form';
import {
  type AddOption,
  DescriptorSection,
} from '@/components/descriptors/descriptor-section';
import {
  deleteProviderConfigAction,
  probeProviderAction,
  saveProviderConfigAction,
  setActiveProviderAction,
} from '@/lib/providers/actions';
import type { ProviderCategory } from '@/lib/providers/registry';

/**
 * Renders one provider category (Text Model, Image & Video, TTS, STT)
 * — header with an "Add provider" picker, plus one card per
 * configured provider. All edit/save/probe/delete/set-active actions
 * route through `src/lib/providers/actions.ts`, which is the only
 * place that mutates Vault or `app_settings`.
 *
 * Data is hydrated server-side by the page (`/admin/settings`) and
 * passed in as plain JSON. Descriptors themselves are referenced by
 * id from the registry — they cannot cross the server/client boundary
 * because they contain server-only `probe` functions.
 */

export type ProviderInstanceProps = {
  id: string;
  displayName: string;
  blurb: string;
  isActive: boolean;
  config: Record<string, unknown>;
  secretFieldStatus: Record<string, 'stored' | 'missing'>;
  fields: SerializableField[];
};

export type SerializableField = {
  name: string;
  label: string;
  type:
    | 'password'
    | 'text'
    | 'url'
    | 'number'
    | 'boolean'
    | 'select'
    | 'string-array'
    | 'json'
    | 'model-select';
  required: boolean;
  secret: boolean;
  helpUrl?: string;
  helpText?: string;
  placeholder?: string;
  defaultValue?: string;
  options?: Array<{ value: string; label: string }>;
  showWhen?: { field: string; equals: string | string[] };
};

export type AddableProvider = {
  id: string;
  displayName: string;
  blurb: string;
  fields: SerializableField[];
};

export type ProviderCategorySectionProps = {
  category: ProviderCategory;
  title: string;
  description?: string;
  configured: ProviderInstanceProps[];
  addable: AddableProvider[];
};

export function ProviderCategorySection({
  category,
  title,
  description,
  configured,
  addable,
}: ProviderCategorySectionProps) {
  const addOptions: AddOption[] = addable.map((option) => ({
    id: option.id,
    label: option.displayName,
    renderForm: (onClose) => (
      <DescriptorConfigForm
        descriptor={{
          id: option.id,
          displayName: option.displayName,
          fields: option.fields,
        }}
        secretFieldStatus={{}}
        onSubmit={async (values) => {
          const result = await saveProviderConfigAction(
            category,
            option.id,
            values,
            { setActive: configured.length === 0 },
          );
          if (result.ok) onClose();
          return result;
        }}
        onProbe={async (values) =>
          (await probeProviderAction(
            category,
            option.id,
            values,
          )) as DescriptorFormSubmitResult
        }
      />
    ),
  }));

  return (
    <DescriptorSection
      title={title}
      description={description}
      addOptions={addOptions}
    >
      {configured.length === 0 && (
        <p className="text-sm text-muted-foreground sm:col-span-2">
          No provider configured yet. Use “Add provider” above.
        </p>
      )}
      {configured.map((instance) => (
        <DescriptorCard
          key={instance.id}
          title={instance.displayName}
          description={instance.blurb}
          isActive={instance.isActive}
          renderEditForm={(onClose) => (
            <DescriptorConfigForm
              descriptor={{
                id: instance.id,
                displayName: instance.displayName,
                fields: instance.fields,
              }}
              initialNonSecretValues={instance.config}
              secretFieldStatus={instance.secretFieldStatus}
              onSubmit={async (values) => {
                const result = await saveProviderConfigAction(
                  category,
                  instance.id,
                  values,
                  { setActive: instance.isActive },
                );
                if (result.ok) onClose();
                return result;
              }}
              onProbe={async (values) =>
                (await probeProviderAction(
                  category,
                  instance.id,
                  values,
                )) as DescriptorFormSubmitResult
              }
            />
          )}
          onSetActive={async () => {
            const r = await setActiveProviderAction(category, instance.id);
            return r.ok ? { ok: true } : { ok: false, error: r.error };
          }}
          onDelete={async () => {
            const r = await deleteProviderConfigAction(category, instance.id);
            return r.ok ? { ok: true } : { ok: false, error: r.error };
          }}
        />
      ))}
    </DescriptorSection>
  );
}
