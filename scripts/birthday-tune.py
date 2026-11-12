#!/usr/bin/env python3
"""Synthesize a music-box arrangement of "Happy Birthday to You" (public domain melody).

  .venv/bin/python scripts/birthday-tune.py [out.m4a]     # default remotion/public/music/happy-birthday-musicbox.m4a

36 seconds at 100 bpm in 3/4: a two-bar intro, the tune twice (the second time
fuller), and a long final chord. One bar is 1.8 s, so bars start at 3.6 + 1.8 * n
seconds: cut the picture on those times and it lands on the music.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SR = 44100
BEAT = 0.6  # seconds; 100 beats per minute
BAR = 3 * BEAT
INTRO = 2 * BAR
VERSE = 8 * BAR
TOTAL = 36.0

SEMITONES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def hz(note: str) -> float:
    """'G5' -> frequency, A4 = 440 Hz."""
    midi = 12 * (int(note[-1]) + 1) + SEMITONES[note[0]]
    return 440.0 * 2 ** ((midi - 69) / 12)


def shift(note: str, octaves: int) -> str:
    return f"{note[0]}{int(note[-1]) + octaves}"


class Mix:
    def __init__(self) -> None:
        self.left = np.zeros(int(TOTAL * SR) + SR)
        self.right = np.zeros_like(self.left)

    def add(self, start: float, signal: np.ndarray, pan: float = 0.0) -> None:
        first = int(start * SR)
        last = min(first + len(signal), len(self.left))
        chunk = signal[: last - first]
        self.left[first:last] += chunk * (1 - max(0.0, pan))
        self.right[first:last] += chunk * (1 + min(0.0, pan))


def tine(note: str, velocity: float, ring: float = 2.6) -> np.ndarray:
    """One music-box note: a bright pluck whose overtones die faster than the fundamental."""
    freq = hz(note)
    t = np.arange(int(ring * SR)) / SR
    faster = (freq / 440.0) ** 0.5
    wave_sum = np.zeros_like(t)
    for multiple, level, decay in ((1.0, 1.0, 2.0), (2.0, 0.40, 3.4), (3.0, 0.15, 5.0), (5.4, 0.06, 8.0)):
        wave_sum += level * np.sin(2 * np.pi * freq * multiple * t) * np.exp(-decay * faster * t)
    attack = np.minimum(1.0, t / 0.004)
    return velocity * wave_sum * attack


def pad(notes: list[str], seconds: float, level: float) -> np.ndarray:
    """A soft sustained chord under the tune."""
    t = np.arange(int((seconds + 0.6) * SR)) / SR
    chord = np.zeros_like(t)
    for note in notes:
        for detune in (0.9985, 1.0015):
            chord += np.sin(2 * np.pi * hz(note) * detune * t)
    envelope = np.minimum(1.0, t / 0.35) * np.minimum(1.0, np.maximum(0.0, (seconds + 0.6 - t) / 0.6))
    return level * chord * envelope / (2 * len(notes))


def bass(note: str, level: float) -> np.ndarray:
    t = np.arange(int(1.6 * SR)) / SR
    freq = hz(note)
    tone = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * 2 * freq * t)
    return level * tone * np.exp(-2.2 * t) * np.minimum(1.0, t / 0.01)


# The tune, with G5 as the opening note. (beat within the bar, note, beats)
MELODY = {
    1: [(0, "A5", 1), (1, "G5", 1), (2, "C6", 1)],
    2: [(0, "B5", 2)],
    3: [(0, "A5", 1), (1, "G5", 1), (2, "D6", 1)],
    4: [(0, "C6", 2)],
    5: [(0, "G6", 1), (1, "E6", 1), (2, "C6", 1)],
    6: [(0, "B5", 1), (1, "A5", 1)],
    7: [(0, "E6", 1), (1, "C6", 1), (2, "D6", 1)],
    8: [(0, "C6", 3)],
}
# The two short "hap-py" notes on the last beat of the bar before.
PICKUPS = {1: "G5", 3: "G5", 5: "G5", 7: "F6"}
CHORDS = {
    "C": (["C3", "E4", "G4", "C5"], "C3"),
    "G": (["G3", "D4", "G4", "B4"], "G2"),
    "F": (["F3", "F4", "A4", "C5"], "F2"),
}
HARMONY = {1: ["C"], 2: ["G"], 3: ["G"], 4: ["C"], 5: ["C"], 6: ["F"], 7: ["C", "C", "G"], 8: ["C"]}


def build() -> Mix:
    mix = Mix()

    # Intro: a rising C arpeggio, then G, leading into the first "hap-py".
    for index, note in enumerate(["C4", "G4", "C5", "E5", "G5", "E5"]):
        mix.add(index * BEAT / 2, tine(note, 0.34), pan=0.3 if index % 2 else -0.3)
    for index, note in enumerate(["G3", "D4", "G4", "B4"]):
        mix.add(BAR + index * BEAT / 2, tine(note, 0.34), pan=0.3 if index % 2 else -0.3)
    mix.add(0.0, pad(["C3", "G3", "E4"], BAR, 0.10))
    mix.add(BAR, pad(["G2", "D3", "B3"], BAR, 0.10))

    for verse in (0, 1):
        full = verse == 1
        verse_start = INTRO + verse * VERSE
        for bar in range(1, 9):
            bar_start = verse_start + (bar - 1) * BAR

            if bar in PICKUPS:
                for offset, velocity in ((-BEAT, 0.62), (-BEAT / 4, 0.55)):
                    mix.add(bar_start + offset, tine(PICKUPS[bar], velocity))
                    if full:
                        mix.add(bar_start + offset, tine(shift(PICKUPS[bar], -1), velocity * 0.5), pan=-0.2)

            for beat, note, _beats in MELODY[bar]:
                mix.add(bar_start + beat * BEAT, tine(note, 0.72))
                if full:
                    mix.add(bar_start + beat * BEAT, tine(shift(note, -1), 0.36), pan=-0.2)

            # Waltz accompaniment: bass on one, chord tones on two and three.
            chords = HARMONY[bar]
            for beat in range(3):
                name = chords[min(beat, len(chords) - 1)]
                tones, root = CHORDS[name]
                if beat == 0 or (len(chords) > 1 and beat == 2):
                    mix.add(bar_start + beat * BEAT, bass(root, 0.24))
                if beat > 0 and not (bar == 8 and full):
                    for tone in tones[1:3]:
                        mix.add(bar_start + beat * BEAT, tine(tone, 0.15 if full else 0.11), pan=0.35)
                if full and bar != 8:
                    # Second time: a running broken chord between the beats.
                    mix.add(bar_start + (beat + 0.5) * BEAT, tine(tones[3 if beat % 2 else 2], 0.12), pan=-0.4)
            tones, _root = CHORDS[chords[0]]
            mix.add(bar_start, pad(tones[:3], BAR, 0.13 if full else 0.09))

    # Ending: roll the last chord upwards and let it ring.
    ending = INTRO + 2 * VERSE - BAR
    for index, note in enumerate(["C4", "E4", "G4", "C5", "E5", "G5", "C6", "E6", "G6", "C7"]):
        mix.add(ending + 0.25 + index * 0.11, tine(note, 0.30, ring=4.5), pan=(index % 3 - 1) * 0.3)
    mix.add(ending + BAR, tine("C7", 0.32, ring=4.0))
    mix.add(ending + BAR, tine("G6", 0.20, ring=4.0), pan=0.3)
    mix.add(ending, pad(["C3", "G3", "E4", "C5"], 4.0, 0.12))
    return mix


def main() -> int:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "remotion" / "public" / "music" / "happy-birthday-musicbox.m4a"
    output.parent.mkdir(parents=True, exist_ok=True)

    mix = build()
    samples = int(TOTAL * SR)
    stereo = np.stack([mix.left[:samples], mix.right[:samples]], axis=1)
    stereo *= 0.89 / np.max(np.abs(stereo))

    with tempfile.TemporaryDirectory() as folder:
        dry = Path(folder) / "dry.wav"
        with wave.open(str(dry), "wb") as handle:
            handle.setnchannels(2)
            handle.setsampwidth(2)
            handle.setframerate(SR)
            handle.writeframes((stereo * 32767).astype("<i2").tobytes())
        # A little room around the notes, even loudness, and a fade at the end.
        result = subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(dry),
                "-af",
                "aecho=0.85:0.6:70|140|230:0.22|0.14|0.08,"
                "loudnorm=I=-16:TP=-1.5:LRA=11,"
                f"afade=t=out:st={TOTAL - 2.2}:d=2.2",
                "-ar", "48000", "-c:a", "aac", "-b:a", "128k", str(output),
            ],
            capture_output=True,
            text=True,
        )
    if result.returncode != 0:
        sys.exit(result.stderr)
    print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
