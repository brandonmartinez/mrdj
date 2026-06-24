// Owner: Basher (Google OAuth2 provider — Epic 3, #80/#81)
// Real implementation. Credentials come from env ONLY (never committed):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
import type { AuthProvider, AuthProfile } from './provider.js';

const AUTH_ENDPOINT  = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

export interface GoogleConfig {
  clientId:     string;
  clientSecret: string;
  redirectUri:  string;
}

export class GoogleAuthProvider implements AuthProvider {
  readonly name = 'google';
  constructor(private readonly cfg: GoogleConfig) {}

  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id:     this.cfg.clientId,
      redirect_uri:  this.cfg.redirectUri,
      response_type: 'code',
      scope:         'openid email profile',
      state,
      access_type:   'online',
      prompt:        'select_account',
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<AuthProfile> {
    const tokenRes = await fetch(TOKEN_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        redirect_uri:  this.cfg.redirectUri,
        grant_type:    'authorization_code',
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(`Google token exchange failed (${tokenRes.status})`);
    }
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) throw new Error('Google token response missing access_token');

    const userRes = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!userRes.ok) {
      throw new Error(`Google userinfo failed (${userRes.status})`);
    }
    const u = (await userRes.json()) as {
      sub?: string; email?: string; name?: string;
    };
    if (!u.sub || !u.email) throw new Error('Google profile missing sub/email');

    return {
      provider:    this.name,
      providerId:  u.sub,
      email:       u.email,
      displayName: u.name ?? u.email,
    };
  }
}
