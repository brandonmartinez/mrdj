// Owner: Livingston (provider routing + fallback — #24)
// Wraps one or more MusicProviders behind the MusicProvider interface. The primary
// provider is tried first; on failure the next is used, so a provider outage degrades
// gracefully instead of surfacing a 5xx. Callers receive a unified Track[] regardless
// of which provider resolved it (A1).
import type { MusicProvider, Track } from './provider.js';

export class RoutingMusicProvider implements MusicProvider {
  readonly name = 'routing';
  private readonly providers: MusicProvider[];

  /** @param providers ordered primary → fallback(s); at least one required. */
  constructor(providers: MusicProvider[], private readonly onError?: (p: string, err: unknown) => void) {
    if (providers.length === 0) throw new Error('RoutingMusicProvider requires at least one provider');
    this.providers = providers;
  }

  async search(query: string, limit?: number, signal?: AbortSignal): Promise<Track[]> {
    return this.withFallback('search', (p) => p.search(query, limit, signal), signal);
  }

  async resolve(providerId: string, signal?: AbortSignal): Promise<Track | null> {
    return this.withFallback('resolve', (p) => p.resolve(providerId, signal), signal);
  }

  private async withFallback<T>(
    op: string,
    run: (p: MusicProvider) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let lastErr: unknown;
    for (const p of this.providers) {
      try {
        return await run(p);
      } catch (err) {
        if (signal?.aborted) throw err;
        lastErr = err;
        this.onError?.(p.name, err);
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`All music providers failed for ${op}`);
  }
}
