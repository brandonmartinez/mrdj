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
import { describe, it, beforeAll, afterEach, afterAll, expect, vi } from 'vitest';
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
  vi.useRealTimers();
  vi.restoreAllMocks();
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

  it('retries on 503 and gives up with a typed retry error', async () => {
    nock(ITUNES).get('/down').times(4).reply(503);
    await expect(fetchWithBackoff(`${ITUNES}/down`, undefined, { maxAttempts: 4, sleep: noSleep }))
      .rejects.toMatchObject({ code: 'retry_exhausted', status: 503 });
  });

  it('does not retry a non-retryable 404', async () => {
    const scope = nock(ITUNES).get('/missing').reply(404);
    const res = await fetchWithBackoff(`${ITUNES}/missing`, undefined, { sleep: noSleep });
    expect(res.status).toBe(404);
    expect(scope.isDone()).toBe(true);
  });

  it('times out a hung attempt with a typed timeout error', async () => {
    vi.useFakeTimers();
    const hangingFetch: typeof fetch = async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });

    const pending = fetchWithBackoff(`${ITUNES}/slow`, undefined, {
      fetch: hangingFetch,
      maxAttempts: 1,
      attemptTimeoutMs: 50,
      totalTimeoutMs: 100,
    });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });

    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });

  it('clamps absurd Retry-After values before sleeping', async () => {
    const sleeps: number[] = [];
    nock(ITUNES).get('/busy').reply(429, '', { 'retry-after': '999999' });
    nock(ITUNES).get('/busy').reply(200, { ok: true });

    const res = await fetchWithBackoff(`${ITUNES}/busy`, undefined, {
      retryAfterMaxMs: 2_000,
      maxDelayMs: 2_000,
      maxTotalBackoffMs: 2_000,
      sleep: async (ms) => { sleeps.push(ms); },
    });

    expect(res.status).toBe(200);
    expect(sleeps).toEqual([2_000]);
  });

  it('ignores non-numeric Retry-After values and uses capped exponential backoff', async () => {
    const sleeps: number[] = [];
    nock(ITUNES).get('/busy-text').reply(503, '', { 'retry-after': 'not-a-date' });
    nock(ITUNES).get('/busy-text').reply(200, { ok: true });

    const res = await fetchWithBackoff(`${ITUNES}/busy-text`, undefined, {
      baseDelayMs: 123,
      sleep: async (ms) => { sleeps.push(ms); },
    });

    expect(res.status).toBe(200);
    expect(sleeps).toEqual([123]);
  });

  it('caps attempts and total retry budget before another provider call', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-25T00:00:00.000Z'));
    const fetchFn = vi.fn(async () => {
      vi.setSystemTime(new Date('2026-06-25T00:00:00.080Z'));
      return new Response('', { status: 503 });
    });

    await expect(fetchWithBackoff(`${ITUNES}/budget`, undefined, {
      fetch: fetchFn as unknown as typeof fetch,
      maxAttempts: 3,
      baseDelayMs: 50,
      totalTimeoutMs: 100,
      maxTotalBackoffMs: 500,
      sleep: noSleep,
    })).rejects.toMatchObject({ code: 'backoff_budget_exhausted', status: 503 });

    expect(fetchFn).toHaveBeenCalledTimes(1);
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


  it('propagates caller aborts promptly without caching partial results', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    const abortingProvider = new ITunesMusicProvider({
      backoff: { fetch: fetchFn as unknown as typeof fetch, maxAttempts: 3, sleep: noSleep },
    });

    const pending = abortingProvider.search('daft punk', 1, controller.signal);
    controller.abort(new DOMException('client closed', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const rows = await db.select().from(tracks).where(eq(tracks.provider, 'itunes'));
    expect(rows).toHaveLength(0);
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


// ── Provider-safe cache seam (#107) ─────────────────────────────────────────────
describe('track cache provider namespacing', () => {
  afterEach(async () => {
    await db.delete(tracks).where(eq(tracks.provider, 'provider-a'));
    await db.delete(tracks).where(eq(tracks.provider, 'provider-b'));
  });

  it('keeps identical provider-native ids isolated by provider', async () => {
    const first = await upsertTrack({
      provider: 'provider-a', providerId: 'shared-id', title: 'A Original', artist: 'Artist A', album: 'Album A',
      artworkUrl: '', durationMs: 1000, previewUrl: null,
    });
    const second = await upsertTrack({
      provider: 'provider-b', providerId: 'shared-id', title: 'B Original', artist: 'Artist B', album: 'Album B',
      artworkUrl: '', durationMs: 2000, previewUrl: null,
    });
    const refreshedFirst = await upsertTrack({
      provider: 'provider-a', providerId: 'shared-id', title: 'A Refreshed', artist: 'Artist A', album: 'Album A',
      artworkUrl: '', durationMs: 3000, previewUrl: 'https://example.test/a.m4a',
    });

    expect(refreshedFirst.id).toBe(first.id);
    expect(second.id).not.toBe(first.id);
    expect((await findCachedByProviderId('provider-a', 'shared-id'))?.track).toMatchObject({
      id: first.id,
      title: 'A Refreshed',
      previewUrl: 'https://example.test/a.m4a',
    });
    expect((await findCachedByProviderId('provider-b', 'shared-id'))?.track).toMatchObject({
      id: second.id,
      title: 'B Original',
      previewUrl: null,
    });
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
