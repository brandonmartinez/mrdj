/**
 * Epic 5 (#9) — Music provider integration tests (VCR via nock).
 *
 * Replays recorded iTunes Search API fixtures so CI runs with NO network:
 *   - iTunes search → normalized Track[] + DB upsert (#22)
 *   - iTunes resolve via TTL cache; stale → re-resolve (#27)
 *   - fetchWithBackoff: 429/503 retry + Retry-After (#22)
 *   - RoutingMusicProvider primary→fallback (#24)
 *   - Spotify client-credentials token manager (#19, scaffold)
 *   - Apple MusicKit developer-token builder (#16, scaffold)
 *
 * Re-record fixtures: see api/src/music/README.md.
 *
 * Run: npm test -w api
 */
import { describe, it, beforeAll, afterEach, afterAll, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVerify, generateKeyPairSync, type KeyObject } from 'node:crypto';
import nock from 'nock';
import { eq } from 'drizzle-orm';

import { db, tracks } from '../db/index.js';
import { fetchWithBackoff } from '../music/http.js';
import { ITunesMusicProvider } from '../music/itunes.js';
import { RoutingMusicProvider } from '../music/router.js';
import { SpotifyTokenManager } from '../music/spotify.js';
import { buildAppleDeveloperToken, AppleDeveloperTokenManager } from '../music/apple.js';
import type { MusicProvider, Track } from '../music/provider.js';
import { upsertTrack, findCachedByProviderId, isStale } from '../music/cache.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = (name: string) =>
  JSON.parse(readFileSync(resolve(__dirname, 'fixtures/music', name), 'utf8'));

const ITUNES = 'https://itunes.apple.com';
const noSleep = async () => {};

async function clearItunes() {
  await db.delete(tracks).where(eq(tracks.provider, 'itunes'));
}

beforeAll(() => {
  nock.disableNetConnect();
});
afterEach(() => {
  nock.cleanAll();
});
afterAll(async () => {
  nock.enableNetConnect();
  await clearItunes();
});

// ── fetchWithBackoff (#22 rate-limit/backoff) ──────────────────────────────────
describe('fetchWithBackoff', () => {
  it('retries on 429 then succeeds', async () => {
    nock(ITUNES).get('/ping').reply(429, '', { 'retry-after': '0' });
    nock(ITUNES).get('/ping').reply(200, { ok: true });

    const res = await fetchWithBackoff(`${ITUNES}/ping`, undefined, { sleep: noSleep });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(nock.isDone()).toBe(true);
  });

  it('retries on 503 and gives up returning the last response', async () => {
    nock(ITUNES).get('/down').times(4).reply(503);
    const res = await fetchWithBackoff(`${ITUNES}/down`, undefined, { maxAttempts: 4, sleep: noSleep });
    expect(res.status).toBe(503);
  });

  it('does not retry a non-retryable 404', async () => {
    const scope = nock(ITUNES).get('/missing').reply(404);
    const res = await fetchWithBackoff(`${ITUNES}/missing`, undefined, { sleep: noSleep });
    expect(res.status).toBe(404);
    expect(scope.isDone()).toBe(true);
  });
});

