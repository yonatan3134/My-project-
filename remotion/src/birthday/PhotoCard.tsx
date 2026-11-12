import React from "react";
import {
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { CLAMP } from "./theme";

type PhotoCardProps = {
  /** File under public/. */
  readonly src: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  /** Resting tilt in degrees. */
  readonly tilt: number;
  /** CSS object-position: which part of the photo stays in the frame. */
  readonly focus: string;
  /** Frame at which the card arrives. */
  readonly enterAt: number;
  /** Frames over which the photo slowly pushes in (0 for none). */
  readonly pushInFrames?: number;
  readonly border?: number;
  readonly radius?: number;
  /** Extra white space under the photo, like an instant print. */
  readonly chin?: number;
};

/** A photo in a white frame that drops in with a small bounce, then pushes in slowly. */
export const PhotoCard: React.FC<PhotoCardProps> = ({
  src,
  left,
  top,
  width,
  height,
  tilt,
  focus,
  enterAt,
  pushInFrames = 0,
  border = 16,
  radius = 44,
  chin = 0,
}) => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        opacity: interpolate(frame, [enterAt, enterAt + 8], [0, 1], CLAMP),
        translate: interpolate(
          frame,
          [enterAt, enterAt + 22],
          ["0px 120px", "0px 0px"],
          { ...CLAMP, easing: Easing.bezier(0.16, 1, 0.3, 1) },
        ),
        scale: interpolate(frame, [enterAt, enterAt + 22], [0.86, 1], {
          ...CLAMP,
          easing: Easing.out(Easing.back(1.4)),
        }),
        rotate: interpolate(
          frame,
          [enterAt, enterAt + 22],
          [`${tilt * 4}deg`, `${tilt}deg`],
          { ...CLAMP, easing: Easing.bezier(0.16, 1, 0.3, 1) },
        ),
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          padding: `${border}px ${border}px ${border + chin}px`,
          borderRadius: radius,
          backgroundColor: "white",
          boxShadow: "0 30px 80px rgba(0, 0, 0, 0.5)",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            overflow: "hidden",
            borderRadius: Math.max(0, radius - border),
          }}
        >
          <Img
            src={staticFile(src)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: focus,
              scale: interpolate(
                frame,
                [enterAt, enterAt + Math.max(1, pushInFrames)],
                [1, pushInFrames > 0 ? 1.1 : 1],
                CLAMP,
              ),
            }}
          />
        </div>
      </div>
    </div>
  );
};
