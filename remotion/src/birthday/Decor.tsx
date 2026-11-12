import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  random,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { FONT_FAMILY } from "../lib/fonts";
import { CLAMP, COLORS, PARTY_COLORS } from "./theme";

// No gold here: gold is the colour of the text the balloons float past.
const BALLOON_COLORS = [COLORS.coral, COLORS.sky, COLORS.mint];

type BalloonsProps = {
  /** Horizontal centres of the balloons, in pixels. */
  readonly positions: number[];
  /** Frames a balloon takes to cross the screen. */
  readonly riseFrames: number;
};

/** Balloons rising along the edges of the frame. */
export const Balloons: React.FC<BalloonsProps> = ({ positions, riseFrames }) => {
  const frame = useCurrentFrame();
  const { height } = useVideoConfig();

  return (
    <AbsoluteFill>
      {positions.map((x, index) => {
        const size = 130 + random(`balloon-size-${index}`) * 55;
        const delay = random(`balloon-delay-${index}`) * 36;
        const color = BALLOON_COLORS[index % BALLOON_COLORS.length];
        // They start peeking in at the bottom, so even the first frame is festive.
        const y = interpolate(
          frame,
          [delay, delay + riseFrames],
          [height - 190, -size * 2.6],
          { ...CLAMP, easing: Easing.out(Easing.quad) },
        );
        return (
          <svg
            key={index}
            width={size}
            height={size * 2.2}
            viewBox="0 0 100 220"
            style={{
              position: "absolute",
              left: x - size / 2 + Math.sin(frame / 22 + index * 2) * 18,
              top: y,
              rotate: `${Math.sin(frame / 26 + index) * 5}deg`,
            }}
          >
            <ellipse cx="50" cy="60" rx="46" ry="58" fill={color} />
            <ellipse cx="33" cy="38" rx="9" ry="16" fill="rgba(255, 255, 255, 0.4)" />
            <polygon points="43,116 57,116 50,128" fill={color} />
            <path
              d="M50 128 C 38 152, 62 178, 50 216"
              stroke="rgba(255, 255, 255, 0.65)"
              strokeWidth="2"
              fill="none"
            />
          </svg>
        );
      })}
    </AbsoluteFill>
  );
};

type ConfettiProps = {
  readonly pieces?: number;
};

/** Paper confetti falling for as long as the scene lasts. */
export const Confetti: React.FC<ConfettiProps> = ({ pieces = 150 }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  return (
    <AbsoluteFill>
      {new Array(pieces).fill(true).map((_, index) => {
        const w = 14 + random(`confetti-w-${index}`) * 16;
        const h = 8 + random(`confetti-h-${index}`) * 10;
        const speed = 7 + random(`confetti-speed-${index}`) * 9;
        const phase = random(`confetti-phase-${index}`) * Math.PI * 2;
        const travel = height + 240;
        // Every piece starts above the frame, so the first second is a burst.
        const startAbove = random(`confetti-start-${index}`) * travel;
        const y = ((frame * speed + travel - startAbove) % travel) - 120;
        const firstFall = frame * speed < startAbove;
        const x =
          random(`confetti-x-${index}`) * width +
          Math.sin(frame / 14 + phase) * 46;
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              left: x,
              top: y,
              width: w,
              height: h,
              opacity: firstFall ? 0 : 0.95,
              borderRadius: index % 5 === 0 ? "50%" : 3,
              backgroundColor: PARTY_COLORS[index % PARTY_COLORS.length],
              rotate: `${frame * (3 + (index % 7)) + index * 40}deg`,
              scale: `1 ${Math.cos(frame / 5 + phase)}`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

type HeartProps = {
  readonly size: number;
  readonly appearAt: number;
};

/** A heart that pops in and then beats gently. */
export const Heart: React.FC<HeartProps> = ({ size, appearAt }) => {
  const frame = useCurrentFrame();
  const beat = 1 + Math.max(0, Math.sin((frame - appearAt) / 5)) * 0.1;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{
        scale:
          interpolate(frame, [appearAt, appearAt + 14], [0, 1], {
            ...CLAMP,
            easing: Easing.out(Easing.back(2)),
          }) * beat,
      }}
    >
      <path
        d="M50 88 C 18 62, 6 44, 6 28 C 6 14, 17 6, 28 6 C 38 6, 46 12, 50 20 C 54 12, 62 6, 72 6 C 83 6, 94 14, 94 28 C 94 44, 82 62, 50 88 Z"
        fill={COLORS.coral}
      />
    </svg>
  );
};

type SnoozeProps = {
  readonly left: number;
  readonly top: number;
};

/** Three Z letters drifting up and away: the universal sign for a nap. */
export const Snooze: React.FC<SnoozeProps> = ({ left, top }) => {
  const frame = useCurrentFrame();
  const loop = 75;

  return (
    <div style={{ position: "absolute", left, top }}>
      {[0, 1, 2].map((index) => {
        const local = (frame + index * (loop / 3)) % loop;
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              fontFamily: FONT_FAMILY,
              fontWeight: 900,
              fontSize: 64 + index * 26,
              color: "white",
              WebkitTextStroke: `10px ${COLORS.night}`,
              paintOrder: "stroke fill",
              opacity: interpolate(local, [0, 12, 55, loop], [0, 1, 1, 0], CLAMP),
              translate: interpolate(
                local,
                [0, loop],
                ["0px 0px", "130px -210px"],
                CLAMP,
              ),
              rotate: `${-12 + Math.sin(local / 9) * 8}deg`,
            }}
          >
            Z
          </div>
        );
      })}
    </div>
  );
};
