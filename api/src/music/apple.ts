// Owner: Livingston (Apple Music scaffold — #16 dev token, #17 search/resolve)
// INTERFACE-READY SCAFFOLD, NOT WIRED. Apple Music (full MusicKit) is the documented
// fast-follow; the Epic 5 MVP ships on the iTunes Search API (Apple's public catalog,
// no credentials). This file provides a real, dependency-free MusicKit developer-token
// builder (signed ES256 JWT) so #16 is satisfiable, plus a provider shell whose
// search/resolve are intentionally stubbed until MusicKit is enabled.
//
// Enable later: set MUSIC_PROVIDER=apple and supply APPLE_MUSIC_TEAM_ID,
// APPLE_MUSIC_KEY_ID, APPLE_MUSIC_PRIVATE_KEY (the .p8 contents). Secrets via env only.
import { createSign, createPrivateKey } from 'node:crypto';
import { cfg } from '../config/index.js';
import { MusicProviderConfigError, type MusicProvider, type Track } from './provider.js';

export const APPLE_PROVIDER = 'apple';

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Convert an ECDSA DER signature to the raw R||S (JOSE) form ES256 requires. */
function derToJose(der: Buffer): Buffer {
  // DER: 0x30 len 0x02 rLen r 0x02 sLen s
  let offset = 2;
  if (der[1] & 0x80) offset += der[1] & 0x7f; // long-form length
  const readInt = (): Buffer => {
    if (der[offset] !== 0x02) throw new Error('Invalid DER signature');
    const len = der[offset + 1];
    let val = der.subarray(offset + 2, offset + 2 + len);
    offset += 2 + len;
    // Strip leading zero byte / left-pad to 32 bytes.
    if (val.length > 32) val = val.subarray(val.length - 32);
    if (val.length < 32) val = Buffer.concat([Buffer.alloc(32 - val.length), val]);
    return val;
  };
  const r = readInt();
  const s = readInt();
  return Buffer.concat([r, s]);
}

export interface AppleMusicConfig {
  teamId:     string;
  keyId:      string;
  privateKey: string; // .p8 PEM contents
}

/**
 * Build a signed MusicKit developer token (#16): an ES256 JWT whose `iss` is the
 * team id, `kid` header is the key id, valid ≤ Apple's 180-day max (we use ≤24h
 * via the caller's ttl). Tokens are server-side only.
 */
export function buildAppleDeveloperToken(cfgIn: AppleMusicConfig, ttlSeconds = 60 * 60 * 12): string {
  if (!cfgIn.teamId || !cfgIn.keyId || !cfgIn.privateKey) {
    throw new MusicProviderConfigError(
      'Apple Music provider requires APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID and APPLE_MUSIC_PRIVATE_KEY',
    );
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: cfgIn.keyId };
  const claims = { iss: cfgIn.teamId, iat: now, exp: now + ttlSeconds };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;

  const key = createPrivateKey(cfgIn.privateKey);
  const der = createSign('SHA256').update(signingInput).sign(key);
  const sig = base64url(derToJose(der));
  return `${signingInput}.${sig}`;
}

/**
 * Caches a developer token and rebuilds it before expiry (≤24h, #16).
 */
export class AppleDeveloperTokenManager {
  private token: string | null = null;
  private expiresAt = 0;
  private readonly ttlSeconds = 60 * 60 * 12; // 12h, rebuilt before expiry
  private readonly skewMs = 60_000;

  constructor(private readonly cfgIn: AppleMusicConfig) {
    // Fail-fast: validate inputs up front.
    buildAppleDeveloperToken(cfgIn, this.ttlSeconds);
  }

  getToken(): string {
    if (this.token && Date.now() < this.expiresAt - this.skewMs) return this.token;
    this.token     = buildAppleDeveloperToken(this.cfgIn, this.ttlSeconds);
    this.expiresAt = Date.now() + this.ttlSeconds * 1000;
    return this.token;
  }
}

export class AppleMusicProvider implements MusicProvider {
  readonly name = APPLE_PROVIDER;
  private readonly tokens: AppleDeveloperTokenManager;

  constructor(
    config: AppleMusicConfig = {
      teamId:     cfg.appleMusicTeamId,
      keyId:      cfg.appleMusicKeyId,
      privateKey: cfg.appleMusicPrivateKey,
    },
    private readonly apiUrl = cfg.appleMusicApiUrl,
  ) {
    this.tokens = new AppleDeveloperTokenManager(config);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async search(_query: string, _limit = 15, _signal?: AbortSignal): Promise<Track[]> {
    throw new MusicProviderConfigError(
      'AppleMusicProvider.search is a scaffold (fast-follow). Implement GET ' +
      this.apiUrl + '/catalog/{storefront}/search using AppleDeveloperTokenManager.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async resolve(_providerId: string, _signal?: AbortSignal): Promise<Track | null> {
    throw new MusicProviderConfigError(
      'AppleMusicProvider.resolve is a scaffold — implement GET ' +
      this.apiUrl + '/catalog/{storefront}/songs/{id}.',
    );
  }
}
