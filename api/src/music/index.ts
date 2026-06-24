// Owner: Livingston (wire real providers here)
// To swap in a real provider: replace StubMusicProvider with an Apple Music or Spotify
// implementation of MusicProvider (see provider.ts TODO). No caller changes needed.
import type { Request, Response } from 'express';
import { StubMusicProvider } from './stub.js';

const musicProvider = new StubMusicProvider();

export async function searchTracksHandler(req: Request, res: Response) {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const results = await musicProvider.search(q);
  res.json({ results });
}
