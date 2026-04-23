import 'server-only';

/**
 * Model factories — construct concrete AI-SDK models from the active
 * provider stored in `platform_settings`.
 *
 * Agents never hardcode a provider id or touch a Vault key. They call
 * `buildTextModel(supabase)` (optionally with an override model id)
 * and receive a ready-to-use `MastraModelConfig`. Admin changes to the
 * active provider propagate within the TTL (`CACHE_TTL_MS`) without a
 * restart.
 *
 * Provider vocabulary matches `src/lib/providers/text.ts` — whenever a
 * new provider descriptor is added there, add the matching construction
 * branch in `constructTextModel` below.
 *
 * There is deliberately no `process.env` fallback — reading LLM keys
 * from env would violate the "never assign API keys into process.env /
 * never read LLM keys from env" rule in `CLAUDE.md`. When no provider
 * is configured we throw `AppNotConfiguredError` and the admin setup
 * wizard takes the user through picking one.
 */

import type { MastraModelConfig } from '@mastra/core/llm';
import type { MastraEmbeddingModel } from '@mastra/core/vector';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGateway } from '@ai-sdk/gateway';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import { AppNotConfiguredError } from '@/mastra/lib/llm-credentials';

import { getActiveProvider } from './read';

// Derive image/video return types from the gateway itself so this file
// doesn't need a direct dep on `@ai-sdk/provider`.
type GatewayProvider = ReturnType<typeof createGateway>;
export type ImageModel = ReturnType<GatewayProvider['imageModel']>;
export type VideoModel = ReturnType<GatewayProvider['videoModel']>;

// ───────────────────────────────────────────────────────────────────────────
// TTL cache
// ───────────────────────────────────────────────────────────────────────────
//
// 30-second window keeps per-call latency low (three Supabase round-trips
// saved per agent invocation) while letting admin-UI edits settle
// without a restart.

const CACHE_TTL_MS = 30_000;

type CacheEntry<T> = { value: T; expiresAt: number };

const textModelCache: Map<string, CacheEntry<MastraModelConfig>> = new Map();
const embeddingModelCache: Map<string, CacheEntry<MastraEmbeddingModel<string>>> =
  new Map();
const imageModelCache: Map<string, CacheEntry<ImageModel>> = new Map();
const videoModelCache: Map<string, CacheEntry<VideoModel>> = new Map();

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ───────────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────────

export interface BuildTextModelOptions {
  /**
   * Override the active provider's model id. Useful for agents that
   * need a specific tier (e.g. a fast classifier on the same provider)
   * without changing admin settings. Takes precedence over `variant`.
   */
  modelOverride?: string;
  /**
   * Which admin-configured model slot to use:
   * - `'primary'` (default) — `active.config.defaultModel`, used for
   *   chat and agent reasoning.
   * - `'secondary'` — `active.config.secondaryModel`, intended for
   *   lightweight internal calls (title generation, summaries). Falls
   *   back to the primary model when the secondary slot is empty.
   */
  variant?: 'primary' | 'secondary';
}

export async function buildTextModel(
  supabase: SupabaseClient,
  opts?: BuildTextModelOptions,
): Promise<MastraModelConfig> {
  const variant = opts?.variant ?? 'primary';
  const cacheKey = `${variant}:${opts?.modelOverride ?? '(active)'}`;
  const cached = getCached(textModelCache, cacheKey);
  if (cached) return cached;

  const active = await getActiveProvider(supabase, 'text');
  if (!active) {
    throw new AppNotConfiguredError('text provider');
  }

  const primary =
    typeof active.config.defaultModel === 'string'
      ? active.config.defaultModel
      : undefined;
  const secondary =
    typeof active.config.secondaryModel === 'string' &&
    active.config.secondaryModel.length > 0
      ? active.config.secondaryModel
      : undefined;
  const modelId =
    opts?.modelOverride ??
    (variant === 'secondary' ? secondary ?? primary : primary);
  if (!modelId) {
    throw new Error(
      `[build:text] active provider "${active.id}" has no defaultModel configured. ` +
        `Set one at /admin/settings or pass opts.modelOverride.`,
    );
  }
  const model = constructTextModel(active.id, active.config, active.secrets, modelId);
  setCached(textModelCache, cacheKey, model);
  return model;
}

