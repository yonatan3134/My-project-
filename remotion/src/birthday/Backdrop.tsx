import React from "react";
import {
  AbsoluteFill,
  Img,
  random,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { COLORS } from "./theme";

const DOTS = 16;

/** Soft lights drifting upwards, so a still background never looks frozen. */
const Bokeh: React.FC = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  return (
    <AbsoluteFill>
      {new Array(DOTS).fill(true).map((_, index) => {
        const size = 60 + random(`bokeh-size-${index}`) * 180;
        const speed = 0.5 + random(`bokeh-speed-${index}`) * 1.2;
        const startY = random(`bokeh-y-${index}`) * (height + size);
        const travel = height + size * 2;
        const y = height + size - ((startY + frame * speed) % travel);
        const x =
          random(`bokeh-x-${index}`) * width +
          Math.sin(frame / 50 + index) * 24;
        const warm = index % 3 !== 0;
        return (
          <div
            key={index}
            style={{
              position: "absolute",
              left: x - size / 2,
              top: y - size / 2,
              width: size,
              height: size,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${
                warm ? "rgba(250, 204, 21, 0.22)" : "rgba(255, 255, 255, 0.16)"
              } 0%, rgba(255, 255, 255, 0) 70%)`,
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

type BackdropProps = {
  /** A photo under public/ to use as a blurred, darkened background. Omit for the plain night sky. */
  readonly photo?: string;
};

export const Backdrop: React.FC<BackdropProps> = ({ photo }) => {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${COLORS.night} 0%, ${COLORS.indigo} 55%, #3b1d5e 100%)`,
      }}
    >
      {photo ? (
        <>
          <Img
            src={staticFile(photo)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: "blur(46px) saturate(1.25)",
              scale: 1.3,
            }}
          />
          <AbsoluteFill style={{ backgroundColor: "rgba(11, 16, 32, 0.58)" }} />
        </>
      ) : null}
      <Bokeh />
    </AbsoluteFill>
  );
};
