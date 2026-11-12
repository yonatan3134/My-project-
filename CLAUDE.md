# Video editor

This repo is a code-driven video editor: yt-dlp (download), FFmpeg (cut, reframe, mix),
Whisper via faster-whisper with the ivrit.ai model for Hebrew (transcribe), and Remotion
and HyperFrames (captions, titles, motion graphics, render).

**Before any video task, load the `video-editor` skill** (`.claude/skills/video-editor/SKILL.md`).
It holds the pipeline, the folder layout and the checks. Then load the tool's own skill:
`remotion-best-practices` for Remotion, `hyperframes` and `hyperframes-cli` for HyperFrames.

## Quick reference

```bash
bash scripts/setup.sh        # install everything (also after a fresh clone or container)
bash scripts/doctor.sh       # verify tools, browsers, models, network
bash scripts/download.sh <url>                 # -> media/raw/
bash scripts/transcribe.sh <file> [--lang he]  # -> media/transcripts/<name>/
bash scripts/jumpcut.sh <file>                 # remove silent pauses -> media/work/
bash scripts/caption.sh <file>                 # transcribe + animated captions -> out/
bash scripts/frames.sh <video> [count]         # contact sheet PNG: look at footage and renders
```

- Source footage goes in `media/raw/`, intermediates in `media/work/`, finished videos in `out/`.
  None of these are in git.
- Remotion project: `remotion/` (compositions in `src/Root.tsx`, media under `public/`).
- HyperFrames projects: `hyperframes/projects/<name>/` (`demo` is a working example).

## Rules

- The user writes in Hebrew: reply in Hebrew. Hebrew on screen needs `dir="rtl"` and the Heebo font
  (`assets/fonts/heebo/`); the skill has the details.
- Look at what you made before saying it is done: `ffprobe` the duration, `frames.sh` the render,
  read the PNG.
- Transcribe after cutting, not before, so caption times match the picture.
- Do not commit media or renders. Commit compositions, scripts and small assets.
- Telemetry for HyperFrames is off on purpose; HeyGen sign-in, publishing and cloud renders are
  the user's call.
- In cloud sessions the network is an allowlist. If a download is blocked, report the host; do not
  work around it.