// ── iTunes search + cache (#22) ────────────────────────────────────────────────
describe('ITunesMusicProvider.search', () => {
  const provider = new ITunesMusicProvider({ backoff: { sleep: noSleep } });

  afterEach(clearItunes);

  it('normalizes iTunes results to Track and caches them', async () => {
    nock(ITUNES).get('/search').query(true).reply(200, FIX('itunes-search-daftpunk.json'));

    const results = await provider.search('daft punk', 3);
    expect(results.length).toBe(3);

    const first = results[0];
    expect(first.provider).toBe('itunes');
    expect(first.title).toBeTruthy();
    expect(first.artist).toBeTruthy();
    expect(first.durationMs).toBeGreaterThan(0);
    // Internal UUID assigned by the cache so queue requests can resolve it.
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    // Artwork upscaled past the 100x100 iTunes default.
    expect(first.artworkUrl).toMatch(/\/\d{3,}x\d{3,}bb\.(jpg|png)$/);

    // Row persisted under provider='itunes'.
    const [row] = await db.select().from(tracks).where(eq(tracks.id, first.id));
    expect(row.provider).toBe('itunes');
    expect(row.providerId).toBe(first.providerId);
  });

  it('upserts idempotently — same providerId keeps one row and refreshes it', async () => {
    nock(ITUNES).get('/search').query(true).reply(200, FIX('itunes-search-daftpunk.json'));
    const first = await provider.search('daft punk', 3);

    nock(ITUNES).get('/search').query(true).reply(200, FIX('itunes-search-daftpunk.json'));
    const second = await provider.search('daft punk', 3);

    expect(second[0].id).toBe(first[0].id); // stable id (queue refs survive)
    const rows = await db.select().from(tracks).where(eq(tracks.provider, 'itunes'));
    expect(rows.length).toBe(3); // no duplicates
  });
});

// ── iTunes resolve + TTL cache (#27) ───────────────────────────────────────────
describe('ITunesMusicProvider.resolve (TTL cache)', () => {
  const provider = new ITunesMusicProvider({ backoff: { sleep: noSleep } });
  afterEach(clearItunes);

  it('fetches on cache miss, then serves fresh cache without a second network call', async () => {
    nock(ITUNES).get('/lookup').query(true).reply(200, FIX('itunes-lookup-onemoretime.json'));
    const t1 = await provider.resolve('697195462');
    expect(t1?.providerId).toBe('697195462');
    expect(t1?.previewUrl).toBeTruthy();

    // No interceptor registered → if it hit the network, nock would throw.
    const t2 = await provider.resolve('697195462');
    expect(t2?.id).toBe(t1?.id);
  });

  it('re-resolves when the cache entry is stale, preserving the row id', async () => {
    nock(ITUNES).get('/lookup').query(true).reply(200, FIX('itunes-lookup-onemoretime.json'));
    const fresh = await provider.resolve('697195462');

    // Force staleness by backdating cachedAt well past the default TTL.
    await db.update(tracks)
      .set({ cachedAt: new Date(Date.now() - 1000 * 60 * 60 * 48) })
      .where(eq(tracks.id, fresh!.id));

    const cached = await findCachedByProviderId('itunes', '697195462');
    expect(isStale(cached!.cachedAt)).toBe(true);

    nock(ITUNES).get('/lookup').query(true).reply(200, FIX('itunes-lookup-onemoretime.json'));
    const reresolved = await provider.resolve('697195462');
    expect(reresolved!.id).toBe(fresh!.id); // same row → queue references intact
    expect(nock.isDone()).toBe(true);       // network was hit again
  });

  it('falls back to the stale cached row if the provider returns nothing', async () => {
    await upsertTrack({
      provider: 'itunes', providerId: '999', title: 'Old', artist: 'A', album: 'B',
      artworkUrl: '', durationMs: 1000, previewUrl: 'https://x/p.m4a',
    });
    await db.update(tracks)
      .set({ cachedAt: new Date(Date.now() - 1000 * 60 * 60 * 48) })
      .where(eq(tracks.providerId, '999'));

    nock(ITUNES).get('/lookup').query(true).reply(200, { resultCount: 0, results: [] });
    const t = await provider.resolve('999');
    expect(t?.title).toBe('Old'); // served stale instead of failing
  });
});

