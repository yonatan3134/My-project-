#!/usr/bin/env bash
# One step: transcribe a video and render it with animated word-highlight
# captions (Remotion). Hebrew and other right-to-left text is laid out correctly.
#
#   bash scripts/caption.sh <video>                      # -> out/<name>.captioned.mp4
#   bash scripts/caption.sh <video> --lang he            # skip language detection
#   bash scripts/caption.sh <video> --color "#22d3ee" --out out/final.mp4
#   bash scripts/caption.sh <video> --retranscribe --prompt "Names, Terms"
#
# An existing transcript in media/transcripts/<name>/ is reused, so you can fix
# words in <name>.captions.json by hand and run this again.
# Other options (--lang, --model, --prompt ...) go to scripts/transcribe.sh.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"

if [ $# -lt 1 ]; then
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 1
fi

video="$(realpath "$1")"
shift
[ -f "$video" ] || { echo "Not a file: $video" >&2; exit 1; }

color="#facc15"
output=""
retranscribe=0
transcribe_args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --color)        color="$2"; shift 2 ;;
    --out)          output="$2"; shift 2 ;;
    --retranscribe) retranscribe=1; shift ;;
    *)              transcribe_args+=("$1"); shift ;;
  esac
done

name="$(basename "${video%.*}")"
extension="${video##*.}"
captions="$ROOT/media/transcripts/$name/$name.captions.json"
[ -n "$output" ] || output="$ROOT/out/$name.captioned.mp4"
output="$(realpath -m "$output")"

if [ "$retranscribe" -eq 1 ] || [ ! -f "$captions" ]; then
  echo "==> Transcribing" >&2
  bash "$ROOT/scripts/transcribe.sh" "$video" "${transcribe_args[@]}" >/dev/null
fi

# Remotion reads media from its public/ folder under a plain ASCII name.
slug="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]\{1,\}/-/g; s/^-//; s/-$//')"
[ "${#slug}" -ge 3 ] || slug="clip-$(printf '%s' "$name" | md5sum | cut -c1-8)"
clips="$ROOT/remotion/public/clips"
mkdir -p "$clips" "$(dirname "$output")"
cp -f "$video" "$clips/$slug.$extension"
cp -f "$captions" "$clips/$slug.captions.json"

echo "==> Rendering $output" >&2
props="$(printf '{"videoSrc":"clips/%s.%s","captionsSrc":"clips/%s.captions.json","highlightColor":"%s"}' "$slug" "$extension" "$slug" "$color")"
cd "$ROOT/remotion"
npx remotion render CaptionedVideo "$output" --props="$props" --log=error
echo "$output"
