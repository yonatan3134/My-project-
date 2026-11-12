#!/usr/bin/env bash
# Install everything the video editor needs. Safe to run again.
#   bash scripts/setup.sh
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$ROOT"

echo "==> FFmpeg"
if ! command -v ffmpeg >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && apt-get install -y -qq ffmpeg
  else
    echo "ffmpeg is missing. Install it first (macOS: brew install ffmpeg)." >&2
    exit 1
  fi
fi
ffmpeg -version | head -1

echo "==> Python tools (yt-dlp, faster-whisper) in .venv"
[ -x .venv/bin/python ] || python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt

echo "==> Remotion"
(cd remotion && npm ci --no-audit --no-fund --loglevel=error)
# Remotion's own tested browser. If its host is unreachable, renders fall back
# to a pre-installed headless shell (see remotion/remotion.config.ts).
(cd remotion && REMOTION_NO_BROWSER_FALLBACK=1 npx remotion browser ensure >/dev/null 2>&1) || echo "   (Remotion browser download skipped)"

echo "==> HyperFrames"
(cd hyperframes && npm ci --no-audit --no-fund --loglevel=error)
(cd hyperframes && npx hyperframes telemetry disable >/dev/null 2>&1) || true
# Without its headless shell HyperFrames still renders, with system Chrome, slower.
(cd hyperframes && npx hyperframes browser ensure >/dev/null 2>&1) || echo "   (HyperFrames browser download skipped)"

echo "==> Done. Check with: bash scripts/doctor.sh"
