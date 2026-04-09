'use client';

import { useState, useTransition } from 'react';

import { DescriptorCard } from '@/components/descriptors/descriptor-card';
import {
  DescriptorConfigForm,
  type DescriptorFormSubmitResult,
} from '@/components/descriptors/descriptor-config-form';
import {
  type AddOption,
  DescriptorSection,
} from '@/components/descriptors/descriptor-section';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  deleteChannelConfigAction,
  probeChannelAction,
  saveChannelConfigAction,
  toggleChannelVoiceAction,
} from '@/lib/channels/actions';

import type { SerializableField } from '@/components/providers/provider-category-section';

/**
 * Renders the Channels admin surface — one section listing every
 * channel descriptor in the registry. Configured channels show as
 * `DescriptorCard` instances; unconfigured channels appear as a single
 * "Add" entry under the section header dropdown.
 *
 * Each card has an inline voice toggle. The toggle is disabled when
 * either (a) the descriptor doesn't support voice or (b) no TTS
 * provider is currently active. The disabled-state hint comes from
 * `voiceAllowed`, supplied by the server page.
 */

export type ChannelInstanceProps = {
  id: string;
  displayName: string;
  blurb: string;
  fields: SerializableField[];
  config: Record<string, unknown>;
  secretFieldStatus: Record<string, 'stored' | 'missing'>;
  capabilities: {
    directMessage: boolean;
    mention: boolean;
    voice: boolean;
    requiresPublicWebhook: boolean;
  };
  voiceEnabled: boolean;
  webhookUrl: string | null;
};

export type AddableChannel = {
  id: string;
  displayName: string;
  blurb: string;
  fields: SerializableField[];
};

export type ChannelSectionProps = {
  configured: ChannelInstanceProps[];
  addable: AddableChannel[];
  /** True iff a TTS provider is currently active. */
  ttsAvailable: boolean;
};

export function ChannelSection({
  configured,
  addable,
  ttsAvailable,
}: ChannelSectionProps) {
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
          const result = await saveChannelConfigAction(option.id, values, {
            voiceEnabled: false,
          });
          if (result.ok) onClose();
          return result;
        }}
        onProbe={async (values) =>
          (await probeChannelAction(
            option.id,
            values,
          )) as DescriptorFormSubmitResult
        }
      />
    ),
  }));

  return (
    <DescriptorSection
      title="Channels"
      description="Messaging platforms the assistants can talk on. Each channel is configured globally; per-user routing happens under Connected Accounts."
      addOptions={addOptions}
    >
      {configured.length === 0 && (
        <p className="text-sm text-muted-foreground sm:col-span-2">
          No channel configured yet. Use the dropdown above to add one.
        </p>
      )}
      {configured.map((instance) => (
        <ConfiguredChannelCard
          key={instance.id}
          instance={instance}
          ttsAvailable={ttsAvailable}
        />
      ))}
    </DescriptorSection>
  );
}

function ConfiguredChannelCard({
  instance,
  ttsAvailable,
}: {
  instance: ChannelInstanceProps;
  ttsAvailable: boolean;
}) {
  const voiceUiDisabled = !instance.capabilities.voice || !ttsAvailable;
  const [voice, setVoice] = useState(instance.voiceEnabled);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onVoiceToggle(next: boolean): void {
    setVoiceError(null);
    setVoice(next);
    startTransition(async () => {
      const r = await toggleChannelVoiceAction(instance.id, next);
      if (!r.ok) {
        setVoiceError(r.error);
        setVoice(!next);
      }
    });
  }

  return (
    <DescriptorCard
      title={instance.displayName}
      description={instance.blurb}
      isActive
      showSetActive={false}
      inlineControls={
        <div className="flex flex-col gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          {instance.webhookUrl && (
            <div className="flex flex-col gap-0.5">
              <span className="font-medium">Webhook URL</span>
              <code className="block break-all rounded bg-muted px-1.5 py-1 font-mono text-[10px]">
                {instance.webhookUrl}
              </code>
              <span>
                Paste this into your {instance.displayName} app configuration.
              </span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`voice-${instance.id}`} className="cursor-pointer">
              Voice replies
              {voiceUiDisabled && (
                <span className="ml-1 text-[10px] text-muted-foreground">
                  ({!instance.capabilities.voice
                    ? 'not supported by this channel'
                    : 'no TTS provider active'})
                </span>
              )}
            </Label>
            <Switch
              id={`voice-${instance.id}`}
              checked={voice}
              disabled={voiceUiDisabled || pending}
              onCheckedChange={onVoiceToggle}
            />
          </div>
          {voiceError && (
            <span className="text-destructive">{voiceError}</span>
          )}
        </div>
      }
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
            const result = await saveChannelConfigAction(instance.id, values, {
              voiceEnabled: voice,
            });
            if (result.ok) onClose();
            return result;
          }}
          onProbe={async (values) =>
            (await probeChannelAction(
              instance.id,
              values,
            )) as DescriptorFormSubmitResult
          }
        />
      )}
      onDelete={async () => {
        const r = await deleteChannelConfigAction(instance.id);
        return r.ok ? { ok: true } : { ok: false, error: r.error };
      }}
    />
  );
}
