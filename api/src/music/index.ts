// Owner: Livingston (wire real providers here)
// Builds the active MusicProvider from config and exposes the search handler.
// Default (MUSIC_PROVIDER=itunes) needs no credentials. The active provider is
// wrapped in a RoutingMusicProvider with the seeded stub as a graceful fallback,
// so a provider outage degrades to local results instead of a 5xx (#24).
import type { Request, Response } from 'express';
import { cfg } from '../config/index.js';
import type { MusicProvider } from './provider.js';
import { StubMusicProvider } from './stub.js';
import { ITunesMusicProvider } from './itunes.js';
import { SpotifyMusicProvider } from './spotify.js';
import { AppleMusicProvider } from './apple.js';
import { RoutingMusicProvider } from './router.js';

/** Construct a single provider by key. Scaffolds fail-fast if their env is missing. */
export function createMusicProvider(name: string = cfg.musicProvider): MusicProvider {
  switch (name) {
    case 'itunes':  return new ITunesMusicProvider();
    case 'spotify': return new SpotifyMusicProvider();
    case 'apple':   return new AppleMusicProvider();
    case 'stub':    return new StubMusicProvider();
    default:
      throw new Error(`Unknown MUSIC_PROVIDER '${name}'`);
  }
}

let provider: MusicProvider | null = null;

/** Lazily build the routed provider (active → stub fallback). */
export function getMusicProvider(): MusicProvider {
  if (provider) return provider;
  const active = createMusicProvider();
  // Stub-only mode shouldn't double-wrap; otherwise add stub as the fallback tier.
  provider = active.name === 'stub'
    ? active
    : new RoutingMusicProvider([active, new StubMusicProvider()], (p, err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[music] provider '${p}' failed, falling back: ${msg}`);
      });
  return provider;
}

/** Test/seam hook to inject a provider. */
export function setMusicProvider(p: MusicProvider | null): void {
  provider = p;
}

export async function searchTracksHandler(req: Request, res: Response) {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const results = await getMusicProvider().search(q);
  res.json({ results });
}
