import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Backdrop } from "./Backdrop";
import { Balloons, Confetti, Heart, Snooze } from "./Decor";
import { PhotoCard } from "./PhotoCard";
import { CLAMP, COLORS } from "./theme";
import { WordReveal } from "./WordReveal";

type TitleSceneProps = {
  readonly line1: string;
  readonly line2: string;
  /** Who the greeting is for, shown largest. */
  readonly name: string;
};

const Underline: React.FC<{ readonly appearAt: number }> = ({ appearAt }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        height: 14,
        borderRadius: 7,
        marginTop: 26,
        backgroundColor: COLORS.gold,
        width: interpolate(frame, [appearAt, appearAt + 22], [0, 420], {
          ...CLAMP,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
      }}
    />
  );
};

/** Opening: balloons rise while the greeting builds up line by line. */
export const TitleScene: React.FC<TitleSceneProps> = ({ line1, line2, name }) => {
  return (
    <AbsoluteFill>
      <Backdrop />
      {/* Along the edges only, clear of the text in the middle. */}
      <Balloons positions={[70, 185, 1010, 895, 960]} riseFrames={210} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <WordReveal text={line1} startFrame={12} fontSize={150} maxWidth={900} />
        <WordReveal
          text={line2}
          startFrame={34}
          fontSize={210}
          maxWidth={900}
          fontWeight={900}
          color={COLORS.gold}
        />
        <WordReveal
          text={name}
          startFrame={56}
          fontSize={280}
          maxWidth={900}
          fontWeight={900}
          style={{ marginTop: 10 }}
        />
        <Underline appearAt={70} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

type PhotoSceneProps = {
  /** Photo under public/. */
  readonly src: string;
  /** CSS object-position that keeps the face in the frame. */
  readonly focus: string;
  readonly tilt: number;
  readonly line1: string;
  readonly line2: string;
  /** Frames at which the two lines start. */
  readonly line1At: number;
  readonly line2At: number;
  /** Show floating Z letters over the photo. */
  readonly snooze?: boolean;
};

/** One photo in a white frame over its own blurred copy, with two lines of greeting below. */
export const PhotoScene: React.FC<PhotoSceneProps> = ({
  src,
  focus,
  tilt,
  line1,
  line2,
  line1At,
  line2At,
  snooze = false,
}) => {
  const { durationInFrames } = useVideoConfig();

  return (
    <AbsoluteFill>
      <Backdrop photo={src} />
      <PhotoCard
        src={src}
        left={90}
        top={220}
        width={900}
        height={1180}
        tilt={tilt}
        focus={focus}
        enterAt={8}
        pushInFrames={durationInFrames}
      />
      {snooze ? <Snooze left={640} top={380} /> : null}
      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: 1470,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
        }}
      >
        <WordReveal text={line1} startFrame={line1At} fontSize={92} maxWidth={920} />
        <WordReveal
          text={line2}
          startFrame={line2At}
          fontSize={92}
          maxWidth={920}
          color={COLORS.gold}
        />
      </div>
    </AbsoluteFill>
  );
};

type FinaleSceneProps = {
  /** The three photos, shown as a fan of instant prints: left, middle, right. */
  readonly photos: [string, string, string];
  readonly focuses: [string, string, string];
  readonly headline: string;
  readonly wish: string;
  readonly signature: string;
};

const BigWish: React.FC<{ readonly text: string; readonly appearAt: number }> = ({
  text,
  appearAt,
}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        scale:
          interpolate(frame, [appearAt, appearAt + 16], [0.4, 1], {
            ...CLAMP,
            easing: Easing.out(Easing.back(2.2)),
          }) *
          (1 + Math.sin(Math.max(0, frame - appearAt - 16) / 9) * 0.025),
      }}
    >
      <WordReveal
        text={text}
        startFrame={appearAt}
        fontSize={250}
        maxWidth={900}
        fontWeight={900}
        color={COLORS.gold}
      />
    </div>
  );
};

const FadeToNight: React.FC<{ readonly frames: number }> = ({ frames }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.night,
        opacity: interpolate(
          frame,
          [durationInFrames - frames, durationInFrames - 4],
          [0, 1],
          CLAMP,
        ),
      }}
    />
  );
};

/** Closing: the photos together, the big wish, confetti, then a fade out with the music. */
export const FinaleScene: React.FC<FinaleSceneProps> = ({
  photos,
  focuses,
  headline,
  wish,
  signature,
}) => {
  return (
    <AbsoluteFill>
      <Backdrop />
      <PhotoCard
        src={photos[0]}
        left={30}
        top={300}
        width={420}
        height={560}
        tilt={-9}
        focus={focuses[0]}
        enterAt={10}
        border={14}
        radius={14}
        chin={44}
      />
      <PhotoCard
        src={photos[2]}
        left={630}
        top={300}
        width={420}
        height={560}
        tilt={9}
        focus={focuses[2]}
        enterAt={18}
        border={14}
        radius={14}
        chin={44}
      />
      <PhotoCard
        src={photos[1]}
        left={305}
        top={240}
        width={470}
        height={620}
        tilt={-2}
        focus={focuses[1]}
        enterAt={26}
        border={14}
        radius={14}
        chin={48}
      />
      <div
        style={{
          position: "absolute",
          left: 80,
          right: 80,
          top: 960,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 20,
        }}
      >
        <WordReveal text={headline} startFrame={44} fontSize={150} maxWidth={920} fontWeight={900} />
        <BigWish text={wish} appearAt={80} />
        <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 50 }}>
          <Heart size={84} appearAt={128} />
          <WordReveal text={signature} startFrame={118} fontSize={76} maxWidth={700} />
          <Heart size={84} appearAt={134} />
        </div>
      </div>
      <Confetti />
      <FadeToNight frames={40} />
    </AbsoluteFill>
  );
};
