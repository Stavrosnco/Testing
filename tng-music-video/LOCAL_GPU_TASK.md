# Task for the local GPU machine: lyric timing for "Make It So"

The cloud session building the music video can't download speech models, so it needs you to produce
word-level timing for the song. You only produce data files — don't touch the renderer or other code.

## Inputs (repo `Stavrosnco/Testing`, branch `claude/tng-music-video`)
- `tng-music-video/audio/song.mp3` — the Suno track (~4:28)
- `tng-music-video/LYRICS.md` — the intended lyrics: the fenced block under `## Lyrics`.
  Lines like `[Picard: British male rap]` are section tags, not sung. A leading `(Ensemble)` /
  `(Picard, roaring)` is a voice note, not sung; parentheticals elsewhere, e.g. `(Make it so!)`, ARE sung.
  Suno may have skipped, repeated, reordered or reworded lines — the audio is the source of truth.

## Steps
1. Python venv with CUDA torch. Suggested: `demucs`, `openai-whisper` (or `faster-whisper`/`stable-ts`), `librosa`, `rapidfuzz`.
2. **Isolate vocals**: `demucs --two-stems=vocals -n htdemucs` on song.mp3. Work on the vocals stem for everything speech-related.
3. **Transcribe** the vocals stem with Whisper large-v3 (English, `word_timestamps=True`, `condition_on_previous_text=False`
   helps on repeated chorus lines). Pass the lyrics as `initial_prompt` (or the first ~200 words) to bias spelling.
4. **Align lyrics to transcript**: normalize both (lowercase, strip punctuation, numbers as words) and do a
   word-level sequence alignment (e.g. difflib/Needleman-Wunsch with fuzzy word similarity). Map each intended lyric
   line to its sung span. Interpolate times for lyric words Whisper missed if their neighbors matched.
   If a line clearly wasn't sung, give it `start: null`. If stable-ts is available, a forced-alignment pass
   (`model.align(vocals, text)`) per section, constrained to the window found above, usually tightens timings — optional.
5. **Beat grid** from the full mix: `librosa.beat.beat_track` (and tempo). Downbeats if you can (e.g. `madmom` or
   `beat_this`); otherwise skip.
6. **Vocal envelope** for lip-sync: RMS of the vocals stem at 30 fps, normalized to 0–1 (95th percentile = 1).
7. **Sanity check**: print a table of line idx / start / end / text, and list deviations (skipped, repeated,
   reworded, extra ad-libs). Spot-check a few timestamps by ear if you can.

## Outputs — commit to `tng-music-video/timing/` and push to `claude/tng-music-video`
- `lines.json`:
  ```json
  {
    "duration": 268.56,
    "lines": [
      {"idx": 0, "section": "Intro", "text": "Space... the final frontier.", "start": 1.23, "end": 4.56,
       "words": [{"w": "Space", "start": 1.23, "end": 1.80}, ...], "confidence": 0.9}
    ],
    "extra": [{"text": "sung text not in the lyrics", "start": 12.3, "end": 14.0, "after_idx": 5}],
    "notes": "free text: anything odd (e.g. chorus sung 3x, Data verse rewords line 4)"
  }
  ```
  `idx` = 0-based order of sung lyric lines in LYRICS.md (tags excluded) — there are 98. `section` = the tag name
  before the colon (e.g. "Picard", "Chorus", "Final Chorus"). Times in seconds from the start of song.mp3.
- `beats.json`: `{"bpm": 128.0, "beats": [..seconds..], "downbeats": [..seconds..] }` (omit downbeats if unknown)
- `vocal_env.json`: `{"fps": 30, "env": [0.0, 0.12, ...]}`
- `transcript.json`: the raw Whisper result (segments + words), for debugging.

Don't commit the demucs stems or model files. Commit message: "Add lyric timing for Make It So".
