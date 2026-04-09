import 'server-only';

import type { Descriptor } from '@/lib/descriptors/types';

import { IMAGE_VIDEO_PROVIDERS } from './image-video';
import { TEXT_PROVIDERS } from './text';
import { VOICE_PROVIDERS } from './voice';

/**
 * Provider registry — the closed set of model providers MastraClaw knows
 * how to talk to. Adding a new provider means adding a descriptor to one
 * of the per-category files; no other code change is needed for the
 * admin UI to render it, the wizard to offer it, or the runtime to
 * instantiate it.
 *
 * Categories after the voice consolidation:
 *
 *   - `text`         — LLM for chat / agent reasoning
 *   - `image-video`  — image and video generation
 *   - `voice`        — combined Text-to-Speech *and* Speech-to-Text. We
 *                      only carry providers that do both (ElevenLabs,
 *                      OpenAI, …) so the admin doesn't have to wire up
 *                      two services for one feature. Each descriptor
 *                      collects both sets of fields (voice id, TTS
 *                      model, STT model) under one configuration.
 */

export type ProviderCategory = 'text' | 'image-video' | 'voice';

export type ProviderDescriptor = Descriptor & {
  category: ProviderCategory;
};

export const PROVIDER_CATEGORIES: readonly ProviderCategory[] = [
  'text',
  'image-video',
  'voice',
] as const;

const ALL_PROVIDERS: ProviderDescriptor[] = [
  ...TEXT_PROVIDERS,
  ...IMAGE_VIDEO_PROVIDERS,
  ...VOICE_PROVIDERS,
];

export function getProvider(
  category: ProviderCategory,
  id: string,
): ProviderDescriptor | undefined {
  return ALL_PROVIDERS.find((p) => p.category === category && p.id === id);
}

export function getProvidersByCategory(
  category: ProviderCategory,
): ProviderDescriptor[] {
  return ALL_PROVIDERS.filter((p) => p.category === category);
}

export function listAllProviders(): ProviderDescriptor[] {
  return [...ALL_PROVIDERS];
}

/** Friendly title shown in section headers and dropdowns. */
export function categoryTitle(category: ProviderCategory): string {
  switch (category) {
    case 'text':
      return 'Text Model';
    case 'image-video':
      return 'Image & Video';
    case 'voice':
      return 'Voice (Speech ↔ Text)';
  }
}

/** Vault namespace for credentials of a given category. */
export function providerSecretNamespace(category: ProviderCategory): string {
  return `provider:${category}`;
}
