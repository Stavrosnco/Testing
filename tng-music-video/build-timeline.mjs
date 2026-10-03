// Parses LYRICS.md into a timed timeline for the renderer.
// Timing: estimated from BPM, unless timing.json exists ({ bpm, beatOffset, lines: [startSec, ...] }).
import fs from 'node:fs';

const DIR = new URL('.', import.meta.url).pathname;
const md = fs.readFileSync(DIR + 'LYRICS.md', 'utf8');
const lyrics = md.split('## Lyrics')[1].split('```')[1];

const CREW = ['picard', 'riker', 'data', 'worf', 'geordi', 'troi', 'crusher'];

function sectionFor(tag) {
  const name = tag.split(':')[0].trim().toLowerCase();
  if (CREW.includes(name)) return { type: 'verse', char: name };
  if (name === 'intro') return { type: 'intro' };
  if (name === 'ensemble') return { type: 'ensemble' };
  if (name === 'chorus') return { type: 'chorus' };
  if (name === 'final chorus') return { type: 'finale' };
  if (name === 'q') return { type: 'q', char: 'q' };
  if (name === 'breakdown') return { type: 'borg' };
  if (name === 'outro') return { type: 'outro', char: 'picard' };
  throw new Error('Unknown section tag: ' + tag);
}

// [regex, fx, bars]
const FX = [
  [/^Space\.\.\./, 'frontier', 2.5],
  [/FOUR! LIGHTS/, 'fourlights', 1],
  [/^ENGAGE/, 'engage', 1],
  [/Earl Grey/, 'tea'],
  [/Picard Maneuver/, 'tunic'],
  [/^"Mister Worf/, 'worfcall', 1],
  [/^"\.\.\.FIRE/, 'fire', 1],
  [/cube upon the screen/, 'cube'],
  [/Felis catus|endothermic/, 'spot'],
  [/Sherlock Holmes/, 'holmes'],
  [/open fire/, 'openfire'],
  [/Prune juice/, 'prune', 1],
  [/merry man/, 'merry'],
  [/good day to die/, 'die'],
  [/RAMMING SPEED/, 'ram', 1],
  [/VISOR/, 'visor'],
  [/tachyon|technobabble/, 'babble'],
  [/take my word/, 'wink', 1.5],
  [/I sense/, 'sense'],
  [/Lwaxana|Chalice/, 'lwaxana'],
  [/Imzadi/, 'heart'],
  [/saucer in a hill/, 'crash'],
  [/Dancing Doctor/, 'dance'],
  [/SHUT UP, WESLEY/, 'wesley', 1],
  [/Let him speak/, 'letspeak', 1],
  [/warp bubble/, 'bubble'],
  [/spheroid region/, 'universe', 1.5],
  [/With the UNIVERSE/, 'universe2', 1],
  [/^Snap/, 'snap'],
  [/Mon capitaine/, 'qenter'],
  [/trial/, 'trial'],
  [/introduced you to the Borg/, 'cube'],
  [/not for the timid/, 'timid', 1.5],
  [/We are the Borg/, 'borg', 1.5],
  [/Resistance is futile/, 'futile', 1.5],
  [/Locutus of Borg/, 'locutus', 1.5],
  [/Come back to us/, 'comeback', 1],
  [/line must be drawn/, 'line', 1],
  [/NO FURTHER/, 'nofurther', 1.5],
  [/Picard! Riker!/, 'rollcall', 2],
  [/^Make it so/, 'mis'],
  [/make it so!$/, 'misfinal'],
  [/NCC|N-C-C/, 'registry'],
  [/long time ago/, 'poker', 2],
  [/Five-card stud/, 'cards', 2],
  [/sky's the limit/, 'sky', 3],
];

const sections = [];
let cur = null;
for (const raw of lyrics.split('\n')) {
  const line = raw.trim();
  if (!line) continue;
  const m = line.match(/^\[(.+)\]$/);
  if (m) {
    cur = { tag: m[1], ...sectionFor(m[1]), lines: [] };
    sections.push(cur);
    continue;
  }
  let text = line, voice = null;
  const v = line.match(/^\(([^)]+)\)\s*(.+)$/);
  if (v && /Ensemble|Picard/.test(v[1])) { voice = v[1].split(',')[0].toLowerCase(); text = v[2]; }
  let fx = null, bars = 1;
  for (const [re, f, b] of FX) if (re.test(text)) { fx = f; if (b) bars = b; break; }
  if (cur.type === 'outro' && !fx) bars = 2;
  cur.lines.push({ text, fx, bars, voice });
}

const timing = fs.existsSync(DIR + 'timing.json') ? JSON.parse(fs.readFileSync(DIR + 'timing.json', 'utf8')) : null;
const bpm = timing?.bpm ?? 128;
const bar = (4 * 60) / bpm;
const LEAD = { intro: 0.5, ensemble: 1, verse: 1, chorus: 0, q: 1, borg: 2, finale: 1, outro: 1 };

let t = timing?.beatOffset ?? 1.0;
let idx = 0;
for (const s of sections) {
  t += (LEAD[s.type] ?? 0) * bar;
  for (const l of s.lines) {
    if (timing?.lines?.[idx] != null) t = timing.lines[idx];
    l.start = +t.toFixed(3);
    l.idx = idx++;
    t += l.bars * bar;
  }
  s.end = t;
}
for (let i = 0; i < sections.length; i++) {
  const s = sections[i];
  s.start = i === 0 ? 0 : sections[i - 1].end;
  const next = sections[i + 1];
  s.end = +(next ? next.lines[0].start - (LEAD[next.type] ?? 0) * bar : s.end + 2 * bar).toFixed(3);
  s.start = +s.start.toFixed(3);
  for (let j = 0; j < s.lines.length; j++) {
    const nl = s.lines[j + 1];
    s.lines[j].end = nl ? nl.start : Math.min(s.end, s.lines[j].start + s.lines[j].bars * bar + bar);
  }
}
const duration = +(timing?.duration ?? sections.at(-1).end + 4).toFixed(3);
const out = { bpm, beatOffset: timing?.beatOffset ?? 1.0, duration, sections };
fs.writeFileSync(DIR + 'timeline.js', 'window.TIMELINE = ' + JSON.stringify(out, null, 1) + ';\n');
console.log(`timeline: ${sections.length} sections, ${idx} lines, ${duration.toFixed(1)}s @ ${bpm} bpm`);
for (const s of sections) console.log(`  ${s.start.toFixed(1).padStart(6)}s  ${s.type}${s.char ? ':' + s.char : ''}`);
