# FFmpeg recipes

Every command here was run on FFmpeg 6.1 in this repo. Replace `in.mp4` / `out.mp4`.
Add `-hide_banner -loglevel error -y` for quiet, overwriting runs.

Defaults used throughout: H.264 (`libx264`), `-crf 18` (visually lossless; 20 to 23 for smaller files),
`-preset veryfast` while iterating (`slow` for a final file), AAC audio, `-pix_fmt yuv420p` and
`-movflags +faststart` for files that go to phones and the web.

## Inspect

```bash
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,r_frame_rate:format=duration,bit_rate -of json in.mp4
bash scripts/frames.sh in.mp4 12          # contact sheet PNG with timestamps
ffmpeg -ss 3 -i in.mp4 -frames:v 1 -q:v 2 thumb.jpg   # one frame at 3 s
```

## Trim

Re-encode, or the cut starts on a frozen frame. `-ss`/`-to` before `-i` are both source times.

```bash
ffmpeg -ss 2 -to 6.5 -i in.mp4 -c:v libx264 -crf 18 -preset veryfast -c:a aac out.mp4
ffmpeg -ss 00:01:07 -to 00:01:42 -i in.mp4 -c:v libx264 -crf 18 -preset veryfast -c:a aac out.mp4
```

## Join clips

Same codec, size and frame rate (for example cuts of one source): no re-encode.

```bash
printf "file '%s'\n" "$PWD/a.mp4" "$PWD/b.mp4" > list.txt
ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4
```

Different sources: re-encode through the concat filter (scale them to one size first if they differ).

```bash
ffmpeg -i a.mp4 -i b.mp4 -filter_complex "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 18 -preset veryfast -c:a aac out.mp4
```

## Remove silences

```bash
bash scripts/jumpcut.sh in.mp4                       # frame-exact, audio stays in sync
ffmpeg -i in.mp4 -af silencedetect=noise=-35dB:d=0.6 -f null - 2>&1 | grep silence_   # just list them
```

Real speech sits around -16 to -26 dB; raise `--noise` toward -30 for noisy rooms, lower it toward -45 for quiet studio audio.

## Reframe 16:9 to vertical 9:16 (1080x1920)

```bash
# Centre crop: fills the frame, loses the sides
ffmpeg -i in.mp4 -vf "crop=ih*9/16:ih,scale=1080:1920" -c:v libx264 -crf 20 -preset veryfast -c:a copy out.mp4

# Whole picture over a blurred copy of itself
ffmpeg -i in.mp4 -filter_complex "[0:v]split[bg][fg];[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:5[b];[fg]scale=1080:-2[f];[b][f]overlay=(W-w)/2:(H-h)/2" \
  -c:v libx264 -crf 20 -preset veryfast -c:a copy out.mp4
```

To follow a speaker who is off centre, move the crop: `crop=ih*9/16:ih:X:0` with `X` in source pixels.

## Resize, speed, fades

```bash
ffmpeg -i in.mp4 -vf "scale=-2:720" -c:v libx264 -crf 23 -preset veryfast -c:a copy out.mp4        # 720p
ffmpeg -i in.mp4 -filter_complex "[0:v]setpts=PTS/1.5[v];[0:a]atempo=1.5[a]" -map "[v]" -map "[a]" \
  -c:v libx264 -crf 20 -preset veryfast -c:a aac out.mp4                                          # 1.5x speed
ffmpeg -i in.mp4 -vf "fade=t=in:st=0:d=0.5,fade=t=out:st=4:d=0.5" -af "afade=t=in:st=0:d=0.5,afade=t=out:st=4:d=0.5" \
  -c:v libx264 -crf 20 -preset veryfast -c:a aac out.mp4                                          # st = clip length - d
```

`atempo` accepts 0.5 to 100 per filter; chain two for slower than half speed.

## Audio

```bash
ffmpeg -i in.mp4 -vn -c:a copy audio.m4a                     # extract without re-encoding
ffmpeg -i in.mp4 -vn -ac 1 -ar 16000 audio.wav               # 16 kHz mono WAV (speech tools)
ffmpeg -i in.mp4 -af "loudnorm=I=-14:TP=-1.5:LRA=11" -c:v copy -c:a aac -b:a 192k out.mp4   # -14 LUFS, the level social platforms play at
```

Music under a voice, lowered automatically while someone speaks (ducking):

```bash
ffmpeg -i talk.mp4 -stream_loop -1 -i music.m4a -filter_complex \
  "[0:a]asplit[voice][key];[1:a]volume=0.5[m];[m][key]sidechaincompress=threshold=0.03:ratio=10:attack=20:release=400[ducked];[voice][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest out.mp4
```

## Overlay a logo

```bash
ffmpeg -i in.mp4 -i logo.png -filter_complex "[1:v]scale=160:-1[l];[0:v][l]overlay=W-w-40:40" \
  -c:v libx264 -crf 20 -preset veryfast -c:a copy out.mp4      # top right, 40 px in
```

## Subtitles

Plain burned-in subtitles from an `.srt` (for animated captions use Remotion or HyperFrames instead):

```bash
ffmpeg -i in.mp4 -vf "subtitles=subs.srt:force_style='FontName=DejaVu Sans,FontSize=22,Bold=1,Outline=2,Shadow=0,MarginV=40'" \
  -c:v libx264 -crf 20 -preset veryfast -c:a copy out.mp4
```

- `FontSize` is measured against a 288-line-tall frame whatever the video size: 22 suits landscape, about 14 suits vertical.
- Hebrew works (right-to-left is handled) with a font that has Hebrew glyphs; `DejaVu Sans` is installed.
- The filter parses its argument: keep the `.srt` path free of spaces, quotes, colons and brackets (copy it to a simple name first).

Subtitles as a switchable track instead of burned in:

```bash
ffmpeg -i in.mp4 -i subs.srt -c copy -c:s mov_text -metadata:s:s:0 language=heb out.mp4
```

## GIF

```bash
ffmpeg -ss 1 -t 3 -i in.mp4 -vf "fps=12,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" out.gif
```
