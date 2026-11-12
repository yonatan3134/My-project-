#!/usr/bin/env bash
# Contact sheet: evenly spaced frames of a video in one PNG, each stamped with
# its time. The quick way to look at footage or check a render.
#
#   bash scripts/frames.sh <video> [frames=8] [out.png]
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"

if [ $# -lt 1 ]; then
  sed -n '2,6p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 1
fi

input="$1"
count="${2:-8}"
name="$(basename "${input%.*}")"
output="${3:-$ROOT/media/work/$name.frames.png}"
mkdir -p "$(dirname "$output")"

duration="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$input")"
columns=4
[ "$count" -lt 4 ] && columns="$count"
rows=$(( (count + columns - 1) / columns ))

# The first frame of each of <count> equal slices.
step="$(awk -v d="$duration" -v n="$count" 'BEGIN { printf "%.4f", d / n }')"
ffmpeg -hide_banner -loglevel error -y -i "$input" \
  -vf "select='isnan(prev_selected_t)+gte(t-prev_selected_t\,${step})',scale=480:-2,drawtext=text='%{pts\:hms}':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=6,tile=${columns}x${rows}:margin=4:padding=4" \
  -fps_mode vfr -frames:v 1 "$output"

echo "$output"
