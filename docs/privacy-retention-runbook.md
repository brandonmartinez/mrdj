# MVP privacy & data-retention runbook (#106)

> **Beta policy — revisit before GA.** This is lightweight operational guidance for the MVP beta, based on `api/src/db/schema.ts`. It is not a full privacy notice, DPA, or automated erasure/export feature.

---

## 1. What we store

### Identity and access

| Data | Tables | Notes |
| --- | --- | --- |
| Internal user id + type (`guest` / `account`) | `users` | Core identity key used across requests, wallets, ledgers, and payments. |
| Guest session token + expiry | `guest_sessions` | Browser/session linkage for no-account guests. Treat token as sensitive credential material. |
| Account login profile | `accounts` | OAuth provider, provider id, email, display name, global role, created time. |
| Org staff membership | `memberships` | Account-to-organization role: owner, manager, DJ, staff. |
| Server session payload | `session` | Durable Express session JSON; may include `userId`, role, type, display name, org id, and OAuth state. |

### Organization, events, and requests

| Data | Tables | Notes |
| --- | --- | --- |
| Organization profile and branding | `organizations` | Slug, name, Stripe connected account id, charge/payout flags, optional `logo_url` and `accent_color`. |
| Events and areas | `events`, `areas` | Event/area names, status, owner account, timestamps. |
| Music request history | `queue_items` | Requester user id, event/area/track, queue position, play-next flag, status, timestamps. |
| Music metadata cache | `tracks` | iTunes/provider ids, title, artist, album, artwork URL, preview URL, duration, cache time. Not user PII by itself. |

### Credits, payments, and refunds

| Data | Tables | Notes |
| --- | --- | --- |
| Wallet balance | `wallets` | Per `(user_id, organization_id)` credit balance. |
| Credit ledger | `credit_transactions` | Append-only grants/spends/refunds, amount, reason, reference id, idempotency key, optional actor id. |
| Pricing and bundles | `pricing_config`, `credit_bundles` | Org-scoped prices, credit amounts, labels, discounts. |
| Payment ledger | `platform_payments` | Stripe PaymentIntent/Charge/connected account ids, cents, currency, credits granted, status, refund method/time. No card numbers. |
| Stripe webhook idempotency | `processed_webhook_events` | Stripe event id, type, processed time. |

---

## 2. Why we store it / lawful basis

- **Operate the jukebox:** identify guests/accounts, keep sessions active, place requests in the right event/area, show requester credit balances, and enforce org roles.
- **Process payments and credits:** create Stripe payments, grant/spend/refund credits, reconcile marketplace fees, handle disputes, and prevent duplicate webhooks/actions.
- **Security and abuse prevention:** session state, idempotency keys, webhook event ids, and timestamps support replay protection, auditability, and support investigations.
- **Beta basis:** service contract / requested service for account holders and guests; legitimate interests for fraud prevention, security, and minimal operational analytics.

---

## 3. Retention windows

> Defaults for beta only; confirm with counsel/accounting before GA.

| Category | Proposed beta retention |
| --- | --- |
| `session` rows | Until `expire`; purge expired rows at least daily. |
| `guest_sessions` | Until `expires_at`, or 30 days after last activity if `expires_at` is null. |
| Account profile (`accounts`) | While the account is active; redact on deletion request unless financial/event records still require linkage. |
| Queue/request history (`queue_items`) | 90 days after event end for beta support/debugging; then anonymize `requester_id` where practical or delete event data if not needed. |
| Events/areas/org config | While the org is active; retain ended events for 1 year unless the org requests removal and no payment dispute/accounting need remains. |
| Wallet balances | While balance is non-zero or account/org is active; review zero-balance wallets after 1 year. |
| Credit ledger + payment ledger (`credit_transactions`, `platform_payments`) | 7 years for accounting, refunds, chargebacks, and tax/reconciliation records. |
| Stripe webhook ids | 90 days minimum; 1 year preferred for replay/debug history. |
| iTunes track cache | Refresh/delete by cache policy; no user-specific retention requirement. |

---

## 4. Manual export runbook

1. **Verify requester authority.** Confirm the requester controls the account email or guest session before querying production data.
2. **Resolve the principal.**
   ```sql
   -- Account by email
   select u.id as user_id, a.id as account_id
   from accounts a join users u on u.id = a.user_id
   where lower(a.email) = lower(:email);

   -- Guest by session token, if supplied
   select user_id from guest_sessions where session_token = :session_token;
   ```
