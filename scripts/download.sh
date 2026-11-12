#!/usr/bin/env bash
# Download a video (or just its audio) into media/raw with yt-dlp.
#
#   bash scripts/download.sh <url>                 # video, up to 1080p MP4
#   bash scripts/download.sh <url> --audio         # audio only (m4a)
#   bash scripts/download.sh <url> --section "*1:30-2:45"   # only part of it
#   bash scripts/download.sh <url> --subs          # also fetch subtitles
#   bash scripts/download.sh <url> -- <any yt-dlp flags>
#
# Defaults live in yt-dlp.conf at the repo root.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"

if [ $# -lt 1 ]; then
  sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 1
fi

url="$1"
shift
args=(--config-locations "$ROOT/yt-dlp.conf" -P "$ROOT/media/raw")

while [ $# -gt 0 ]; do
  case "$1" in
    --audio)   args+=(-f "ba/b" -x --audio-format m4a); shift ;;
    --section) args+=(--download-sections "$2" --force-keyframes-at-cuts); shift 2 ;;
    --subs)    args+=(--write-subs --write-auto-subs --sub-langs "he,iw,en.*" --convert-subs srt); shift ;;
    --)        shift; args+=("$@"); break ;;
    *)         args+=("$1"); shift ;;
  esac
done

exec yt-dlp "${args[@]}" "$url"
