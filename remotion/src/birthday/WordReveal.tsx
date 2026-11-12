import { fitText } from "@remotion/layout-utils";
import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { FONT_FAMILY } from "../lib/fonts";
import { directionOf } from "../lib/rtl";
import { CLAMP } from "./theme";

type WordProps = {
  readonly text: string;
  readonly appearAt: number;
};

const Word: React.FC<WordProps> = ({ text, appearAt }) => {
  const frame = useCurrentFrame();
  return (
    <span
      style={{
        display: "inline-block",
        margin: "0 0.13em",
        opacity: interpolate(frame, [appearAt, appearAt + 8], [0, 1], CLAMP),
        translate: interpolate(
          frame,
          [appearAt, appearAt + 14],
          ["0px 46px", "0px 0px"],
          { ...CLAMP, easing: Easing.out(Easing.back(1.5)) },
        ),
      }}
    >
      {text}
    </span>
  );
};

type WordRevealProps = {
  readonly text: string;
  /** Frame at which the first word appears. */
  readonly startFrame: number;
  /** Frames between one word and the next. */
  readonly stagger?: number;
  /** Largest size; the line shrinks to fit maxWidth. */
  readonly fontSize: number;
  readonly maxWidth: number;
  readonly fontWeight?: number;
  readonly color?: string;
  readonly style?: React.CSSProperties;
};

/**
 * One line of text whose words rise in one after another. Words are whole
 * inline blocks inside a container with the right base direction, so Hebrew
 * reads right to left.
 */
export const WordReveal: React.FC<WordRevealProps> = ({
  text,
  startFrame,
  stagger = 5,
  fontSize,
  maxWidth,
  fontWeight = 800,
  color = "white",
  style,
}) => {
  const fitted = fitText({
    text,
    withinWidth: maxWidth,
    fontFamily: FONT_FAMILY,
    fontWeight,
  });
  const words = text.split(/\s+/).filter(Boolean);

  return (
    <div
      dir={directionOf(text)}
      style={{
        fontFamily: FONT_FAMILY,
        fontWeight,
        // The word margins add width that fitText does not see: leave room for them.
        fontSize: Math.min(fontSize, fitted.fontSize * 0.9),
        lineHeight: 1.2,
        color,
        textAlign: "center",
        whiteSpace: "nowrap",
        textShadow: "0 6px 28px rgba(0, 0, 0, 0.55)",
        ...style,
      }}
    >
      {words.map((word, index) => (
        <Word key={index} text={word} appearAt={startFrame + index * stagger} />
      ))}
    </div>
  );
};