export interface BuildEmbeddingModelOptions {
  /** Override the active provider's `defaultModel`. */
  modelOverride?: string;
}

export async function buildEmbeddingModel(
  supabase: SupabaseClient,
  opts?: BuildEmbeddingModelOptions,
): Promise<MastraEmbeddingModel<string>> {
  const cacheKey = opts?.modelOverride ?? '(active)';
  const cached = getCached(embeddingModelCache, cacheKey);
  if (cached) return cached;

  const active = await getActiveProvider(supabase, 'embedding');
  if (!active) {
    throw new Error(
      '[build:embedding] no active embedding provider configured. ' +
        'Pick one at /admin/settings → Embedding Model before enabling ' +
        'semantic recall or any RAG workflow.',
    );
  }

  const modelId =
    opts?.modelOverride ??
    (typeof active.config.defaultModel === 'string'
      ? active.config.defaultModel
      : undefined);
  if (!modelId) {
    throw new Error(
      `[build:embedding] active provider "${active.id}" has no defaultModel configured. ` +
        `Set one at /admin/settings or pass opts.modelOverride.`,
    );
  }

  const model = constructEmbeddingModel(
    active.id,
    active.config,
    active.secrets,
    modelId,
  );
  setCached(embeddingModelCache, cacheKey, model);
  return model;
}

export interface BuildImageModelOptions {
  /** Override the active provider's `imageModel`. */
  modelOverride?: string;
}

export async function buildImageModel(
  supabase: SupabaseClient,
  opts?: BuildImageModelOptions,
): Promise<ImageModel> {
  const cacheKey = opts?.modelOverride ?? '(active)';
  const cached = getCached(imageModelCache, cacheKey);
  if (cached) return cached;

  const active = await getActiveProvider(supabase, 'image-video');
  if (!active) {
    throw new Error(
      '[build:image] no active image-video provider configured. ' +
        'Pick one at /admin/settings → Image & Video before generating images.',
    );
  }

  const modelId =
    opts?.modelOverride ??
    (typeof active.config.imageModel === 'string'
      ? active.config.imageModel
      : undefined);
  if (!modelId) {
    throw new Error(
      `[build:image] active provider "${active.id}" has no imageModel configured. ` +
        `Set one at /admin/settings or pass opts.modelOverride.`,
    );
  }

  const model = constructImageModel(active.id, active.secrets, modelId);
  setCached(imageModelCache, cacheKey, model);
  return model;
}

export interface BuildVideoModelOptions {
  /** Override the active provider's `videoModel`. */
  modelOverride?: string;
}

export async function buildVideoModel(
  supabase: SupabaseClient,
  opts?: BuildVideoModelOptions,
): Promise<VideoModel> {
  const cacheKey = opts?.modelOverride ?? '(active)';
  const cached = getCached(videoModelCache, cacheKey);
  if (cached) return cached;

  const active = await getActiveProvider(supabase, 'image-video');
  if (!active) {
    throw new Error(
      '[build:video] no active image-video provider configured. ' +
        'Pick one at /admin/settings → Image & Video before generating video.',
    );
  }

  const modelId =
    opts?.modelOverride ??
    (typeof active.config.videoModel === 'string'
      ? active.config.videoModel
      : undefined);
  if (!modelId) {
    throw new Error(
      `[build:video] active provider "${active.id}" has no videoModel configured. ` +
        `Set one at /admin/settings or pass opts.modelOverride.`,
    );
  }

  const model = constructVideoModel(active.id, active.secrets, modelId);
  setCached(videoModelCache, cacheKey, model);
  return model;
}

/**
 * Invalidate the model caches immediately (exposed for admin actions
 * that want sub-TTL propagation, e.g. after a provider switch).
 */
export function clearBuildCache(): void {
  textModelCache.clear();
  embeddingModelCache.clear();
  imageModelCache.clear();
  videoModelCache.clear();
}

// ───────────────────────────────────────────────────────────────────────────
// Provider construction
// ───────────────────────────────────────────────────────────────────────────

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

