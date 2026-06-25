// Owner: Rusty (initial seed — idempotent, keyed by stable IDs)
// Tracks: CC/public-domain compositions (>100 years old or traditional folk works).
// Artwork: inline SVG data-URIs. Livingston will replace with real provider artwork.
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '../.env'), override: false });

import { sql } from 'drizzle-orm';
import {
  db, users, accounts, events, tracks, queueItems,
  playNextSlot, wallets, creditTransactions, pricingConfig, creditBundles,
  organizations, memberships, areas,
} from './index.js';
import { pool } from './pool.js';

// ── Stable seed IDs (never change — seed is idempotent on these) ─────────────
const IDS = {
  adminUser:     '00000000-0000-0000-0000-000000000001',
  adminAccount:  '00000000-0000-0000-0000-000000000002',
  guestUser:     '00000000-0000-0000-0000-000000000003',
  demoEvent:     '00000000-0000-0000-0000-000000000010',
  guestWallet:   '00000000-0000-0000-0000-000000000020',
  adminWallet:   '00000000-0000-0000-0000-000000000021',
  ctGuestInit:   '00000000-0000-0000-0000-000000000030',
  bundleStarter: '00000000-0000-0000-0000-000000000040',
  bundleParty:   '00000000-0000-0000-0000-000000000041',
  bundleVip:     '00000000-0000-0000-0000-000000000042',
  defaultOrg:    '00000000-0000-0000-0000-000000000050',
  adminMember:   '00000000-0000-0000-0000-000000000051',
  demoArea:      '00000000-0000-0000-0000-000000000052',
} as const;

const trackId = (n: number) =>
  `00000000-0000-0000-0000-0000000001${String(n).padStart(2, '0')}`;
const queueId = (n: number) =>
  `00000000-0000-0000-0000-0000000002${String(n).padStart(2, '0')}`;

function svgArtwork(color: string, label: string): string {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">`,
    `<rect width="300" height="300" fill="${color}"/>`,
    `<text x="150" y="125" font-size="64" text-anchor="middle" fill="rgba(255,255,255,0.25)" font-family="sans-serif">♪</text>`,
    `<text x="150" y="195" font-size="32" font-weight="bold" text-anchor="middle" fill="white" font-family="sans-serif">${label}</text>`,
    `</svg>`,
  ].join('');
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// 15 public-domain tracks — all compositions PD (composer died >70 years ago; US pub. pre-1928).
// Artwork: inline SVG data-URIs generated programmatically — no copyrighted images.
const TRACKS = [
  { n:  1, color: '#7C3AED', label: 'CL', pid: 'stub-clair-de-lune',        title: 'Clair de Lune',                       artist: 'Claude Debussy',                     album: 'Suite bergamasque',           ms: 296000 }, // PD: Debussy d.1918; first pub. 1905
  { n:  2, color: '#DC2626', label: 'FE', pid: 'stub-fur-elise',             title: 'Für Elise',                           artist: 'Ludwig van Beethoven',               album: 'Piano Pieces (WoO 59)',        ms: 175000 }, // PD: Beethoven d.1827; first pub. 1867
  { n:  3, color: '#2563EB', label: 'MS', pid: 'stub-moonlight-sonata',      title: 'Moonlight Sonata',                    artist: 'Ludwig van Beethoven',               album: 'Piano Sonata No. 14',          ms: 354000 }, // PD: Beethoven d.1827; pub. 1802
  { n:  4, color: '#16A34A', label: 'CD', pid: 'stub-canon-in-d',            title: 'Canon in D Major',                    artist: 'Johann Pachelbel',                   album: 'Canon and Gigue',              ms: 312000 }, // PD: Pachelbel d.1706; c.1694 manuscript
  { n:  5, color: '#D97706', label: 'FS', pid: 'stub-four-seasons-spring',   title: 'The Four Seasons: Spring',            artist: 'Antonio Vivaldi',                    album: 'The Four Seasons',             ms: 185000 }, // PD: Vivaldi d.1741; pub. 1725
  { n:  6, color: '#0891B2', label: 'BD', pid: 'stub-blue-danube',           title: 'The Blue Danube Waltz',               artist: 'Johann Strauss II',                  album: 'Waltzes, Op. 314',             ms: 639000 }, // PD: Strauss II d.1899; pub. 1867
  { n:  7, color: '#6D28D9', label: 'S5', pid: 'stub-symphony-5',            title: 'Symphony No. 5: I. Allegro con brio', artist: 'Ludwig van Beethoven',               album: 'Symphony No. 5',               ms: 432000 }, // PD: Beethoven d.1827; pub. 1809
  { n:  8, color: '#BE185D', label: 'GS', pid: 'stub-greensleeves',          title: 'Greensleeves',                        artist: 'Traditional',                        album: 'English Folk Songs',           ms: 198000 }, // PD: anonymous/traditional; c.1580 origin
  { n:  9, color: '#065F46', label: 'AG', pid: 'stub-amazing-grace',         title: 'Amazing Grace',                       artist: 'Traditional',                        album: 'American Hymns',               ms: 212000 }, // PD: words Newton 1779; tune pub. 1835
  { n: 10, color: '#92400E', label: 'HA', pid: 'stub-habanera',              title: 'Habanera',                            artist: 'Georges Bizet',                      album: 'Carmen',                       ms: 195000 }, // PD: Bizet d.1875; premiered 1875
  { n: 11, color: '#1D4ED8', label: 'OJ', pid: 'stub-ode-to-joy',            title: 'Ode to Joy',                          artist: 'Ludwig van Beethoven',               album: 'Symphony No. 9',               ms: 420000 }, // PD: Beethoven d.1827; pub. 1824
  { n: 12, color: '#6B21A8', label: 'G1', pid: 'stub-gymnopedie-1',          title: 'Gymnopédie No. 1',                    artist: 'Erik Satie',                         album: 'Gymnopédies',                  ms: 204000 }, // PD: Satie d.1925; pub. 1888
  { n: 13, color: '#047857', label: 'MK', pid: 'stub-mountain-king',         title: 'In the Hall of the Mountain King',    artist: 'Edvard Grieg',                       album: 'Peer Gynt Suite No. 1',        ms: 218000 }, // PD: Grieg d.1907; pub. 1876
  { n: 14, color: '#9A3412', label: 'MG', pid: 'stub-minuet-g',              title: 'Minuet in G Major',                   artist: 'Christian Petzold (attr. J.S. Bach)', album: 'Notebook for Anna Magdalena', ms: 148000 }, // PD: Petzold d.1733; attr. to Bach in 18th-c. manuscript
  { n: 15, color: '#1E40AF', label: 'AV', pid: 'stub-ave-maria',             title: 'Ave Maria',                           artist: 'Franz Schubert',                     album: 'Songs and Lieder, Op. 52',    ms: 286000 }, // PD: Schubert d.1828; pub. 1825
] as const;

