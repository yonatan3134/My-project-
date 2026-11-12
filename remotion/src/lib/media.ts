import { ALL_FORMATS, Input, UrlSource } from "mediabunny";
import { staticFile } from "remotion";

/** A file under public/ ("clips/talk.mp4") or a full URL. */
export const resolveSrc = (src: string) =>
  /^(https?:|blob:|data:)/.test(src) ? src : staticFile(src);

export const getVideoInfo = async (src: string) => {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(resolveSrc(src)),
  });
  const durationInSeconds = await input.computeDuration();
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) {
    throw new Error(`No video track found in ${src}`);
  }
  return {
    durationInSeconds,
    width: videoTrack.displayWidth,
    height: videoTrack.displayHeight,
  };
};