function constructTextModel(
  id: string,
  config: Record<string, unknown>,
  secrets: Record<string, string>,
  modelId: string,
): MastraModelConfig {
  const apiKey = secrets.apiKey;

  switch (id) {
    case 'openai':
      if (!apiKey) throw new Error('[build:text] openai provider requires an apiKey secret');
      return createOpenAI({ apiKey })(modelId);

    case 'anthropic':
      if (!apiKey) throw new Error('[build:text] anthropic provider requires an apiKey secret');
      return createAnthropic({ apiKey })(modelId);

    case 'vercel-gateway':
      if (!apiKey) throw new Error('[build:text] vercel-gateway provider requires an apiKey secret');
      return createGateway({ apiKey }).languageModel(modelId);

    case 'openrouter': {
      if (!apiKey) throw new Error('[build:text] openrouter provider requires an apiKey secret');
      const openrouter = createOpenAICompatible({
        name: 'openrouter',
        baseURL: OPENROUTER_BASE_URL,
        apiKey,
      });
      return openrouter(modelId);
    }

    case 'custom': {
      if (!apiKey) throw new Error('[build:text] custom provider requires an apiKey secret');
      const baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl : undefined;
      if (!baseUrl) {
        throw new Error('[build:text] custom provider requires a baseUrl in config');
      }
      const custom = createOpenAICompatible({
        name: 'custom',
        baseURL: baseUrl,
        apiKey,
      });
      return custom(modelId);
    }

    default:
      throw new Error(
        `[build:text] unknown provider id "${id}". ` +
          `Add a construction branch in src/lib/platform-providers/build.ts.`,
      );
  }
}

function constructEmbeddingModel(
  id: string,
  config: Record<string, unknown>,
  secrets: Record<string, string>,
  modelId: string,
): MastraEmbeddingModel<string> {
  const apiKey = secrets.apiKey;

  switch (id) {
    case 'openai':
      if (!apiKey) throw new Error('[build:embedding] openai provider requires an apiKey secret');
      return createOpenAI({ apiKey }).textEmbeddingModel(modelId);

    case 'vercel-gateway':
      if (!apiKey) throw new Error('[build:embedding] vercel-gateway provider requires an apiKey secret');
      return createGateway({ apiKey }).textEmbeddingModel(modelId);

    case 'custom': {
      if (!apiKey) throw new Error('[build:embedding] custom provider requires an apiKey secret');
      const baseUrl = typeof config.baseUrl === 'string' ? config.baseUrl : undefined;
      if (!baseUrl) {
        throw new Error('[build:embedding] custom provider requires a baseUrl in config');
      }
      return createOpenAICompatible({
        name: 'custom',
        baseURL: baseUrl,
        apiKey,
      }).textEmbeddingModel(modelId);
    }

    case 'anthropic':
      throw new Error(
        '[build:embedding] Anthropic does not offer embedding models. ' +
          'Pick a different provider for the Embedding category.',
      );

    case 'openrouter':
      throw new Error(
        '[build:embedding] OpenRouter does not front embedding endpoints. ' +
          'Pick OpenAI, Vercel AI Gateway, or a custom OpenAI-compatible endpoint.',
      );

    default:
      throw new Error(
        `[build:embedding] unknown provider id "${id}". ` +
          `Add a construction branch in src/lib/platform-providers/build.ts.`,
      );
  }
}

function constructImageModel(
  id: string,
  secrets: Record<string, string>,
  modelId: string,
): ImageModel {
  const apiKey = secrets.apiKey;

  switch (id) {
    case 'vercel-gateway':
      if (!apiKey)
        throw new Error('[build:image] vercel-gateway provider requires an apiKey secret');
      return createGateway({ apiKey }).imageModel(modelId);

    default:
      throw new Error(
        `[build:image] unknown provider id "${id}". ` +
          `Add a construction branch in src/lib/platform-providers/build.ts.`,
      );
  }
}

function constructVideoModel(
  id: string,
  secrets: Record<string, string>,
  modelId: string,
): VideoModel {
  const apiKey = secrets.apiKey;

  switch (id) {
    case 'vercel-gateway':
      if (!apiKey)
        throw new Error('[build:video] vercel-gateway provider requires an apiKey secret');
      return createGateway({ apiKey }).videoModel(modelId);

    default:
      throw new Error(
        `[build:video] unknown provider id "${id}". ` +
          `Add a construction branch in src/lib/platform-providers/build.ts.`,
      );
  }
}
