#!/usr/bin/env python3
"""Transcribe audio or video with Whisper into word-timed caption files.

Run it through the wrapper so it uses the project's Python environment:

  bash scripts/transcribe.sh media/raw/talk.mp4              # language detected
  bash scripts/transcribe.sh media/raw/talk.mp4 --lang he    # Hebrew (ivrit.ai model)
  bash scripts/transcribe.sh media/raw/talk.mp4 --lang en --model small
  bash scripts/transcribe.sh talk.mp4 --prompt "Remotion, HyperFrames, FFmpeg"

Hebrew is transcribed with the ivrit.ai fine-tuned Whisper model; every other
language with Whisper large-v3-turbo. Models download on first use.

Written to media/transcripts/<name>/ :
  <name>.captions.json   Remotion Caption[] (one entry per word)
  <name>.words.json      HyperFrames words [{id, text, start, end}]
  <name>.segments.json   sentences with their words, for choosing cuts by text
  <name>.srt, <name>.vtt subtitles regrouped into short lines
  <name>.txt             plain text
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

HEBREW_MODEL = "ivrit-ai/whisper-large-v3-turbo-ct2"
DEFAULT_MODEL = "large-v3-turbo"
DETECT_MODEL = "base"

SENTENCE_END = (".", "?", "!", "…", "׃")
SOFT_BREAK = (",", ";", ":", "،", "־", "–", "—")


def log(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def load_model(name: str, threads: int):
    import ctranslate2
    from faster_whisper import WhisperModel

    if ctranslate2.get_cuda_device_count() > 0:
        return WhisperModel(name, device="cuda", compute_type="float16")
    return WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=threads)


def detect_language(path: str, threads: int) -> str:
    from faster_whisper.audio import decode_audio

    model = load_model(DETECT_MODEL, threads)
    audio = decode_audio(path, sampling_rate=16000)
    language, probability, _ = model.detect_language(audio)
    log(f"Detected language: {language} ({probability:.0%})")
    return language


def timestamp(seconds: float, separator: str) -> str:
    ms = max(0, round(seconds * 1000))
    hours, ms = divmod(ms, 3_600_000)
    minutes, ms = divmod(ms, 60_000)
    secs, ms = divmod(ms, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{separator}{ms:03d}"


def split_phrase(phrase: list[dict], max_chars: int, max_seconds: float) -> list[list[dict]]:
    """Halve a phrase until every line fits, preferring commas and small pauses as break points."""
    length = sum(len(w["text"]) for w in phrase) + len(phrase) - 1
    seconds = phrase[-1]["end"] - phrase[0]["start"]
    if len(phrase) == 1 or (length <= max_chars and seconds <= max_seconds):
        return [phrase]
    best_index, best_score, left = 1, float("inf"), 0
    for index in range(1, len(phrase)):
        previous = phrase[index - 1]
        left += len(previous["text"]) + 1
        score = abs(left - 1 - length / 2)
        if previous["text"].endswith(SOFT_BREAK):
            score -= length * 0.2
        score -= min(phrase[index]["start"] - previous["end"], 0.5) * length * 0.4
        if score < best_score:
            best_index, best_score = index, score
    return split_phrase(phrase[:best_index], max_chars, max_seconds) + split_phrase(
        phrase[best_index:], max_chars, max_seconds
    )


def group_cues(words: list[dict], max_chars: int, max_gap: float, max_seconds: float) -> list[dict]:
    """Regroup words into short subtitle cues that break at pauses and sentence ends."""
    # Phrases: runs of words between pauses and sentence ends.
    phrases: list[list[dict]] = []
    for word in words:
        if phrases:
            previous = phrases[-1][-1]
            if word["start"] - previous["end"] <= max_gap and not previous["text"].endswith(SENTENCE_END):
                phrases[-1].append(word)
                continue
        phrases.append([word])

    cues = [
        {"start": line[0]["start"], "end": line[-1]["end"], "text": " ".join(w["text"] for w in line)}
        for phrase in phrases
        for line in split_phrase(phrase, max_chars, max_seconds)
    ]

    # A cue stays up at least a moment, but never into the next one.
    for index, cue in enumerate(cues):
        cue["end"] = max(cue["end"], cue["start"] + 0.5)
        if index + 1 < len(cues):
            cue["end"] = min(cue["end"], cues[index + 1]["start"])
    return cues


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Transcribe audio/video into Remotion, HyperFrames, SRT and VTT captions."
    )
    parser.add_argument("input", help="audio or video file")
    parser.add_argument("--lang", default="auto", help="language code (he, en, ...) or auto (default)")
    parser.add_argument("--model", help=f"Whisper model; default {HEBREW_MODEL} for Hebrew, else {DEFAULT_MODEL}")
    parser.add_argument("--out", help="output folder (default media/transcripts/<name>)")
    parser.add_argument("--prompt", help="names and terms that should be spelled a certain way")
    parser.add_argument("--max-chars", type=int, default=42, help="longest subtitle line (default 42)")
    parser.add_argument("--no-vad", action="store_true", help="do not skip silence with voice detection")
    parser.add_argument("--threads", type=int, default=os.cpu_count() or 4)
    args = parser.parse_args()

    source = Path(args.input).expanduser().resolve()
    if not source.is_file():
        log(f"Not a file: {source}")
        return 1

    language = args.lang.lower()
    if language == "auto":
        language = detect_language(str(source), args.threads)
    if language == "iw":
        language = "he"

    model_name = args.model or (HEBREW_MODEL if language == "he" else DEFAULT_MODEL)
    log(f"Model: {model_name} | language: {language}")

    started = time.time()
    model = load_model(model_name, args.threads)
    segments_iter, info = model.transcribe(
        str(source),
        language=language,
        word_timestamps=True,
        vad_filter=not args.no_vad,
        vad_parameters={"min_silence_duration_ms": 500},
        beam_size=5,
        condition_on_previous_text=False,
        initial_prompt=args.prompt,
    )

    segments: list[dict] = []
    words: list[dict] = []
    for segment in segments_iter:
        segment_words = []
        for word in segment.words or []:
            text = word.word.strip()
            if not text:
                continue
            start = max(0.0, float(word.start))
            end = max(start + 0.02, float(word.end))
            entry = {
                "text": text,
                "start": round(start, 3),
                "end": round(end, 3),
                "confidence": round(float(word.probability), 3),
            }
            segment_words.append(entry)
            words.append(entry)
        segments.append(
            {
                "id": len(segments),
                "start": round(float(segment.start), 3),
                "end": round(float(segment.end), 3),
                "text": segment.text.strip(),
                "words": segment_words,
            }
        )
        log(f"[{timestamp(segment.start, '.')} -> {timestamp(segment.end, '.')}] {segment.text.strip()}")

    if not words:
        log("No speech found.")
        return 2

    name = source.stem
    out_dir = Path(args.out).expanduser().resolve() if args.out else ROOT / "media" / "transcripts" / name
    out_dir.mkdir(parents=True, exist_ok=True)

    def write(suffix: str, content: str) -> Path:
        path = out_dir / f"{name}{suffix}"
        path.write_text(content, encoding="utf-8")
        return path

    def dump(data) -> str:
        return json.dumps(data, ensure_ascii=False, indent=2) + "\n"

    # Remotion: every word carries its leading space (the format is whitespace sensitive).
    remotion_captions = [
        {
            "text": " " + w["text"],
            "startMs": round(w["start"] * 1000),
            "endMs": round(w["end"] * 1000),
            "timestampMs": round((w["start"] + w["end"]) / 2 * 1000),
            "confidence": w["confidence"],
        }
        for w in words
    ]
    hyperframes_words = [
        {"id": f"w{i}", "text": w["text"], "start": w["start"], "end": w["end"]}
        for i, w in enumerate(words)
    ]
    cues = group_cues(words, max_chars=args.max_chars, max_gap=0.6, max_seconds=5.0)
    srt = "".join(
        f"{i}\n{timestamp(c['start'], ',')} --> {timestamp(c['end'], ',')}\n{c['text']}\n\n"
        for i, c in enumerate(cues, start=1)
    )
    vtt = "WEBVTT\n\n" + "".join(
        f"{timestamp(c['start'], '.')} --> {timestamp(c['end'], '.')}\n{c['text']}\n\n" for c in cues
    )

    files = {
        "remotion_captions": write(".captions.json", dump(remotion_captions)),
        "hyperframes_words": write(".words.json", dump(hyperframes_words)),
        "segments": write(
            ".segments.json",
            dump({"language": language, "duration": round(float(info.duration), 3), "segments": segments}),
        ),
        "srt": write(".srt", srt),
        "vtt": write(".vtt", vtt),
        "text": write(".txt", "\n".join(s["text"] for s in segments) + "\n"),
    }

    elapsed = time.time() - started
    summary = {
        "input": str(source),
        "language": language,
        "model": model_name,
        "duration_seconds": round(float(info.duration), 2),
        "words": len(words),
        "cues": len(cues),
        "transcribe_seconds": round(elapsed, 1),
        "files": {key: str(path) for key, path in files.items()},
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
