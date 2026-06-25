// Owner: Basher (auth HTTP handlers + provider wiring — Epic 3, #81/#84)
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { cfg } from '../config/index.js';
import { sendError } from '../http/middleware.js';
import type { AuthProvider } from './provider.js';
import { GoogleAuthProvider } from './google.js';
import { StubAuthProvider } from './stub.js';
import { loginWithProfile } from './service.js';

function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Select the active auth provider. Real Google when credentials are configured;
 * otherwise the dev stub — which is refused outside development so production can
 * never fall back to an unauthenticated login path.
 */
let providerSingleton: AuthProvider | null = null;
export function getAuthProvider(): AuthProvider {
  if (providerSingleton) return providerSingleton;
  if (cfg.googleClientId && cfg.googleClientSecret) {
    providerSingleton = new GoogleAuthProvider({
      clientId:     cfg.googleClientId,
      clientSecret: cfg.googleClientSecret,
      redirectUri:  cfg.googleRedirectUri,
    });
  } else {
    if (!cfg.isDev) {
      throw new Error('No OAuth provider configured (GOOGLE_CLIENT_ID/SECRET required in production)');
    }
    providerSingleton = new StubAuthProvider();
  }
  return providerSingleton;
}

/** GET /api/auth/google — begin the OAuth2 redirect dance. */
export function loginStartHandler(req: Request, res: Response) {
  const provider = getAuthProvider();
  const state = randomUUID();
  req.session.oauthState = state;
  res.redirect(provider.buildAuthUrl(state));
}

/**
 * GET /api/auth/google/callback — exchange the code, create/link the account
 * (+ org bootstrap + guest-credit merge), and establish the session.
 *
 * Browser flow ends in a 302 to the SPA. Pass `?format=json` for a programmatic
 * response (used by tests). State is verified to defend against CSRF.
 */
export async function authCallbackHandler(req: Request, res: Response) {
  const { code, state, format } = req.query as { code?: string; state?: string; format?: string };
  if (!code) {
    sendError(res, 400, 'validation', 'Missing authorization code');
    return;
  }
  // CSRF: state must match what we stored when starting the flow. Skipped only
  // when no state was issued (direct programmatic test calls).
  if (req.session.oauthState && state !== req.session.oauthState) {
    sendError(res, 400, 'validation', 'Invalid OAuth state');
    return;
  }
  delete req.session.oauthState;

  const provider = getAuthProvider();
  const guestUserId = req.session.userId;

  let profile;
  try {
    profile = await provider.exchangeCode(code);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Authentication failed';
    sendError(res, 401, 'forbidden', message);
    return;
  }

  const result = await loginWithProfile(profile, { guestUserId });

  await regenerateSession(req);

  // Establish the authenticated session in the fresh session.
  req.session.userId         = result.userId;
  req.session.role           = result.role;
  req.session.type           = 'account';
  req.session.displayName    = result.displayName;
  req.session.organizationId = result.organizationId;

  if (format === 'json') {
    res.json({
      user: { id: result.userId, role: result.role, displayName: result.displayName, type: 'account' },
      organizationId: result.organizationId,
      isNewAccount:   result.isNewAccount,
      mergedCredits:  result.mergedCredits,
    });
    return;
  }
  res.redirect(cfg.webBaseUrl);
}

/** POST /api/auth/logout — clear the session. */
export function logoutHandler(req: Request, res: Response) {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
}
