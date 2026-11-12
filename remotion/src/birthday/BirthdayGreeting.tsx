import { Audio } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import React from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { FinaleScene, PhotoScene, TitleScene } from "./Scenes";
import { COLORS } from "./theme";

/**
 * A 36 second birthday greeting, cut to the music-box tune from
 * scripts/birthday-tune.py. One bar of the tune is 54 frames and the cuts sit
 * on bar lines: 162, 378, 594 and 756. Each crossfade is 18 frames, centred on
 * its cut, so a scene's duration is its slot plus the overlap it shares.
 *
 * To reuse it: put three photos in public/clips/birthday/ and edit the texts,
 * the `src` paths and each `focus` (which part of the photo stays in frame).
 */
export const BIRTHDAY_FRAMES = 1080;
const CROSSFADE = 18;

export const BirthdayGreeting: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.night }}>
      <TransitionSeries name="Scenes">
        <TransitionSeries.Sequence name="Title" durationInFrames={171}>
          <TitleScene line1="יום הולדת" line2="שמח" name="אבא!" />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: CROSSFADE })}
        />
        <TransitionSeries.Sequence name="Smile" durationInFrames={234}>
          <PhotoScene
            src="clips/birthday/smile.jpg"
            focus="50% 30%"
            tilt={-2}
            line1="לאבא הכי טוב בעולם"
            line2="עם החיוך הכי יפה שיש"
            line1At={40}
            line2At={104}
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: CROSSFADE })}
        />
        <TransitionSeries.Sequence name="Together" durationInFrames={234}>
          <PhotoScene
            src="clips/birthday/restaurant.jpg"
            focus="55% 28%"
            tilt={2}
            line1="תודה על השיחות, הצחוקים"
            line2="וכל הרגעים ביחד"
            line1At={40}
            line2At={104}
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: CROSSFADE })}
        />
        <TransitionSeries.Sequence name="Rest" durationInFrames={180}>
          <PhotoScene
            src="clips/birthday/resting.jpg"
            focus="60% 50%"
            tilt={-1.5}
            line1="ואחרי כל מה שאתה עושה..."
            line2="מגיע לך גם קצת לנוח"
            line1At={34}
            line2At={88}
            snooze
          />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: CROSSFADE })}
        />
        <TransitionSeries.Sequence name="Finale" durationInFrames={333}>
          <FinaleScene
            photos={[
              "clips/birthday/restaurant.jpg",
              "clips/birthday/smile.jpg",
              "clips/birthday/resting.jpg",
            ]}
            focuses={["55% 28%", "50% 30%", "60% 50%"]}
            headline="מזל טוב, אבא!"
            wish="עד 120!"
            signature="באהבה ענקית"
          />
        </TransitionSeries.Sequence>
      </TransitionSeries>
      <Audio name="Music" src={staticFile("music/happy-birthday-musicbox.m4a")} />
    </AbsoluteFill>
  );
};
