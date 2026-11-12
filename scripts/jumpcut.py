#!/usr/bin/env python3
"""Cut the silent pauses out of a talking video (a "jump cut" pass).

  bash scripts/jumpcut.sh media/raw/talk.mp4                  # -> media/work/talk.jumpcut.mp4
  bash scripts/jumpcut.sh talk.mp4 -o out.mp4 --min-silence 0.4 --pad 0.08
  bash scripts/jumpcut.sh talk.mp4 --plan-only                # only write the cut list

Always writes the cut list next to the output as <name>.cuts.json, so the same
cuts can be applied non-destructively in Remotion or HyperFrames instead.

Cut points are snapped to video frames and the audio is trimmed sample-exact,
so picture and sound stay in sync however many cuts there are.
Transcribe AFTER cutting: the timestamps then match the cut video.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from fractions import Fraction
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)


def probe(path: Path) -> dict:
    result = run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)]
    )
    if result.returncode != 0:
        sys.exit(f"ffprobe failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


def pick_fps(video_stream: dict, override: float | None) -> Fraction:
    if override:
        return Fraction(override).limit_denominator(1001)
    for key in ("avg_frame_rate", "r_frame_rate"):
        value = video_stream.get(key, "0/0")
        try:
            fps = Fraction(value)
        except (ValueError, ZeroDivisionError):
            continue
        if 1 <= fps <= 120:
            return fps
    return Fraction(30)


def detect_silences(path: Path, noise_db: float, min_silence: float) -> list[tuple[float, float | None]]:
    result = run(
        [
            "ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-vn",
            "-af", f"silencedetect=noise={noise_db}dB:d={min_silence}",
            "-f", "null", "-",
        ]
    )
    if result.returncode != 0:
        sys.exit(f"ffmpeg silencedetect failed:\n{result.stderr[-800:]}")
    silences: list[tuple[float, float | None]] = []
    start: float | None = None
    for line in result.stderr.splitlines():
        if match := re.search(r"silence_start: (-?[\d.]+)", line):
            start = max(0.0, float(match.group(1)))
        elif (match := re.search(r"silence_end: (-?[\d.]+)", line)) and start is not None:
            silences.append((start, float(match.group(1))))
            start = None
    if start is not None:
        silences.append((start, None))  # silent until the end
    return silences


def main() -> int:
    parser = argparse.ArgumentParser(description="Remove silent pauses from a video.")
    parser.add_argument("input")
    parser.add_argument("-o", "--output", help="default media/work/<name>.jumpcut.mp4")
    parser.add_argument("--noise", type=float, default=-35.0, help="silence threshold in dB (default -35)")
    parser.add_argument("--min-silence", type=float, default=0.6, help="shortest pause to cut, seconds (default 0.6)")
    parser.add_argument("--pad", type=float, default=0.12, help="breathing room kept around speech, seconds (default 0.12)")
    parser.add_argument("--fps", type=float, help="output frame rate (default: the source's)")
    parser.add_argument("--crf", type=int, default=18, help="x264 quality, lower is better (default 18)")
    parser.add_argument("--plan-only", action="store_true", help="write the cut list, do not render")
    args = parser.parse_args()

    source = Path(args.input).expanduser().resolve()
    if not source.is_file():
        sys.exit(f"Not a file: {source}")

    info = probe(source)
    video = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
    audio = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    if video is None or audio is None:
        sys.exit("The file needs both a video and an audio stream.")
    duration = float(info["format"]["duration"])
    fps = pick_fps(video, args.fps)
    total_frames = int(duration * fps)

    silences = detect_silences(source, args.noise, args.min_silence)

    # Keep everything that is not silence, plus a little padding into each pause.
    keep: list[list[int]] = []
    cursor = 0.0
    for start, end in silences:
        keep_end = min(duration, start + args.pad)
        if keep_end > cursor:
            keep.append([round(cursor * fps), round(keep_end * fps)])
        cursor = duration if end is None else max(cursor, end - args.pad)
    if cursor < duration:
        keep.append([round(cursor * fps), total_frames])

    # Merge touching ranges and drop slivers shorter than three frames.
    merged: list[list[int]] = []
    for first, last in keep:
        first, last = max(0, first), min(total_frames, last)
        if merged and first <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], last)
        elif last - first >= 3:
            merged.append([first, last])
    if not merged:
        sys.exit("Nothing but silence was found. Try a lower --noise (for example -45).")

    kept_frames = sum(last - first for first, last in merged)
    output = (
        Path(args.output).expanduser().resolve()
        if args.output
        else ROOT / "media" / "work" / f"{source.stem}.jumpcut.mp4"
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    plan_path = output.with_suffix(".cuts.json")
    plan = {
        "input": str(source),
        "fps": float(fps),
        "duration": round(duration, 3),
        "kept_duration": round(float(kept_frames / fps), 3),
        "removed_duration": round(duration - float(kept_frames / fps), 3),
        "settings": {"noise_db": args.noise, "min_silence": args.min_silence, "pad": args.pad},
        "keep": [
            {
                "start": round(float(first / fps), 3),
                "end": round(float(last / fps), 3),
                "start_frame": first,
                "end_frame": last,
            }
            for first, last in merged
        ],
    }
    plan_path.write_text(json.dumps(plan, indent=2) + "\n", encoding="utf-8")
    summary = {
        "segments": len(merged),
        "duration": plan["duration"],
        "kept_duration": plan["kept_duration"],
        "removed_duration": plan["removed_duration"],
        "plan": str(plan_path),
    }

    if args.plan_only:
        print(json.dumps(summary, indent=2))
        return 0

    count = len(merged)
    fps_text = f"{fps.numerator}/{fps.denominator}"
    frame_test = "+".join(f"between(n,{first},{last - 1})" for first, last in merged)
    graph = [f"[0:v:0]fps={fps_text},select='{frame_test}',setpts=N/FRAME_RATE/TB[v]"]
    graph.append("[0:a:0]asplit=" + str(count) + "".join(f"[s{i}]" for i in range(count)))
    for i, (first, last) in enumerate(merged):
        start, end = float(first / fps), float(last / fps)
        fade = min(0.008, (end - start) / 4)
        graph.append(
            f"[s{i}]atrim=start={start:.6f}:end={end:.6f},asetpts=PTS-STARTPTS,"
            f"afade=t=in:d={fade:.4f},afade=t=out:st={end - start - fade:.6f}:d={fade:.4f}[a{i}]"
        )
    graph.append("".join(f"[a{i}]" for i in range(count)) + f"concat=n={count}:v=0:a=1[a]")

    result = run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
            "-filter_complex", ";".join(graph), "-map", "[v]", "-map", "[a]",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", str(args.crf), "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(output),
        ]
    )
    if result.returncode != 0:
        sys.exit(f"ffmpeg failed:\n{result.stderr[-1500:]}")

    summary["output"] = str(output)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
