// Voice-over synthesis. Generative cloud TTS when an API key is present,
// otherwise the native macOS `say` (the user's default Siri voice — no -v on
// purpose). Returns the clip duration in seconds. Pacing is left at the
// engine's default so narration feels like a moderately-paced live demo.
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';

function ffprobeDuration(path) {
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path,
  ]).toString().trim();
  return parseFloat(out) || 0;
}

// --- Native macOS `say` (default voice) -> AIFF -------------------------------
function sayProvider(text, outPath) {
  // No -v: use the system default (the user's Siri voice).
  execFileSync('say', ['-o', outPath, text]);
  return ffprobeDuration(outPath);
}

// --- OpenAI TTS (used only when OPENAI_API_KEY is set) -> mp3 -----------------
function openAiProvider(text, outPath) {
  const key = process.env.OPENAI_API_KEY;
  const voice = process.env.OPENAI_TTS_VOICE || 'alloy';
  const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
  const body = JSON.stringify({ model, voice, input: text, response_format: 'mp3' });
  const tmpReq = outPath + '.req.json';
  writeFileSync(tmpReq, body);
  execFileSync('curl', [
    '-sS', '-o', outPath, 'https://api.openai.com/v1/audio/speech',
    '-H', `Authorization: Bearer ${key}`,
    '-H', 'Content-Type: application/json',
    '--data', `@${tmpReq}`,
  ]);
  return ffprobeDuration(outPath);
}

export function pickProvider() {
  if (process.env.OPENAI_API_KEY) return { name: 'openai', synth: openAiProvider, ext: 'mp3' };
  return { name: 'say', synth: sayProvider, ext: 'aiff' };
}

export function synth(text, outPath) {
  const provider = pickProvider();
  const dur = provider.synth(text, outPath);
  return { path: outPath, dur, provider: provider.name };
}
