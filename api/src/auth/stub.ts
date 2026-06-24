// Owner: Basher (dev/test auth provider — Epic 3)
// Stub provider so SSO flows are exercisable without live Google credentials —
// the auth analogue of StubPaymentProvider. NEVER mounted in production.
//
// A dev "authorization code" is a base64url-encoded JSON AuthProfile, so tests
// can drive any identity deterministically:
//   code = base64url(JSON.stringify({ providerId, email, displayName }))
import type { AuthProvider, AuthProfile } from './provider.js';

export class StubAuthProvider implements AuthProvider {
  readonly name = 'stub';

  buildAuthUrl(state: string): string {
    // No external IdP — point back at our own callback so the dev flow is self-contained.
    return `/api/auth/stub/authorize?state=${encodeURIComponent(state)}`;
  }

  async exchangeCode(code: string): Promise<AuthProfile> {
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(code, 'base64url').toString('utf8'));
    } catch {
      throw new Error('Invalid stub auth code');
    }
    const p = decoded as Partial<AuthProfile>;
    if (!p.providerId || !p.email) {
      throw new Error('Stub auth code missing providerId/email');
    }
    return {
      provider:    this.name,
      providerId:  p.providerId,
      email:       p.email,
      displayName: p.displayName ?? p.email,
    };
  }

  /** Helper for tests: build a stub code from a profile. */
  static encode(profile: { providerId: string; email: string; displayName?: string }): string {
    return Buffer.from(JSON.stringify(profile), 'utf8').toString('base64url');
  }
}
