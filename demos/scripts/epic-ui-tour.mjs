// Epic UI Review Remediation — Waves 1 & 2 reel (issues #119-#126).
// Records a desktop segment + a native-phone segment, then pads the phone clip
// onto a 1280x800 canvas and concatenates the two into one narrated MP4.
// Run from demos/:  npm run epic   (app must be up at localhost:5173)
import { record } from '../recorder/engine.mjs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'out');

const SEARCH = '[data-testid="search-overlay"]';
const openSearch = async (s, q) => {
  await s.glide('[data-testid="search-trigger"]');
  await s.sleep(500);
  await s.type(`${SEARCH} input`, q, 120);
  await s.sleep(1400);
};

// Guard against a stale Vite bundle: reload until the redesigned UI is present.
const ensureFresh = async (s, sel) => {
  for (let i = 0; i < 5; i++) {
    if (await s.page.locator(sel).count()) return;
    await s.page.reload({ waitUntil: 'domcontentloaded' });
    await s.sleep(1500);
  }
  throw new Error(`stale UI: ${sel} never appeared`);
};

// ── Desktop segment ──────────────────────────────────────────────────────────
const desktop = await record({
  name: 'epic-ui-desktop',
  summary: 'Waves 1 & 2 UI remediation — desktop',
  base: 'http://localhost:5173',
  scenes: [
    {
      title: 'UI Review Remediation',
      subtitle: 'Waves 1 & 2 — eight fixes shipped',
      vo: "We took the U I review and turned it into an epic. Here are the eight fixes from waves one and two, now live. Let's walk through them.",
      run: async (s) => { await s.actAs('guest'); await s.goto('/o/demo/events/demo', 1200); await ensureFresh(s, '[data-testid="search-trigger"]'); },
    },
    {
      caption: 'Responsive jukebox',
      vo: "The guest jukebox was redesigned. On a wide screen it's now two columns — the now playing hero and the live queue on the left, search on the right — and the old duplicate up-next list is gone.",
      run: async (s) => {
        await s.sleep(900);
        await s.scroll(220); await s.sleep(900); await s.scroll(-220); await s.sleep(500);
      },
    },
    {
      caption: 'Play Next, ghosted until you buy',
      vo: "When a play-next slot is open we no longer show a dead button. It's a ghosted, dashed card that invites the guest to buy the slot — clear, but never in the way.",
      run: async (s) => {
        await s.glide('[data-testid="play-next-cta"]', { click: false });
        await s.sleep(1500);
      },
    },
    {
      caption: 'Search overlay + gold tokens',
      vo: "Search now opens as a floating overlay, so the queue behind it never jumps. And every paid action shows its price as a gold credit token, right on the button.",
      run: async (s) => {
        await openSearch(s, 'kenny');
        await s.glide(`${SEARCH} [data-testid="cost-token"]`, { click: false });
        await s.sleep(1400);
        await s.page.keyboard.press('Escape').catch(() => {});
        await s.sleep(500);
      },
    },
    {
      caption: 'Contextual confirm — Add to Queue',
      vo: "Adding a free track now pops a contextual confirmation that knows exactly what you're doing — Add to Queue — with a clear close button. No more generic dialogs.",
      run: async (s) => {
        await openSearch(s, 'kenny');
        await s.glide(`${SEARCH} button[aria-label*="to queue (free)" i]`);
        await s.sleep(1200);
        await s.glide('[data-testid="modal-primary-button"]');
        await s.sleep(1400);
      },
    },
    {
      caption: 'Affordability — guided upsell',
      vo: "If a guest can't afford to play their song next, the button still works — but instead of failing, it routes them straight to Buy Credits. The spend path turns a dead end into a sale.",
      run: async (s) => {
        await openSearch(s, 'kenny');
        await s.glide(`${SEARCH} button[aria-label*="Play Next:" i]`);
        await s.sleep(1600);
        await s.glide('[data-testid="modal-primary-button"]', { click: false });
        await s.sleep(1200);
        await s.glide('[data-testid="modal-close"]');
        await s.sleep(500);
      },
    },
    {
      caption: 'Consolidated header',
      vo: "The header was cleaned up. Credits are now a single tappable button, and everything else — including the dev role switch — tucks into a user menu in the top right.",
      run: async (s) => {
        await s.glide('[data-testid="header-buy-credits"]', { click: false });
        await s.sleep(800);
        await s.glide('[data-testid="header-user-menu"]');
        await s.sleep(1600);
        await s.page.keyboard.press('Escape').catch(() => {});
        await s.sleep(400);
      },
    },
    {
      caption: 'Theme-aware DJ console',
      vo: "Now the booth. The D J console used to be stuck dark and washed out. It's now fully theme-aware — readable in light, and crisp in dark.",
      run: async (s) => {
        await s.actAs('admin');
        await s.goto('/o/demo/events/demo/console', 1400);
        await s.sleep(800);
        await s.glide('button[aria-label="Toggle theme"]');
        await s.sleep(600);
        await s.glide('text=Dark');
        await s.sleep(2600);
      },
    },
    {
      caption: 'Faster paths for the DJ',
      vo: "And the dashboard gives the D J quicker paths — a console shortcut when an event is live, and recent events you can click straight through to manage.",
      run: async (s) => {
        await s.goto('/o/demo/dashboard', 1200);
        await s.glide('[data-testid="dashboard-console-shortcut"]', { click: false });
        await s.sleep(900);
        await s.glide('[data-testid="recent-event-row"]', { click: false });
        await s.sleep(1200);
      },
    },
  ],
});

