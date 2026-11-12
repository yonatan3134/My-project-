---
name: video-editor
description: Read first for any video task in this repo - download footage (yt-dlp), cut, trim, reframe or mix it (FFmpeg), transcribe it (Whisper, ivrit.ai for Hebrew), add captions, titles and motion graphics (Remotion or HyperFrames) and render the result. Holds the folder layout, the pipeline, which tool does what, and the checks to run before showing a result.
---

# Video editor

This repo is a code-driven video editor. Five tools, one pipeline:

| Step | Tool | Entry point |
| --- | --- | --- |
| Get footage | yt-dlp | `bash scripts/download.sh <url>` |
| Cut, trim, reframe, mix, convert | FFmpeg | `bash scripts/jumpcut.sh`, [references/ffmpeg-recipes.md](references/ffmpeg-recipes.md) |
| Transcribe to word timings | Whisper (faster-whisper; ivrit.ai model for Hebrew) | `bash scripts/transcribe.sh <file>` |
| Captions, titles, motion graphics in React | Remotion | `remotion/`, skill `remotion-best-practices` |
| Captions, titles, motion graphics in HTML + GSAP | HyperFrames | `hyperframes/projects/<name>/`, skills `hyperframes`, `hyperframes-cli`, `hyperframes-registry`, `media-use` |

If a command is missing, run `bash scripts/setup.sh`, then `bash scripts/doctor.sh`.

## Folders

```
media/raw/           source footage (downloads, camera files)      not in git
media/work/          intermediate files (cuts, contact sheets)     not in git
media/audio/         music, voiceover, extracted audio             not in git
media/transcripts/   <name>/<name>.captions.json, .words.json, .srt, .vtt, .segments.json, .txt
assets/              things reused across videos: fonts/, logos/, music/   in git, keep small
out/                 finished renders                              not in git
remotion/            Remotion project (src/, public/)
hyperframes/         HyperFrames CLI + projects/<name>/
scripts/             the pipeline commands below
```

Each tool reads media only from its own folder: Remotion from `remotion/public/`
(`staticFile("clips/x.mp4")`), HyperFrames from `<project>/assets/`. Copy the
prepared clip there under a plain ASCII name; `scripts/caption.sh` does this for Remotion.

## Commands

```bash
bash scripts/download.sh <url> [--audio] [--section "*1:30-2:45"] [--subs]   # -> media/raw/
bash scripts/transcribe.sh <file> [--lang he|en|...] [--prompt "Names, Terms"] # -> media/transcripts/<name>/
bash scripts/jumpcut.sh <file> [--min-silence 0.6] [--pad 0.12] [--plan-only]  # -> media/work/<name>.jumpcut.mp4 + .cuts.json
bash scripts/caption.sh <file> [--lang he] [--color "#facc15"] [--out out/x.mp4]  # transcribe + Remotion captions, one step
python3 scripts/hf-captions.py <name>.words.json hyperframes/projects/<name>   # captions scene for HyperFrames
bash scripts/frames.sh <video> [count] [out.png]                               # contact sheet, to look at a video
```

Before `npx remotion ...` or `npx hyperframes ...` in a fresh shell, run
`. scripts/env.sh` (proxy support for Node, telemetry off). The `scripts/*.sh` do it themselves.

## Choosing the tool

- **Only cutting, joining, reframing, converting, loudness, burned-in plain subtitles**: FFmpeg alone. Fastest, no browser.
- **Animated word-by-word captions on a clip**: `scripts/caption.sh` (Remotion `CaptionedVideo`).
- **A video built from scenes, data-driven or templated, React components**: Remotion.
- **A designed film, title cards, lower thirds, registry blocks, HTML/CSS/GSAP**: HyperFrames. Its registry has ready caption styles, transitions and overlays (`npx hyperframes catalog`).
- Both renderers can do most things; unless asked, keep one video in one of them.

## The usual edit of a talking clip

1. `download.sh` (or copy the file into `media/raw/`). Look at it: `bash scripts/frames.sh <file> 12`, and `ffprobe` for size, frame rate, duration.
2. Tighten: `jumpcut.sh` removes pauses. For cuts by content, read `<name>.segments.json` (sentences with times) and trim with FFmpeg.
3. Reframe if needed (16:9 to 9:16): recipes file.
4. Transcribe the clip **as it will be shown** (after cutting): timestamps then match the picture.
5. Read the transcript. Fix names with `--prompt`, or edit `<name>.captions.json` by hand; `caption.sh` reuses an existing transcript.
6. Captions and graphics in Remotion or HyperFrames; render to `out/`.
7. Check the render: duration with `ffprobe`, frames with `frames.sh`, and read the PNG. Never report a video as done without looking at its frames.

## Transcription

