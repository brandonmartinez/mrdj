// Owner: Basher (auth provider seam — Epic 3)
// Mirrors the payments PaymentProvider pattern: a narrow interface so the real
// Google OAuth2 provider and a dev/test stub are interchangeable behind callers.

/** Normalized identity returned by any provider after a successful exchange. */
export interface AuthProfile {
  provider:    string;   // e.g. 'google'
  providerId:  string;   // provider's stable subject id (Google 'sub')
  email:       string;
  displayName: string;
}

export interface AuthProvider {
  /** Provider key stamped onto accounts.provider. */
  readonly name: string;

  /**
   * Build the provider authorization URL the browser is redirected to.
   * `state` is an opaque CSRF token the caller persists on the session and
   * re-checks in the callback.
   */
  buildAuthUrl(state: string): string;

  /**
   * Exchange an authorization `code` for the authenticated user's profile.
   * Production: server-to-server token + userinfo calls.
   * Stub: decodes a self-describing dev code.
   */
  exchangeCode(code: string): Promise<AuthProfile>;
}
