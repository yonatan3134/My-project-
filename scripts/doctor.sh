#!/usr/bin/env bash
# Check that every tool of the video editor is installed and can run.
#   bash scripts/doctor.sh
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$ROOT" || exit 1

failed=0
check() {
  local name="$1"
  shift
  local out
  if out="$("$@" 2>/dev/null | head -1)" && [ -n "$out" ]; then
    printf '  ok    %-16s %s\n' "$name" "$out"
  else
    printf '  FAIL  %-16s run: bash scripts/setup.sh\n' "$name"
    failed=1
  fi
}
reach() {
  local code
  code="$(curl -sS -o /dev/null -m 10 -w '%{http_code}' "$2" 2>/dev/null)"
  case "$code" in
    2*|3*) printf '  ok    %-16s reachable\n' "$1" ;;
    *)     printf '  --    %-16s blocked or offline (%s)\n' "$1" "$3" ;;
  esac
}

echo "Tools"
check "ffmpeg"         ffmpeg -version
check "ffprobe"        ffprobe -version
check "node"           node --version
check "python"         .venv/bin/python --version
check "yt-dlp"         .venv/bin/yt-dlp --version
check "faster-whisper" .venv/bin/python -c "import faster_whisper; print(faster_whisper.__version__)"
check "remotion"       bash -c "cd remotion && node -p \"require('remotion/package.json').version\""
check "hyperframes"    bash -c "cd hyperframes && npx --no-install hyperframes --version"

echo "Render browsers"
check "remotion"       bash -c 'for c in remotion/node_modules/.remotion/chrome-headless-shell/*/chrome-headless-shell-*/chrome-headless-shell /opt/pw-browsers/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell; do [ -x "$c" ] && echo "$c" && exit 0; done; exit 1'
check "hyperframes"    bash -c "cd hyperframes && npx --no-install hyperframes browser path"

echo "Whisper models already downloaded"
models="$(ls -d "${HF_HOME:-$HOME/.cache/huggingface}"/hub/models--* 2>/dev/null | sed 's|.*/models--||; s|--|/|')"
if [ -n "$models" ]; then
  printf '%s\n' "$models" | sed 's/^/  ok    /'
else
  echo "  --    none yet (they download on the first transcription)"
fi

echo "Network"
reach "huggingface.co" "https://huggingface.co/api/models/ivrit-ai/whisper-large-v3-turbo-ct2" "needed to download Whisper models"
reach "youtube.com"    "https://www.youtube.com/robots.txt" "needed by yt-dlp for YouTube"

[ "$failed" -eq 0 ] && echo "All tools are installed." || echo "Something is missing, see FAIL above."
exit "$failed"