// ── Mobile segment (native phone viewport) ───────────────────────────────────
const mobile = await record({
  name: 'epic-ui-mobile',
  summary: 'Waves 1 & 2 UI remediation — mobile',
  base: 'http://localhost:5173',
  viewport: { width: 390, height: 844 },
  scenes: [
    {
      title: 'On the phone',
      subtitle: 'where most guests actually are',
      vo: "Most guests are on a phone — so these fixes matter most here.",
      run: async (s) => { await s.actAs('guest'); await s.goto('/o/demo/events/demo', 1200); await ensureFresh(s, '[data-testid="search-trigger"]'); },
    },
    {
      caption: 'One clean queue',
      vo: "The mobile jukebox is a single, clean column — now playing on top, one Coming Up list below. The duplicate queue that used to clutter the phone is gone.",
      run: async (s) => {
        await s.sleep(900);
        await s.scroll(320); await s.sleep(1100); await s.scroll(-320); await s.sleep(600);
      },
    },
    {
      caption: 'Mobile admin nav',
      vo: "And the admin shell finally has a real mobile menu — a hamburger that opens a focus-trapped drawer, so D Js can run the night from their phone.",
      run: async (s) => {
        await s.actAs('admin');
        await s.goto('/o/demo/dashboard', 1200);
        await s.glide('[data-testid="mobile-nav-button"]');
        await s.sleep(1400);
        await s.glide('[data-testid="mobile-nav-drawer"] a', { click: false });
        await s.sleep(1200);
      },
    },
  ],
});

// ── Stitch: pad the phone clip onto a 1280x800 canvas, then concat ───────────
const date = new Date().toISOString().slice(0, 10);
const final = join(OUT, `epic-ui-tour-${date}.mp4`);
console.log('\n🎬 stitching desktop + mobile →', final);
execFileSync('ffmpeg', [
  '-y',
  '-i', desktop,
  '-i', mobile,
  '-filter_complex',
  // desktop is already 1280x800; phone is scaled to 800 tall and centered on a dark canvas
  '[0:v]setsar=1[v0];' +
  "[1:v]scale=-2:800:flags=lanczos,pad=1280:800:(ow-iw)/2:(oh-ih)/2:color=0x0a0a0a,setsar=1[v1];" +
  '[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[v][a]',
  '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21',
  '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
  final,
], { stdio: 'inherit' });

console.log('\n✅ Epic reel:', final);
