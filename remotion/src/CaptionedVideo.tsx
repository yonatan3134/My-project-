import type { Caption } from "@remotion/captions";
import { Video } from "@remotion/media";
import React from "react";
import type { CalculateMetadataFunction } from "remotion";
import { AbsoluteFill } from "remotion";
import { Captions } from "./Captions";
import { getVideoInfo, resolveSrc } from "./lib/media";

export type CaptionedVideoProps = {
  /** File under public/ (for example "clips/talk.mp4") or a URL. */
  readonly videoSrc: string;
  /** Caption JSON under public/, as written by scripts/transcribe.sh. Null for no captions. */
  readonly captionsSrc: string | null;
  readonly highlightColor: string;
  /** Words closer together than this (ms) share a caption page. */
  readonly combineWithinMs: number;
  /** Filled in by calculateMetadata from captionsSrc. */
  readonly captions: Caption[];
};

/** Size and length follow the video; captions are loaded from the JSON file. */
export const calculateCaptionedVideoMetadata: CalculateMetadataFunction<
  CaptionedVideoProps
> = async ({ props, abortSignal }) => {
  const fps = 30;
  const info = await getVideoInfo(props.videoSrc);
  let captions: Caption[] = [];
  if (props.captionsSrc) {
    const response = await fetch(resolveSrc(props.captionsSrc), {
      signal: abortSignal,
    });
    if (!response.ok) {
      throw new Error(`Could not load captions: ${props.captionsSrc}`);
    }
    captions = (await response.json()) as Caption[];
  }
  return {
    fps,
    width: info.width,
    height: info.height,
    durationInFrames: Math.max(1, Math.round(info.durationInSeconds * fps)),
    props: { ...props, captions },
  };
};

export const CaptionedVideo: React.FC<CaptionedVideoProps> = ({
  videoSrc,
  captions,
  highlightColor,
  combineWithinMs,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Video
        name="Footage"
        src={resolveSrc(videoSrc)}
        style={{ width: "100%", height: "100%" }}
      />
      <Captions
        captions={captions}
        highlightColor={highlightColor}
        combineWithinMs={combineWithinMs}
      />
    </AbsoluteFill>
  );
};
