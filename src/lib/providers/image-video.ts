import 'server-only';

import { createGateway } from '@ai-sdk/gateway';

import type {
  DescriptorProbeExtras,
  ProbeResult,
} from '@/lib/descriptors/types';

import type { ProviderDescriptor } from './registry';

/**
 * Image + Video model providers. The pattern is identical to text:
 * each entry is a single Vercel AI Gateway-compatible endpoint, plus
 * (later) Fal.ai and Krea.ai which both ship one combined image+video
 * surface per provider.
 *
 * Today only the Vercel AI Gateway is fully wired. Adding `fal` or
 * `krea` later means appending an entry here — no other code change.
 */

async function probeVercelGateway(
  apiKey: string,
): Promise<ProbeResult<DescriptorProbeExtras>> {
  if (!apiKey) return { ok: false, error: 'API key is empty' };
  try {
    const gateway = createGateway({ apiKey });
    const meta = await gateway.getAvailableModels();
    // Spiegelbild des Filters in `text.ts`: hier nur Image- und
    // Video-Modelle durchlassen, damit der Picker für die
    // `image-video`-Kategorie nicht plötzlich GPT-4 oder ein
    // Embedding-Modell anzeigt.
    const models = meta.models
      .filter((m) => m.modelType === 'image' || m.modelType === 'video')
      .map((m) => m.id);
    if (models.length === 0) {
      return {
        ok: false,
        error: 'Connected, but no image or video models returned. Check your API access tier.',
      };
    }
    return { ok: true, models };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Vercel AI Gateway connection failed: ${msg}` };
  }
}

export const IMAGE_VIDEO_PROVIDERS: ProviderDescriptor[] = [
  {
    id: 'vercel-gateway',
    category: 'image-video',
    displayName: 'Vercel AI Gateway',
    badge: 'Recommended',
    blurb:
      'Same gateway as the text provider — image and video generation through one key.',
    fields: [
      {
        name: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true,
        helpUrl: 'https://vercel.com/dashboard/ai-gateway',
        helpText:
          'You can reuse the same key configured for the text provider — they are interchangeable.',
      },
    ],
    probe: async (values) => probeVercelGateway(String(values.apiKey ?? '')),
  },
];