- Language is detected, then the model is chosen: Hebrew uses `ivrit-ai/whisper-large-v3-turbo-ct2`, anything else `large-v3-turbo`. `--lang` skips detection; `--model small` trades accuracy for speed.
- Models download from Hugging Face on first use (about 1.6 GB each) into `~/.cache/huggingface`.
- On CPU expect roughly real time or faster for the turbo models.
- Output formats: `.captions.json` is Remotion's `Caption[]` (each word starts with a space; the format is whitespace sensitive), `.words.json` is HyperFrames' `[{id, text, start, end}]`, `.srt`/`.vtt` are regrouped into short balanced lines (`--max-chars`).
- Whisper invents text over silence and music. Read the result before using it.

## Hebrew and other right-to-left text

- Captions from both generators set `dir="rtl"` per caption group from its words, so mixed Hebrew/English lines order correctly. Any new text element holding Hebrew needs `dir="rtl"`.
- Use the bundled **Heebo** font (`assets/fonts/heebo/`, Hebrew + Latin, weights 100 to 900). Remotion loads it in `remotion/src/lib/fonts.ts`; HyperFrames scenes need `@font-face` pointing at `assets/fonts/` inside the project (see the generated `compositions/captions.html`).
- Animate whole words, not letters. No `letter-spacing` or `text-transform` on Hebrew.
- FFmpeg burn-in needs a TTF/OTF font with Hebrew glyphs: `FontName=DejaVu Sans` works out of the box.

## Remotion (`remotion/`)

- Read the `remotion-best-practices` skill before writing markup. Version is pinned in `remotion/package.json`; add packages with `npx remotion add <pkg>`.
- Compositions are registered in `remotion/src/Root.tsx`:
  - `CaptionedVideo`: a clip plus word-highlight captions; size and length come from the video (`calculateMetadata`). Props: `videoSrc`, `captionsSrc`, `highlightColor`, `combineWithinMs`.
  - `TitleCard`: animated title, accent line, subtitle.
  - `BirthdayGreeting`: vertical 36 s photo greeting (title with balloons, three photo scenes, finale with confetti), cut to a music-box tune. Texts, photo paths and each photo's `focus` are inline in `remotion/src/birthday/BirthdayGreeting.tsx`; photos go in `remotion/public/clips/birthday/` (not in git).
- Music without a library: `.venv/bin/python scripts/birthday-tune.py` synthesizes the music-box "Happy Birthday" (public domain melody) into `remotion/public/music/`. Bars are 1.8 s apart starting at 3.6 s, so cuts placed there land on the beat.
- Render: `cd remotion && npx remotion render <CompositionId> ../out/<name>.mp4 [--props='{"...":"..."}']`. Frames only: `npx remotion still <id> out.png --frame=60`.
- Preview: `cd remotion && npx remotion studio --no-open` (prints the URL).
- Fonts: local files only (`@remotion/fonts`). `@remotion/google-fonts` fails in cloud sessions because the render browser cannot reach the font server.
- Remotion is free for individuals and companies of up to 3 people; larger companies need a licence.

## HyperFrames (`hyperframes/`)

- Read the `hyperframes` skill first (the render contract), then `hyperframes-cli`. The CLI is installed in `hyperframes/`; run it from a project folder.
- New project: `cd hyperframes && npx hyperframes init projects/<name> --skip-skills --non-interactive [--video <file> --skip-transcribe]`. Put media in the project's `assets/`.
- `projects/demo/` is a working example: footage with sound, a lower-third scene with variables, generated captions.
- Captions: transcribe with `scripts/transcribe.sh` (not `hyperframes transcribe`, which needs a whisper.cpp build), then `python3 scripts/hf-captions.py <words.json> <project>` and mount the printed host element.
- Loop: edit, `npx hyperframes check --json` (fix every error), `npx hyperframes snapshot --at <seconds>` and read the PNGs, then `npx hyperframes render --quality draft|looks|delivery -o ../../../out/<name>.mp4`.
- The skills' "usage beacon" (`hyperframes events`) is telemetry: it is disabled here (`HYPERFRAMES_NO_TELEMETRY=1`); do not run it or turn telemetry on unless the user asks.
- HeyGen sign-in, credits, cloud render and publishing are the user's decision. Do not sign in, publish or share on your own.

## Cloud sessions (claude.ai/code)

- The container is temporary: `media/` and `out/` are lost when it is reclaimed. Send finished videos to the user, and commit only source (compositions, scripts, small assets).
- Network is an allowlist. Whisper models need `huggingface.co` and `us.aws.cdn.hf.co`; Remotion's browser needs `remotion.media`. `bash scripts/doctor.sh` shows what is reachable.
- **YouTube downloads need more than an exact-host allowlist** (video data comes from changing `*.googlevideo.com` hosts) and YouTube often refuses data-centre addresses. If `download.sh` is blocked, say so and ask the user to upload the file or widen the environment's network access in its settings; do not work around it.
- Only download material the user has the right to use.
