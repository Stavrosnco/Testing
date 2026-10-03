# Make It So — TNG lyric video

- `LYRICS.md` — lyrics + Suno style prompt (source of truth for the text)
- `audio/song.mp3` — the Suno track
- `timing/` — word-level lyric timing, beat grid and vocal envelope (from the GPU alignment, see `LOCAL_GPU_TASK.md`)
- `build-timeline.mjs` — merges lyrics + timing into `timeline.js`
- `scene.html` / `scene.js` — canvas renderer (open `scene.html?preview` in a browser to play along)
- `render.mjs` — headless Chromium + ffmpeg render

```
npm install
node build-timeline.mjs
node render.mjs                      # -> out/make-it-so.mp4
node render.mjs --stills 40.9,91     # spot-check frames
node render.mjs --from 60 --to 90    # partial preview
```
