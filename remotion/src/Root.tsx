import React from "react";
import { Composition, Folder } from "remotion";
import {
  CaptionedVideo,
  calculateCaptionedVideoMetadata,
} from "./CaptionedVideo";
import { TitleCard } from "./TitleCard";
import {
  BIRTHDAY_FRAMES,
  BirthdayGreeting,
} from "./birthday/BirthdayGreeting";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Folder name="Templates">
        {/* A clip with word-highlight captions. Size and length follow the video.
            Render your own clip by overriding the props:
            npx remotion render CaptionedVideo ../out/talk.mp4 \
              --props='{"videoSrc":"clips/talk.mp4","captionsSrc":"clips/talk.captions.json"}' */}
        <Composition
          id="CaptionedVideo"
          component={CaptionedVideo}
          calculateMetadata={calculateCaptionedVideoMetadata}
          durationInFrames={300}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            videoSrc: "sample/sample.mp4",
            captionsSrc: "sample/sample.captions.json",
            highlightColor: "#facc15",
            combineWithinMs: 1200,
            captions: [],
          }}
        />
        <Composition
          id="TitleCard"
          component={TitleCard}
          durationInFrames={90}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{
            title: "My video",
            subtitle: "Made with Remotion",
            accentColor: "#facc15",
          }}
        />
      </Folder>
      <Folder name="Greetings">
        {/* Vertical birthday greeting from three photos, cut to a music-box tune.
            Texts and photo paths are edited in src/birthday/BirthdayGreeting.tsx. */}
        <Composition
          id="BirthdayGreeting"
          component={BirthdayGreeting}
          durationInFrames={BIRTHDAY_FRAMES}
          fps={30}
          width={1080}
          height={1920}
        />
      </Folder>
    </>
  );
};