3. **Export user-linked rows.**
   ```sql
   select * from users where id = :user_id;
   select * from accounts where user_id = :user_id;
   select * from guest_sessions where user_id = :user_id;
   select sid, sess, expire from session where sess::jsonb ->> 'userId' = :user_id::text;
   select * from memberships where account_id = :account_id;
   select * from events where owner_id = :account_id;
   select * from queue_items where requester_id = :user_id order by created_at;
   select * from wallets where user_id = :user_id;
   select * from credit_transactions where user_id = :user_id or actor_id = :user_id order by created_at;
   select * from platform_payments where user_id = :user_id order by created_at;
   ```
4. **Include contextual records, not as personal data.** For readability, include referenced `organizations`, `events`, `areas`, `tracks`, `credit_bundles`, and `pricing_config` rows used by the exported rows.
5. **Package securely.** Store the export in approved internal storage only, encrypt if sent externally, and delete the working copy after delivery.

---

## 5. Manual deletion / redaction runbook

Use a transaction and keep a before/after audit note outside the app database. Do **not** delete or rewrite financial ledgers still inside the retention window.

1. **Stop active sessions first.**
   ```sql
   delete from session where sess::jsonb ->> 'userId' = :user_id::text;
   delete from guest_sessions where user_id = :user_id;
   ```
2. **For account users, redact profile fields instead of deleting the row** when `events`, `memberships`, `platform_payments`, or ledgers still reference it.
   ```sql
   update accounts
   set email = 'deleted+' || id || '@deleted.invalid',
       display_name = 'Deleted user',
       provider_id = 'deleted-' || id
   where user_id = :user_id;
   ```
3. **Remove memberships when the org no longer needs the staff link.**
   ```sql
   delete from memberships where account_id = :account_id;
   ```
4. **Guest/user rows:** keep the `users.id` while retained `queue_items`, `wallets`, `credit_transactions`, or `platform_payments` reference it. If all dependent rows have aged out and no FK remains, delete in child-to-parent order: `guest_sessions` / `session` → `wallets` → `queue_items` → `accounts` / `memberships` → `users`.
5. **Financial records:** retain `platform_payments` and `credit_transactions` for the retention window; mark support tooling/export notes as “redacted account” rather than mutating cents, Stripe ids, or idempotency keys.
6. **Queue history:** after the 90-day beta window and if no payment/support need remains, delete or anonymize queue rows before deleting the user row. Confirm FK impact first because `queue_items.requester_id` currently has no cascade.

---

## 6. Third parties

- **Stripe:** card data is entered through Stripe/Payment Element and is not stored by mrdj. The API sends amount, currency, application fee, connected account id, and metadata (`organizationId`, `userId`, `bundleId`, credits/application fee) to create PaymentIntents. Stripe also receives Connect onboarding data directly from organizers.
- **iTunes Search API:** music searches and lookups send the search term or provider track id plus storefront/country to Apple’s public iTunes endpoint. mrdj does not send user ids or payment data to iTunes.

---

## 7. Guest tracking and branding assets

- Organizer `logo_url` is rendered on public guest pages. It must be HTTPS-only to avoid mixed content and reduce passive tracking risk; the backend guard is being implemented separately in #106.
- Future hardening: replace remote arbitrary logo URLs with an asset upload/proxy/cache service so guest browsers load branding from mrdj-controlled infrastructure.

---

## 8. Open items / deferred

- #106: MVP privacy/security hardening, including this runbook and the HTTPS logo URL guard.
- [#8](https://github.com/brandonmartinez/mrdj/issues/8): Stripe marketplace payment behavior and refund/dispute handling.
- [#9](https://github.com/brandonmartinez/mrdj/issues/9): music-provider integrations and provider data flows.
- [#11](https://github.com/brandonmartinez/mrdj/issues/11): guest experience and public branding surfaces.
- [#13](https://github.com/brandonmartinez/mrdj/issues/13) / [#15](https://github.com/brandonmartinez/mrdj/issues/15): defer full privacy notice, DPA/vendor review, automated export/deletion endpoints, and production retention jobs until after MVP beta.
