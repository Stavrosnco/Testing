// Renders scene.html frame-by-frame with headless Chromium and encodes with ffmpeg.
//   node render.mjs                     full video -> out/make-it-so.mp4
//   node render.mjs --stills 12.5,40    PNG stills -> out/still-<t>.png
//   node render.mjs --from 30 --to 60   partial render (preview)
//   options: --fps 30  --workers 4  --scale 1 (0.5 = 960x540 draft)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const DIR = new URL('.', import.meta.url).pathname;
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const FPS = +arg('fps', 30), WORKERS = +arg('workers', 4), SCALE = +arg('scale', 1);
fs.mkdirSync(DIR + 'out', { recursive: true });

global.window = {};
eval(fs.readFileSync(DIR + 'timeline.js', 'utf8'));
const TL = window.TIMELINE;

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto('file://' + DIR + 'scene.html');
  await page.evaluate(() => window.sceneReady);
  return page;
}
const grab = (page, times, scale) => page.evaluate(({ times, scale }) => {
  const c = document.getElementById('c');
  let out = c;
  if (scale !== 1) { out = document.createElement('canvas'); out.width = 1920 * scale; out.height = 1080 * scale; }
  return times.map((t) => { renderFrame(t); if (out !== c) out.getContext('2d').drawImage(c, 0, 0, out.width, out.height); return out.toDataURL('image/jpeg', 0.93).split(',')[1]; });
}, { times, scale });

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });

if (arg('stills')) {
  const page = await openPage(browser);
  for (const t of arg('stills').split(',').map(Number)) {
    await page.evaluate((t) => renderFrame(t), t);
    await page.locator('#c').screenshot({ path: `${DIR}out/still-${t.toFixed(2)}.png` });
    console.log('still', t);
  }
  await browser.close();
  process.exit(0);
}

const from = +arg('from', 0), to = Math.min(+arg('to', TL.duration), TL.duration);
const total = Math.ceil((to - from) * FPS);
const per = Math.ceil(total / WORKERS);
const t0 = Date.now(); let done = 0;
const segs = await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
  const a = w * per, b = Math.min(total, a + per); if (a >= b) return null;
  const file = `${DIR}out/seg-${w}.mp4`;
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const page = await openPage(browser);
  for (let f = a; f < b; f += 15) {
    const times = []; for (let k = f; k < Math.min(b, f + 15); k++) times.push(from + k / FPS);
    for (const b64 of await grab(page, times, SCALE)) if (!ff.stdin.write(Buffer.from(b64, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
    done += times.length;
    if (w === 0 && (f / 15) % 20 === 0) { const el = (Date.now() - t0) / 1000; console.log(`${done}/${total} frames, ${el.toFixed(0)}s elapsed, ~${((total - done) * el / done).toFixed(0)}s left`); }
  }
  ff.stdin.end(); await new Promise((r) => ff.on('close', r));
  return file;
}));
await browser.close();
const list = segs.filter(Boolean).map((f) => `file '${f}'`).join('\n');
fs.writeFileSync(DIR + 'out/segs.txt', list);
const outName = arg('out', from === 0 && to === TL.duration ? 'make-it-so.mp4' : `preview-${from}-${to}.mp4`);
await new Promise((res, rej) => {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', DIR + 'out/segs.txt', '-ss', String(from), '-t', String(to - from), '-i', DIR + 'audio/song.mp3',
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', 'apad', '-c:a', 'aac', '-b:a', '256k', '-t', String(to - from), '-movflags', '+faststart', DIR + 'out/' + outName], { stdio: 'inherit' });
  ff.on('close', (c) => (c ? rej(new Error('ffmpeg ' + c)) : res()));
});
for (const f of segs.filter(Boolean)) fs.unlinkSync(f);
console.log(`wrote out/${outName} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
