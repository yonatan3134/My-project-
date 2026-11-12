import type { Caption, TikTokPage } from "@remotion/captions";
import { createTikTokStyleCaptions } from "@remotion/captions";
import { fitText } from "@remotion/layout-utils";
import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { FONT_FAMILY } from "./lib/fonts";
import { isRtl } from "./lib/rtl";

const fontFamily = FONT_FAMILY;
const FONT_WEIGHT = 800;

type CaptionPageProps = {
  readonly page: TikTokPage;
  readonly highlightColor: string;
};

const CaptionPage: React.FC<CaptionPageProps> = ({ page, highlightColor }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const timeMs = page.startMs + (frame / fps) * 1000;
  const portrait = height > width;

  const maxFontSize = Math.round(width * (portrait ? 0.085 : 0.05));
  const fitted = fitText({
    text: page.text.trim(),
    withinWidth: width * (portrait ? 0.84 : 0.8),
    fontFamily,
    fontWeight: FONT_WEIGHT,
  });
  const fontSize = Math.min(maxFontSize, fitted.fontSize);

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: height * (portrait ? 0.24 : 0.1),
      }}
    >
      <div
        dir={isRtl(page.tokens.map((token) => token.text)) ? "rtl" : "ltr"}
        style={{
          fontFamily,
          fontWeight: FONT_WEIGHT,
          fontSize,
          lineHeight: 1.15,
          color: "white",
          textAlign: "center",
          whiteSpace: "pre",
          WebkitTextStroke: `${Math.max(4, fontSize * 0.14)}px rgba(0, 0, 0, 0.85)`,
          paintOrder: "stroke fill",
          textShadow: "0 6px 24px rgba(0, 0, 0, 0.45)",
          scale: interpolate(frame, [0, 5], [0.86, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.out(Easing.back(1.6)),
          }),
          opacity: interpolate(frame, [0, 3], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {page.tokens.map((token) => {
          const active = token.fromMs <= timeMs && timeMs < token.toMs;
          return (
            <span
              key={token.fromMs}
              style={{ color: active ? highlightColor : "white" }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

type CaptionsProps = {
  readonly captions: Caption[];
  /** Words closer together than this share a page. Lower means fewer words on screen. */
  readonly combineWithinMs?: number;
  readonly highlightColor?: string;
};

/**
 * Word-highlight captions. Timestamps are relative to the start of the media
 * file, so keep this next to its <Video> under the same timing boundary.
 */
export const Captions: React.FC<CaptionsProps> = ({
  captions,
  combineWithinMs = 1200,
  highlightColor = "#facc15",
}) => {
  const { fps } = useVideoConfig();
  const pages = useMemo(
    () =>
      createTikTokStyleCaptions({
        captions,
        combineTokensWithinMilliseconds: combineWithinMs,
      }).pages,
    [captions, combineWithinMs],
  );

  return (
    <>
      {pages.map((page, index) => {
        const from = Math.round((page.startMs / 1000) * fps);
        const nextStart = pages[index + 1]?.startMs ?? Infinity;
        const endMs = Math.min(nextStart, page.startMs + page.durationMs + 200);
        const durationInFrames = Math.max(
          1,
          Math.round((endMs / 1000) * fps) - from,
        );
        return (
          <Sequence
            key={page.startMs}
            name={page.text.trim()}
            from={from}
            durationInFrames={durationInFrames}
            layout="none"
          >
            <CaptionPage page={page} highlightColor={highlightColor} />
          </Sequence>
        );
      })}
    </>
  );
};
