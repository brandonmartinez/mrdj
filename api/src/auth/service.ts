// Owner: Basher (auth service — Epic 3, #81/#87/#89)
import { and, eq, sql } from 'drizzle-orm';
import {
  db, users, accounts, organizations, memberships, wallets,
  type DbExecutor,
} from '../db/index.js';
import { grantCredits } from '../credits/service.js';
import type { AuthProfile } from './provider.js';

export interface LoginResult {
  userId:      string;
  accountId:   string;
  role:        'admin' | 'dj';
  displayName: string;
  organizationId: string;
  isNewAccount: boolean;
  mergedCredits: number;
}

export interface LoginOptions {
  /** The browser's pre-login guest user id, for credit merge (#89). */
  guestUserId?: string;
}

/** Derive a URL-safe org slug seed from an email/display name. */
function slugSeed(profile: AuthProfile): string {
  const base = (profile.displayName || profile.email.split('@')[0] || 'dj')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base || 'dj';
}

/** Find a free org slug, appending -2, -3, … on collision. */
async function uniqueOrgSlug(ex: DbExecutor, seed: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? seed : `${seed}-${i + 1}`;
    const [hit] = await ex
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, candidate))
      .limit(1);
    if (!hit) return candidate;
  }
  return `${seed}-${Date.now()}`;
}

/**
 * Resolve a provider profile to a session-ready account, creating it (and a
 * bootstrap Organization + owner Membership, #87) on first login, and merging any
 * pre-login guest credit balance into the account wallet (#89).
 */
export async function loginWithProfile(
  profile: AuthProfile,
  opts:    LoginOptions = {},
): Promise<LoginResult> {
  return db.transaction(async (tx) => {
    // 1. Find existing account by (provider, providerId).
    const [existing] = await tx
      .select({ id: accounts.id, userId: accounts.userId, role: accounts.role, displayName: accounts.displayName })
      .from(accounts)
      .where(and(eq(accounts.provider, profile.provider), eq(accounts.providerId, profile.providerId)))
      .limit(1);

    let accountId: string;
    let userId: string;
    let role: string;
    let displayName: string;
    let isNewAccount = false;

    if (existing) {
      accountId   = existing.id;
      userId      = existing.userId;
      role        = existing.role;
      displayName = existing.displayName;
    } else {
      isNewAccount = true;
      const [user] = await tx.insert(users).values({ type: 'account' }).returning({ id: users.id });
      userId = user.id;
      const [acct] = await tx
        .insert(accounts)
        .values({
          userId,
          provider:    profile.provider,
          providerId:  profile.providerId,
          email:       profile.email,
          displayName: profile.displayName,
          role:        'user',
        })
        .returning({ id: accounts.id, role: accounts.role, displayName: accounts.displayName });
      accountId   = acct.id;
      role        = acct.role;
      displayName = acct.displayName;
    }

    // 2. Resolve the account's Organization — bootstrap one on first login (#87).
    let [membership] = await tx
      .select({ organizationId: memberships.organizationId })
      .from(memberships)
      .where(eq(memberships.accountId, accountId))
      .limit(1);

    if (!membership) {
      const slug = await uniqueOrgSlug(tx, slugSeed(profile));
      const [org] = await tx
        .insert(organizations)
        .values({ slug, name: `${displayName}'s Organization` })
        .returning({ id: organizations.id });
      await tx.insert(memberships).values({
        organizationId: org.id,
        accountId,
        role:           'owner',
      });
      membership = { organizationId: org.id };
    }
    const organizationId = membership.organizationId;

    // 3. Merge pre-login guest credits into the account wallet (#89).
    let mergedCredits = 0;
    if (opts.guestUserId && opts.guestUserId !== userId) {
      const [guestWallet] = await tx
        .select({ balance: wallets.balance })
        .from(wallets)
        .where(eq(wallets.userId, opts.guestUserId))
        .limit(1);
      const balance = guestWallet?.balance ?? 0;
      if (balance > 0) {
        // Move balance: zero the guest wallet, grant to the account (idempotent).
        await tx
          .update(wallets)
          .set({ balance: 0, updatedAt: sql`now()` })
          .where(eq(wallets.userId, opts.guestUserId));
        await grantCredits(
          userId,
          organizationId,
          balance,
          'merge',
          `merge:${opts.guestUserId}->${userId}`,
          userId,
          tx,
        );
        mergedCredits = balance;
      }
    }

    return {
      userId,
      accountId,
      role: role === 'admin' ? 'admin' : 'dj',
      displayName,
      organizationId,
      isNewAccount,
      mergedCredits,
    };
  });
}