// ── Routing + fallback (#24) ───────────────────────────────────────────────────
describe('RoutingMusicProvider', () => {
  const fakeTrack: Track = {
    id: 'x', provider: 'fallback', providerId: 'p', title: 'Fallback Song',
    artist: 'A', album: 'B', artworkUrl: '', durationMs: 1000, previewUrl: null,
  };
  const failing: MusicProvider = {
    name: 'primary',
    search: async () => { throw new Error('provider down'); },
    resolve: async () => { throw new Error('provider down'); },
  };
  const healthy: MusicProvider = {
    name: 'fallback',
    search: async () => [fakeTrack],
    resolve: async () => fakeTrack,
  };

  it('returns primary results when primary succeeds', async () => {
    const r = new RoutingMusicProvider([healthy, failing]);
    expect((await r.search('q'))[0].title).toBe('Fallback Song');
  });

  it('falls back to the next provider when primary throws', async () => {
    const errors: string[] = [];
    const r = new RoutingMusicProvider([failing, healthy], (p) => errors.push(p));
    const res = await r.search('q');
    expect(res[0].title).toBe('Fallback Song');
    expect(errors).toContain('primary');
  });

  it('throws when every provider fails', async () => {
    const r = new RoutingMusicProvider([failing, { ...failing, name: 'p2' }]);
    await expect(r.search('q')).rejects.toThrow('provider down');
  });
});

// ── Spotify client-credentials token manager (#19, scaffold) ───────────────────
describe('SpotifyTokenManager', () => {
  const SPOTIFY = 'https://accounts.spotify.com';

  it('fetches and caches an app token', async () => {
    nock(SPOTIFY).post('/api/token').reply(200, {
      access_token: 'tok-abc', token_type: 'Bearer', expires_in: 3600,
    });
    const mgr = new SpotifyTokenManager('id', 'secret');
    expect(await mgr.getToken()).toBe('tok-abc');
    // Cached: second call makes no request (no interceptor → would throw if it did).
    expect(await mgr.getToken()).toBe('tok-abc');
  });

  it('fails fast without credentials', () => {
    expect(() => new SpotifyTokenManager('', '')).toThrow(/SPOTIFY_CLIENT_ID/);
  });
});

// ── Apple MusicKit developer token (#16, scaffold) ─────────────────────────────
describe('Apple MusicKit developer token', () => {
  let priv: KeyObject;
  let pub: KeyObject;
  let pem: string;

  beforeAll(() => {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    priv = pair.privateKey;
    pub  = pair.publicKey;
    pem  = priv.export({ type: 'pkcs8', format: 'pem' }) as string;
  });

  function joseToDer(sig: Buffer): Buffer {
    const r = sig.subarray(0, 32);
    const s = sig.subarray(32, 64);
    const enc = (b: Buffer) => {
      let v = b;
      let i = 0;
      while (i < v.length - 1 && v[i] === 0) i++;
      v = v.subarray(i);
      if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0]), v]);
      return Buffer.concat([Buffer.from([0x02, v.length]), v]);
    };
    const body = Buffer.concat([enc(r), enc(s)]);
    return Buffer.concat([Buffer.from([0x30, body.length]), body]);
  }

  it('builds a verifiable ES256 JWT with kid header and team iss', () => {
    const token = buildAppleDeveloperToken(
      { teamId: 'TEAM123456', keyId: 'KEY7890AB', privateKey: pem }, 3600,
    );
    const [h, p, s] = token.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(header).toMatchObject({ alg: 'ES256', kid: 'KEY7890AB' });
    expect(claims.iss).toBe('TEAM123456');
    expect(claims.exp).toBeGreaterThan(claims.iat);

    // Cryptographically verify the signature with the public key.
    const der = joseToDer(Buffer.from(s, 'base64url'));
    const ok = createVerify('SHA256').update(`${h}.${p}`).verify(pub, der);
    expect(ok).toBe(true);
  });

  it('fails fast when key material is missing', () => {
    expect(() => buildAppleDeveloperToken({ teamId: '', keyId: '', privateKey: '' }))
      .toThrow(/APPLE_MUSIC_TEAM_ID/);
  });

  it('caches the token across calls', () => {
    const mgr = new AppleDeveloperTokenManager({ teamId: 'T', keyId: 'K', privateKey: pem });
    expect(mgr.getToken()).toBe(mgr.getToken());
  });
});