// Queue: 4 played (oldest first), 1 playing, 6 pending
// played.updated_at staggered: qi n=1 oldest, n=4 most-recently-played (adjacent to now-playing)
const QUEUE_ITEMS = [
  { n:  1, trackN:  1, status: 'played',  position: 0, minutesAgo: 60 },
  { n:  2, trackN:  2, status: 'played',  position: 0, minutesAgo: 45 },
  { n:  3, trackN:  3, status: 'played',  position: 0, minutesAgo: 30 },
  { n:  4, trackN:  4, status: 'played',  position: 0, minutesAgo: 15 },
  { n:  5, trackN:  5, status: 'playing', position: 0, minutesAgo:  0 },
  { n:  6, trackN:  6, status: 'pending', position: 1, minutesAgo:  0 },
  { n:  7, trackN:  7, status: 'pending', position: 2, minutesAgo:  0 },
  { n:  8, trackN:  8, status: 'pending', position: 3, minutesAgo:  0 },
  { n:  9, trackN:  9, status: 'pending', position: 4, minutesAgo:  0 },
  { n: 10, trackN: 10, status: 'pending', position: 5, minutesAgo:  0 },
  { n: 11, trackN: 11, status: 'pending', position: 6, minutesAgo:  0 },
] as const;

async function seed() {
  try {
    await db.transaction(async (tx) => {
      // Users
      await tx.insert(users).values([
        { id: IDS.adminUser, type: 'account' },
        { id: IDS.guestUser, type: 'guest' },
      ]).onConflictDoNothing({ target: users.id });

      // Default Organization (tenant) — resolvable at /o/demo
      await tx.insert(organizations).values({
        id:   IDS.defaultOrg,
        slug: 'demo',
        name: "Mr. DJ Demo Organization",
        accentColor: '#7c3aed',
      }).onConflictDoNothing({ target: organizations.id });

      // Admin account (role = admin)
      await tx.insert(accounts).values({
        id:          IDS.adminAccount,
        userId:      IDS.adminUser,
        provider:    'stub',
        providerId:  'admin-001',
        email:       'admin@mrdj.dev',
        displayName: 'Admin DJ',
        role:        'admin',
      }).onConflictDoNothing({ target: accounts.id });

      // Owner Membership: admin account owns the default org
      await tx.insert(memberships).values({
        id:             IDS.adminMember,
        organizationId: IDS.defaultOrg,
        accountId:      IDS.adminAccount,
        role:           'owner',
      }).onConflictDoNothing({ target: memberships.id });

      // Demo event — "The Ocean's Eleven After Party" (slug: demo)
      await tx.insert(events).values({
        id:        IDS.demoEvent,
        slug:      'demo',
        name:      "The Ocean's Eleven After Party",
        ownerId:   IDS.adminAccount,
        organizationId: IDS.defaultOrg,
        status:    'live',
        startedAt: sql`now()`,
      }).onConflictDoNothing({ target: events.id });

      // Default Area for the demo event (each Event has ≥1 Area; queue lives here)
      await tx.insert(areas).values({
        id:             IDS.demoArea,
        eventId:        IDS.demoEvent,
        organizationId: IDS.defaultOrg,
        name:           'Main Floor',
        isDefault:      true,
      }).onConflictDoNothing({ target: areas.id });

      // 15 CC/public-domain tracks
      await tx.insert(tracks).values(
        TRACKS.map((t) => ({
          id:         trackId(t.n),
          provider:   'stub',
          providerId: t.pid,
          title:      t.title,
          artist:     t.artist,
          album:      t.album,
          artworkUrl: svgArtwork(t.color, t.label),
          durationMs: t.ms,
        })),
      ).onConflictDoNothing({ target: [tracks.provider, tracks.providerId] });

      // Pre-populated queue (4 played, 1 playing, 6 pending)
      await tx.insert(queueItems).values(
        QUEUE_ITEMS.map((qi) => ({
          id:          queueId(qi.n),
          eventId:     IDS.demoEvent,
          areaId:      IDS.demoArea,
          trackId:     trackId(qi.trackN),
          requesterId: IDS.guestUser,
          position:    qi.position,
          status:      qi.status,
          isPlayNext:  false,
          updatedAt:   sql`now() - (${qi.minutesAgo}::int * interval '1 minute')`,
        })),
      ).onConflictDoNothing({ target: queueItems.id });

      // Play Next slot — available on boot
      await tx.insert(playNextSlot).values({
        eventId: IDS.demoEvent,
        areaId:  IDS.demoArea,
        status:  'available',
      }).onConflictDoNothing({ target: playNextSlot.eventId });

      // Wallets: guest=2 credits (free Add works, Boost=1 works once, Play Next=3 → triggers buy-more)
      await tx.insert(wallets).values([
        { id: IDS.guestWallet, userId: IDS.guestUser, organizationId: IDS.defaultOrg, balance: 2 },
        { id: IDS.adminWallet, userId: IDS.adminUser, organizationId: IDS.defaultOrg, balance: 100 },
      ]).onConflictDoNothing({ target: wallets.id });

      // Credit ledger entry for guest initial balance (idempotency_key prevents re-grant)
      await tx.insert(creditTransactions).values({
        id:             IDS.ctGuestInit,
        userId:         IDS.guestUser,
        organizationId: IDS.defaultOrg,
        type:           'grant',
        amount:         2,
        reason:         'promo',
        idempotencyKey: 'seed:guest-initial-2-credits',
      }).onConflictDoNothing({ target: creditTransactions.idempotencyKey });

      // Server-side pricing config (never sent raw to frontend except via QueueView.pricing)
      await tx.insert(pricingConfig).values([
        { organizationId: IDS.defaultOrg, key: 'queue',     value: 0 },
        { organizationId: IDS.defaultOrg, key: 'boost',     value: 1 },
        { organizationId: IDS.defaultOrg, key: 'play_next', value: 3 },
      ]).onConflictDoNothing({ target: [pricingConfig.organizationId, pricingConfig.key] });

      // Credit bundles (platform defaults — O9): $5/$10/$20 with bonus credits.
      await tx.insert(creditBundles).values([
        { id: IDS.bundleStarter, organizationId: IDS.defaultOrg, label: 'Starter Pack', credits:  5, bonusCredits: 0, priceCents:  500, discountPct: '0.00', sortOrder: 1 },
        { id: IDS.bundleParty,   organizationId: IDS.defaultOrg, label: 'Party Pack',   credits: 10, bonusCredits: 1, priceCents: 1000, discountPct: '9.09', sortOrder: 2 },
        { id: IDS.bundleVip,     organizationId: IDS.defaultOrg, label: 'VIP Pack',     credits: 20, bonusCredits: 4, priceCents: 2000, discountPct: '16.67', sortOrder: 3 },
      ]).onConflictDoNothing({ target: creditBundles.id });
    });

    console.log('[seed] ✓ Seed completed successfully');
  } catch (err) {
    console.error('[seed] Seed failed:', err);
    throw err;
  } finally {
    await pool.end();
  }
}

seed().catch(err => { console.error(err); process.exit(1); });
