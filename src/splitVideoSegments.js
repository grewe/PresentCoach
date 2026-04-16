import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { segmentCountFromDuration } from "./segmentMath.js";

let ffmpegLoadPromise = null;

function loadFfmpeg() {
  if (!ffmpegLoadPromise) {
    const ffmpeg = new FFmpeg();
    ffmpegLoadPromise = ffmpeg.load().then(() => ffmpeg);
  }
  return ffmpegLoadPromise;
}

/**
 * Splits an MP4 into ~10s segments. Returns blob URLs for each segment.
 * Caller must revoke URLs. Not called when only one segment is needed.
 */
export async function splitVideoSegments(file, durationSec, signal) {
  const count = segmentCountFromDuration(durationSec);
  if (count <= 1) {
    throw new Error("splitVideoSegments expects count > 1");
  }

  const ffmpeg = await loadFfmpeg();
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  await ffmpeg.writeFile("input.mp4", await fetchFile(file));

  const results = [];

  for (let i = 0; i < count; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const start = i * 10;
    const len = Math.min(10, durationSec - start);
    const outName = `seg_${i}.mp4`;

    await ffmpeg.deleteFile(outName).catch(() => {});

    const argsCopy = [
      "-ss",
      String(start),
      "-i",
      "input.mp4",
      "-t",
      String(len),
      "-c",
      "copy",
      "-avoid_negative_ts",
      "make_zero",
      outName,
    ];

    let code = await ffmpeg.exec(argsCopy, -1, { signal });

    if (code !== 0) {
      await ffmpeg.deleteFile(outName).catch(() => {});
      const argsReencode = [
        "-ss",
        String(start),
        "-i",
        "input.mp4",
        "-t",
        String(len),
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "28",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outName,
      ];
      code = await ffmpeg.exec(argsReencode, -1, { signal });
    }

    if (code !== 0) {
      throw new Error(`Could not extract segment ${i + 1} (ffmpeg exit ${code})`);
    }

    const data = await ffmpeg.readFile(outName);
    const blob = new Blob([data], { type: "video/mp4" });
    if (blob.size === 0) {
      await ffmpeg.deleteFile(outName).catch(() => {});
      throw new Error(`Segment ${i + 1} is empty`);
    }

    results.push({ seq: i + 1, url: URL.createObjectURL(blob) });
    await ffmpeg.deleteFile(outName).catch(() => {});
  }

  await ffmpeg.deleteFile("input.mp4").catch(() => {});

  return results;
}
