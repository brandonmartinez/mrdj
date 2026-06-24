// Owner: Livingston (wire real providers here)
import type { Request, Response } from 'express';
import { StubMusicProvider } from './stub.js';

const musicProvider = new StubMusicProvider();

export async function searchTracksHandler(req: Request, res: Response) {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const results = await musicProvider.search(q);
  res.json({ results });
}
