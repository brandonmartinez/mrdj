// Owner: Rusty (initial seed — idempotent, keyed by stable IDs)
// Tracks: CC/public-domain compositions (>100 years old or traditional folk works).
// Artwork: inline SVG data-URIs. Livingston will replace with real provider artwork.
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '../.env'), override: false });

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

// 15 CC/public-domain tracks (all compositions are in the public domain)
const TRACKS = [
  { n:  1, color: '#7C3AED', label: 'CL', pid: 'stub-clair-de-lune',        title: 'Clair de Lune',                       artist: 'Claude Debussy',        album: 'Suite bergamasque',            ms: 296000 },
  { n:  2, color: '#DC2626', label: 'FE', pid: 'stub-fur-elise',             title: 'Für Elise',                           artist: 'Ludwig van Beethoven',  album: 'Bagatelles, Op. 33',           ms: 175000 },
  { n:  3, color: '#2563EB', label: 'MS', pid: 'stub-moonlight-sonata',      title: 'Moonlight Sonata',                    artist: 'Ludwig van Beethoven',  album: 'Piano Sonata No. 14',          ms: 354000 },
  { n:  4, color: '#16A34A', label: 'CD', pid: 'stub-canon-in-d',            title: 'Canon in D Major',                    artist: 'Johann Pachelbel',      album: 'Canon and Gigue',              ms: 312000 },
  { n:  5, color: '#D97706', label: 'FS', pid: 'stub-four-seasons-spring',   title: 'The Four Seasons: Spring',            artist: 'Antonio Vivaldi',       album: 'The Four Seasons',             ms: 185000 },
  { n:  6, color: '#0891B2', label: 'BD', pid: 'stub-blue-danube',           title: 'The Blue Danube Waltz',               artist: 'Johann Strauss II',     album: 'Waltzes, Op. 314',             ms: 639000 },
  { n:  7, color: '#6D28D9', label: 'S5', pid: 'stub-symphony-5',            title: 'Symphony No. 5: I. Allegro con brio', artist: 'Ludwig van Beethoven',  album: 'Symphony No. 5',               ms: 432000 },
  { n:  8, color: '#BE185D', label: 'GS', pid: 'stub-greensleeves',          title: 'Greensleeves',                        artist: 'Traditional',           album: 'English Folk Songs',           ms: 198000 },
  { n:  9, color: '#065F46', label: 'AG', pid: 'stub-amazing-grace',         title: 'Amazing Grace',                       artist: 'Traditional',           album: 'American Hymns',               ms: 212000 },
  { n: 10, color: '#92400E', label: 'HA', pid: 'stub-habanera',              title: 'Habanera',                            artist: 'Georges Bizet',         album: 'Carmen',                       ms: 195000 },
  { n: 11, color: '#1D4ED8', label: 'OJ', pid: 'stub-ode-to-joy',            title: 'Ode to Joy',                          artist: 'Ludwig van Beethoven',  album: 'Symphony No. 9',               ms: 420000 },
  { n: 12, color: '#6B21A8', label: 'G1', pid: 'stub-gymnopedie-1',          title: 'Gymnopédie No. 1',                    artist: 'Erik Satie',            album: 'Gymnopédies',                  ms: 204000 },
  { n: 13, color: '#047857', label: 'MK', pid: 'stub-mountain-king',         title: 'In the Hall of the Mountain King',    artist: 'Edvard Grieg',          album: 'Peer Gynt Suite No. 1',        ms: 218000 },
  { n: 14, color: '#9A3412', label: 'MG', pid: 'stub-minuet-g',              title: 'Minuet in G Major',                   artist: 'Johann Sebastian Bach', album: 'Notebook for Anna Magdalena',  ms: 148000 },
  { n: 15, color: '#1E40AF', label: 'AV', pid: 'stub-ave-maria',             title: 'Ave Maria',                           artist: 'Franz Schubert',        album: 'Songs and Lieder, Op. 52',     ms: 286000 },
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Users
    await client.query(
      `INSERT INTO users(id, type) VALUES ($1, 'account'), ($2, 'guest')
       ON CONFLICT (id) DO NOTHING`,
      [IDS.adminUser, IDS.guestUser],
    );

    // Admin account (role = admin)
    await client.query(
      `INSERT INTO accounts(id, user_id, provider, provider_id, email, display_name, role)
       VALUES ($1, $2, 'stub', 'admin-001', 'admin@mrdj.dev', 'Admin DJ', 'admin')
       ON CONFLICT (id) DO NOTHING`,
      [IDS.adminAccount, IDS.adminUser],
    );

    // Demo event — "The Ocean's Eleven After Party" (slug: demo)
    await client.query(
      `INSERT INTO events(id, slug, name, owner_id, status, started_at)
       VALUES ($1, 'demo', 'The Ocean''s Eleven After Party', $2, 'live', now())
       ON CONFLICT (id) DO NOTHING`,
      [IDS.demoEvent, IDS.adminAccount],
    );

    // 15 CC/public-domain tracks
    for (const t of TRACKS) {
      await client.query(
        `INSERT INTO tracks(id, provider, provider_id, title, artist, album, artwork_url, duration_ms)
         VALUES ($1, 'stub', $2, $3, $4, $5, $6, $7)
         ON CONFLICT (provider, provider_id) DO NOTHING`,
        [trackId(t.n), t.pid, t.title, t.artist, t.album, svgArtwork(t.color, t.label), t.ms],
      );
    }

    // Pre-populated queue (4 played, 1 playing, 6 pending)
    for (const qi of QUEUE_ITEMS) {
      await client.query(
        `INSERT INTO queue_items(id, event_id, track_id, requester_id, position, status, is_play_next, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, false, now() - ($7::int * interval '1 minute'))
         ON CONFLICT (id) DO NOTHING`,
        [queueId(qi.n), IDS.demoEvent, trackId(qi.trackN), IDS.guestUser, qi.position, qi.status, qi.minutesAgo],
      );
    }

    // Play Next slot — available on boot
    await client.query(
      `INSERT INTO play_next_slot(event_id, status)
       VALUES ($1, 'available')
       ON CONFLICT (event_id) DO NOTHING`,
      [IDS.demoEvent],
    );

    // Wallets: guest=2 credits (free Add works, Boost=1 works once, Play Next=3 → triggers buy-more)
    await client.query(
      `INSERT INTO wallets(id, user_id, balance) VALUES ($1, $2, 2), ($3, $4, 100)
       ON CONFLICT (id) DO NOTHING`,
      [IDS.guestWallet, IDS.guestUser, IDS.adminWallet, IDS.adminUser],
    );

    // Credit ledger entry for guest initial balance (idempotency_key prevents re-grant)
    await client.query(
      `INSERT INTO credit_transactions(id, user_id, type, amount, reason, idempotency_key)
       VALUES ($1, $2, 'grant', 2, 'promo', 'seed:guest-initial-2-credits')
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [IDS.ctGuestInit, IDS.guestUser],
    );

    // Server-side pricing config (never sent raw to frontend except via QueueView.pricing)
    await client.query(`
      INSERT INTO pricing_config(key, value) VALUES
        ('queue',     0),
        ('boost',     1),
        ('play_next', 3)
      ON CONFLICT (key) DO NOTHING
    `);

    // Credit bundles: small/standard/large with bonus credits
    await client.query(
      `INSERT INTO credit_bundles(id, label, credits, bonus_credits, price_cents, discount_pct, sort_order)
       VALUES
         ($1, 'Starter Pack',   5,  0,  199,  0.00, 1),
         ($2, 'Party Pack',    15,  2,  499,  9.09, 2),
         ($3, 'VIP Pack',      30, 10,  999, 24.24, 3)
       ON CONFLICT (id) DO NOTHING`,
      [IDS.bundleStarter, IDS.bundleParty, IDS.bundleVip],
    );

    await client.query('COMMIT');
    console.log('[seed] ✓ Seed completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed] Seed failed:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => { console.error(err); process.exit(1); });
