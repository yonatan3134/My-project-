import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { FONT_FAMILY } from "./lib/fonts";

const fontFamily = FONT_FAMILY;

const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

export type TitleCardProps = {
  readonly title: string;
  readonly subtitle: string;
  readonly accentColor: string;
};

/** A simple animated opening card: title rises in, an accent line draws, subtitle fades. */
export const TitleCard: React.FC<TitleCardProps> = ({
  title,
  subtitle,
  accentColor,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width } = useVideoConfig();
  const dir = RTL.test(title) ? "rtl" : "ltr";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0b1020",
        justifyContent: "center",
        alignItems: "center",
        fontFamily,
        color: "white",
        opacity: interpolate(
          frame,
          [durationInFrames - 0.4 * fps, durationInFrames],
          [1, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        ),
      }}
    >
      <div
        dir={dir}
        style={{
          fontSize: width * 0.07,
          fontWeight: 800,
          letterSpacing: dir === "rtl" ? 0 : "-0.02em",
          opacity: interpolate(frame, [0, 0.5 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [0, 0.7 * fps], ["0px 60px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        {title}
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 4,
          marginTop: 28,
          backgroundColor: accentColor,
          width: interpolate(frame, [0.3 * fps, 1.1 * fps], [0, width * 0.22], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      />
      <div
        dir={dir}
        style={{
          fontSize: width * 0.026,
          fontWeight: 400,
          marginTop: 32,
          color: "rgba(255, 255, 255, 0.78)",
          opacity: interpolate(frame, [0.7 * fps, 1.3 * fps], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {subtitle}
      </div>
    </AbsoluteFill>
  );
};
