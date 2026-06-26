// Epic UI Review Remediation — Wave 3 reel (issues #127, #128, #129).
// Branding (logo + hero), per-event QR + kiosk, and the polish pass.
// Desktop-only narrated MP4 on a 1280x800 canvas.
// Run from demos/:  npm run wave3   (app must be up at localhost:5173)
import { record } from '../recorder/engine.mjs';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'out');

// Guard against a stale Vite bundle: reload until the target selector is present.
const ensureFresh = async (s, sel) => {
  for (let i = 0; i < 5; i++) {
    if (await s.page.locator(sel).count()) return;
    await s.page.reload({ waitUntil: 'domcontentloaded' });
    await s.sleep(1500);
  }
  throw new Error(`stale UI: ${sel} never appeared`);
};

const desktop = await record({
  name: 'wave3-ui-desktop',
  summary: 'Wave 3 — branding, QR + kiosk, polish',
  base: 'http://localhost:5173',
  scenes: [
    {
      title: 'UI Review Remediation',
      subtitle: 'Wave 3 — branding & room join',
      vo: "Wave three closes out the epic — organization branding, room join with Q R codes and a kiosk, plus a polish pass. Let's take a look.",
      run: async (s) => { await s.actAs('admin'); await s.goto('/o/demo/dashboard', 1400); await ensureFresh(s, '[data-testid="settings-logo-url"]'); },
    },
    {
      caption: 'Editable org branding',
      vo: "Organizations can now brand themselves. From the dashboard you drop in a logo image link and an optional hero image, then save. Secure links only — leave a field blank to remove it.",
      run: async (s) => {
        await s.glide('[data-testid="settings-logo-url"]', { click: false });
        await s.sleep(900);
        await s.glide('[data-testid="settings-hero-url"]', { click: false });
        await s.sleep(900);
        await s.glide('[data-testid="settings-branding-save"]', { click: false });
        await s.sleep(1200);
      },
    },
    {
      caption: 'Hero + logo on the event',
      vo: "Here's the payoff. The guest event page now leads with the org's hero image, gradient-blending into the brand accent, with the logo and event name layered on top. It instantly feels like the venue's own screen.",
      run: async (s) => {
        await s.goto('/o/demo/events/demo', 1400);
        await ensureFresh(s, '[data-testid="org-hero"]');
        await s.glide('[data-testid="org-hero"]', { click: false });
        await s.sleep(1400);
        await s.scroll(200); await s.sleep(900); await s.scroll(-200); await s.sleep(500);
      },
    },
    {
      caption: 'Per-event QR code',
      vo: "To get guests into the room, every event now has its own Q R code on the manage page. It encodes the public guest link, so a D J can enlarge it, print it, or drop it on a table tent.",
      run: async (s) => {
        await s.goto('/o/demo/events/demo/manage', 1400);
        await ensureFresh(s, '[data-testid="event-qr"]');
        await s.glide('[data-testid="event-qr"]', { click: false });
        await s.sleep(1400);
        await s.glide('[data-testid="open-kiosk"]', { click: false });
        await s.sleep(1000);
      },
    },
    {
      caption: 'Full-screen kiosk',
      vo: "And there's a dedicated kiosk view — a full-screen, glanceable scan-to-request screen for a tablet or a T V at the venue. Big code, the org's branding, nothing else in the way.",
      run: async (s) => {
        await s.goto('/o/demo/events/demo/kiosk', 1600);
        await ensureFresh(s, '[data-testid="kiosk-qr"]');
        await s.glide('[data-testid="kiosk-qr"]', { click: false });
        await s.sleep(2400);
      },
    },
    {
      caption: 'Polish pass',
      vo: "Underneath, a polish pass tied it together — a consistent violet accent, friendly names instead of raw I Ds, titles that truncate cleanly, close buttons on every dialog, and dev-only controls gated out of the guest experience. That's the epic, shipped.",
      run: async (s) => {
        await s.goto('/o/demo/dashboard', 1400);
        await s.sleep(1200);
        await s.glide('[data-testid="recent-event-row"]', { click: false });
        await s.sleep(1800);
      },
    },
  ],
});

const date = new Date().toISOString().slice(0, 10);
const final = join(OUT, `wave3-ui-tour-${date}.mp4`);
console.log('\n🎬 finalizing →', final);
execFileSync('ffmpeg', [
  '-y', '-i', desktop,
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21',
  '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart',
  final,
], { stdio: 'inherit' });

console.log('\n✅ Wave 3 reel:', final);
