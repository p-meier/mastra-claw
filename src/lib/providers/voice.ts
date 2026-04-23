import 'server-only';

import { DEFAULTS } from '@/lib/defaults';
import type {
  DescriptorProbeExtras,
  ProbeResult,
} from '@/lib/descriptors/types';

import type { ProviderDescriptor } from './registry';

/**
 * Voice providers — Text-to-Speech AND Speech-to-Text in one package.
 *
 * MastraClaw deliberately only carries providers that do BOTH directions
 * (synthesis + recognition). The admin configures one descriptor and
 * gets the full voice round-trip — no separate "TTS provider" and "STT
 * provider" to keep in sync.
 *
 * Today shipped:
 *
 *  - ElevenLabs — `eleven_v3` for synthesis, `scribe_v1` for recognition.
 *
 * On the roadmap (each adds a single descriptor in this file with no
 * other code change):
 *
 *  - OpenAI (`gpt-4o-mini-tts` + `whisper-1`)
 *  - Deepgram (Aura + Nova)
 *  - Azure Speech
 *  - Google Cloud Speech
 */

async function probeElevenlabs(
  apiKey: string,
): Promise<ProbeResult<DescriptorProbeExtras>> {
  if (!apiKey) return { ok: false, error: 'API key is empty' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/voices', {
        method: 'GET',
        headers: { 'xi-api-key': apiKey },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        return {
          ok: false,
          error: `ElevenLabs returned HTTP ${res.status}`,
        };
      }
      const json = (await res.json()) as { voices?: unknown[] };
      return {
        ok: true,
        voiceCount: Array.isArray(json.voices) ? json.voices.length : 0,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `ElevenLabs connection failed: ${msg}` };
  }
}

export const VOICE_PROVIDERS: ProviderDescriptor[] = [
  {
    id: 'elevenlabs',
    category: 'voice',
    displayName: 'ElevenLabs',
    badge: 'Recommended',
    blurb:
      'High-quality multilingual voice synthesis (eleven_v3) and speech recognition (Scribe v2). One key, both directions.',
    fields: [
      {
        name: 'apiKey',
        label: 'API key',
        type: 'password',
        required: true,
        secret: true,
        helpUrl: 'https://elevenlabs.io/app/settings/api-keys',
      },
      {
        name: 'voiceId',
        label: 'Default voice ID',
        type: 'text',
        required: true,
        secret: false,
        defaultValue: DEFAULTS.elevenlabs.voiceId,
        helpText:
          'Pre-filled with the MastraClaw default voice. Override with any voice id from the ElevenLabs Voice Library.',
      },
      {
        name: 'ttsModelId',
        label: 'Text-to-Speech model',
        type: 'text',
        required: true,
        secret: false,
        defaultValue: DEFAULTS.elevenlabs.ttsModelId,
        helpText:
          'TTS model id used for voice replies (e.g. `eleven_v3`, `eleven_multilingual_v2`).',
      },
      {
        name: 'sttModelId',
        label: 'Speech-to-Text model',
        type: 'text',
        required: true,
        secret: false,
        defaultValue: DEFAULTS.elevenlabs.sttModelId,
        helpText:
          'Recognition model id used for incoming voice messages. Pre-filled with `scribe_v2`, ElevenLabs’ latest Scribe model.',
      },
    ],
    probe: async (values) => probeElevenlabs(String(values.apiKey ?? '')),
  },
];
