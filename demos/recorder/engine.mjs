// Demo engine: drives the live app with the HUD, records video, generates a
// timed AI voice-over, and muxes them into a single MP4. Audio clips are
// pre-synthesized so each scene dwells long enough for its narration, then the
// clips are placed at their recorded wall-clock offsets and mixed onto the video.
import { chromium } from 'playwright';
import { mkdirSync, readdirSync, writeFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { HUD } from './hud.mjs';
import { synth, pickProvider } from './tts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'out');
const RAW = join(OUT, 'raw');
const VO = join(OUT, 'vo');

const VIEW = { width: 1280, height: 800 };

export async function record(def) {
  const base = def.base || 'http://localhost:5173';
  const api = def.api || base.replace(':5173', ':3001');
  const view = def.viewport || VIEW;
  const scenes = def.scenes || [];

  for (const d of [OUT, RAW, VO]) mkdirSync(d, { recursive: true });

  // 1) Pre-synthesize narration so we know each scene's dwell time.
  const provider = pickProvider();
  console.log(`🎙  voice-over provider: ${provider.name}`);
  scenes.forEach((sc, i) => {
    if (!sc.vo) { sc._voDur = 0; return; }
    const p = join(VO, `vo${String(i).padStart(2, '0')}.${provider.ext}`);
    const { dur } = synth(sc.vo, p);
    sc._voPath = p; sc._voDur = dur;
    console.log(`   scene ${i} (${dur.toFixed(1)}s): ${sc.vo.slice(0, 56)}…`);
  });

  // 2) Record.
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: view, recordVideo: { dir: RAW, size: view } });
  await ctx.addInitScript(HUD);
  const page = await ctx.newPage();
  const videoT0 = Date.now(); // video timeline starts ~here

  const sleep = (ms) => page.waitForTimeout(ms);
  const helpers = {
    page, base, api, sleep,
    goto: (path, wait = 1000) =>
      page.goto(base + path, { waitUntil: 'domcontentloaded' }).then(() => sleep(wait)),
    async glide(sel, { click = true, steps = 26 } = {}) {
      const el = page.locator(sel).first();
      await el.scrollIntoViewIfNeeded().catch(() => {});
      const box = await el.boundingBox();
      if (!box) throw new Error('no box for ' + sel);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps });
      await sleep(240);
      if (click) { await page.mouse.down(); await sleep(90); await page.mouse.up(); }
      return el;
    },
    async type(sel, text, perKey = 150) {
      await this.glide(sel);
      for (const ch of text) { await page.keyboard.press(ch); await sleep(perKey); }
    },
    async actAs(role) {
      await ctx.request.post(api + '/api/dev/act-as', { data: { role } });
    },
    async caption(text) { await page.evaluate((t) => window.__demoCaption(t), text); },
    captionHide: () => page.evaluate(() => window.__demoCaptionHide()),
    scroll: (y) => page.mouse.wheel(0, y),
  };

  const audioPlan = [];
  for (const sc of scenes) {
    if (sc.title) {
      await page.evaluate(([t, s]) => window.__demoTitle(t, s), [sc.title, sc.subtitle || '']);
      await sleep(700);
    } else if (sc.caption) {
      await helpers.caption(sc.caption);
    }

    const offset = Date.now() - videoT0; // narration starts now
    if (sc._voPath) audioPlan.push({ offset, path: sc._voPath, dur: sc._voDur });

    const sceneStart = Date.now();
    if (sc.run) await sc.run(helpers);

    const elapsed = (Date.now() - sceneStart) / 1000;
    const need = (sc._voDur || 0) + (sc.tailPad ?? 0.7);
    if (elapsed < need) await sleep((need - elapsed) * 1000);

    if (sc.title) { await page.evaluate(() => window.__demoTitleHide()); await sleep(450); }
    else if (sc.caption) { await helpers.captionHide(); await sleep(200); }
  }

  await ctx.close(); // finalizes the webm
  await browser.close();

  // 3) Find the recording.
  const webm = readdirSync(RAW).filter((f) => f.endsWith('.webm'))
    .map((f) => join(RAW, f)).sort().pop();

  // 4) Mux: scale video + place each VO clip at its offset, mix onto the track.
  const date = new Date().toISOString().slice(0, 10);
  const out = join(OUT, `${def.name || 'demo'}-${date}.mp4`);
  const inputs = ['-y', '-i', webm];
  const filters = [`[0:v]scale=${view.width}:${view.height}:flags=lanczos[v]`];
  const mixLabels = [];
  audioPlan.forEach((a, idx) => {
    inputs.push('-i', a.path);
    const d = Math.round(a.offset);
    filters.push(`[${idx + 1}:a]adelay=${d}|${d}[a${idx + 1}]`);
    mixLabels.push(`[a${idx + 1}]`);
  });

  const args = [...inputs];
  if (mixLabels.length) {
    filters.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:normalize=0:dropout_transition=0[aout]`);
    args.push('-filter_complex', filters.join(';'),
      '-map', '[v]', '-map', '[aout]',
      '-c:a', 'aac', '-b:a', '160k');
  } else {
    args.push('-filter_complex', filters.join(';'), '-map', '[v]');
  }
  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21',
    '-movflags', '+faststart', out);
  execFileSync('ffmpeg', args, { stdio: 'inherit' });

  // 5) Index (gitignored).
  const indexLine = `- ${date} — **${def.name}** — ${def.summary || ''} — \`${out.split('/').slice(-1)[0]}\`\n`;
  try {
    const idx = join(OUT, 'INDEX.md');
    let prev = ''; try { prev = readdirSync(OUT).includes('INDEX.md') ? execFileSync('cat', [idx]).toString() : ''; } catch {}
    if (!prev) prev = '# Demo Reels — index\n\n';
    writeFileSync(idx, prev + indexLine);
  } catch {}

  console.log('\n✅ MP4:', out);
  return out;
}
