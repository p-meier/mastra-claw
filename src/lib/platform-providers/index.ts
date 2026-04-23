/**
 * Barrel re-exports for the platform-providers subsystem. Agents and
 * server actions should import from `@/lib/platform-providers` rather
 * than reaching into the concrete files.
 */

export * from './types';
export { getActiveProvider, getProviderSecret } from './read';
export {
  type BuildEmbeddingModelOptions,
  type BuildImageModelOptions,
  type BuildTextModelOptions,
  type BuildVideoModelOptions,
  type ImageModel,
  type VideoModel,
  buildEmbeddingModel,
  buildImageModel,
  buildTextModel,
  buildVideoModel,
  clearBuildCache,
} from './build';
