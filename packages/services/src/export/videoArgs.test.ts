import { describe, expect, it } from 'vitest';
import { SEGMENT_SECONDS, WEBM_MAX_FRAMES, concatListText, concatMuxArgs, evenDim, segmentEncodeArgs, segmentName, segmentPlan, singlePassArgs, singlePassMuxArgs, videoMime } from './videoArgs';

describe('evenDim', () => {
  it('floors to even with a floor of 2', () => {
    expect(evenDim(1921)).toBe(1920);
    expect(evenDim(1920)).toBe(1920);
    expect(evenDim(1)).toBe(2);
  });
});

describe('segmentPlan', () => {
  it('splits frames into SEGMENT_SECONDS-sized segments with a short tail', () => {
    // 30fps, 5s -> 150 frames -> segments of 60,60,30
    expect(segmentPlan(150, 30)).toEqual([
      { index: 0, frames: 60 },
      { index: 1, frames: 60 },
      { index: 2, frames: 30 },
    ]);
    expect(SEGMENT_SECONDS).toBe(2);
  });
  it('a tiny project is one segment', () => {
    expect(segmentPlan(1, 30)).toEqual([{ index: 0, frames: 1 }]);
  });
});

describe('segmentEncodeArgs', () => {
  it('mp4: image2 in, x264 verbatim codec args, per-segment numbering from 0 (no -start_number)', () => {
    const args = segmentEncodeArgs({ format: 'mp4', fps: 30, frameCount: 150, hasAudio: true }, { index: 1, frames: 60 });
    expect(args).toEqual([
      '-framerate', '30', '-i', 'frame%05d.jpg', '-frames:v', '60',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
      'seg_001.mp4',
    ]);
    expect(args).not.toContain('-start_number');
  });
  it('webm: vp9 verbatim codec args, pinned off multithreaded code paths', () => {
    const args = segmentEncodeArgs({ format: 'webm', fps: 24, frameCount: 48, hasAudio: false }, { index: 0, frames: 48 });
    expect(args).toEqual([
      '-framerate', '24', '-i', 'frame%05d.jpg', '-frames:v', '48',
      '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'good', '-cpu-used', '5', '-pix_fmt', 'yuv420p',
      '-row-mt', '0', '-tile-columns', '0', '-threads', '1',
      'seg_000.webm',
    ]);
  });
});

describe('concat + mux', () => {
  it('list text names every segment in order', () => {
    expect(concatListText({ format: 'mp4', fps: 30, frameCount: 150, hasAudio: true })).toBe(
      "file 'seg_000.mp4'\nfile 'seg_001.mp4'\nfile 'seg_002.mp4'\n",
    );
  });
  it('mp4 with audio: PER-STREAM copy flags, aac 192k, +faststart, -shortest', () => {
    expect(concatMuxArgs({ format: 'mp4', fps: 30, frameCount: 150, hasAudio: true })).toEqual([
      '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-i', 'mix.wav',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest',
      'out.mp4',
    ]);
  });
  it('webm with audio: libopus 128k, no faststart', () => {
    expect(concatMuxArgs({ format: 'webm', fps: 30, frameCount: 150, hasAudio: true })).toEqual([
      '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-i', 'mix.wav',
      '-c:v', 'copy', '-c:a', 'libopus', '-b:a', '128k', '-shortest',
      'out.webm',
    ]);
  });
  it('no-audio: wav input and every -c:a flag omitted', () => {
    const args = concatMuxArgs({ format: 'mp4', fps: 30, frameCount: 150, hasAudio: false });
    expect(args).toEqual([
      '-f', 'concat', '-safe', '0', '-i', 'list.txt',
      '-c:v', 'copy', '-movflags', '+faststart',
      'out.mp4',
    ]);
    expect(args).not.toContain('mix.wav');
    expect(args).not.toContain('-shortest');
  });
});

describe('singlePassArgs (webm single-pass ruling, spec §6 amendment) — VIDEO-ONLY', () => {
  it('webm with audio: encode is still vp9-only (no wav input), output goes to mid.webm — a second exec finishes it', () => {
    expect(singlePassArgs({ format: 'webm', fps: 30, frameCount: 90, hasAudio: true })).toEqual([
      '-framerate', '30', '-i', 'frame%05d.jpg', '-frames:v', '90',
      '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'good', '-cpu-used', '5', '-pix_fmt', 'yuv420p',
      '-row-mt', '0', '-tile-columns', '0', '-threads', '1',
      'mid.webm',
    ]);
  });
  it('webm without audio: same shape, output goes straight to out.webm (no second exec needed)', () => {
    const args = singlePassArgs({ format: 'webm', fps: 30, frameCount: 90, hasAudio: false });
    expect(args).toEqual([
      '-framerate', '30', '-i', 'frame%05d.jpg', '-frames:v', '90',
      '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'good', '-cpu-used', '5', '-pix_fmt', 'yuv420p',
      '-row-mt', '0', '-tile-columns', '0', '-threads', '1',
      'out.webm',
    ]);
    expect(args).not.toContain('mix.wav');
  });
  it('exports the 1800-frame cap', () => {
    expect(WEBM_MAX_FRAMES).toBe(1800);
  });
});

describe('singlePassMuxArgs (webm audio finish — vp9-free stream copy, spec §6 amendment)', () => {
  it('stream-copies mid.webm + mix.wav into out.webm — never re-encodes video, so it never touches the crash-prone simultaneous audio+video vp9 path', () => {
    expect(singlePassMuxArgs({ format: 'webm', fps: 30, frameCount: 90, hasAudio: true })).toEqual([
      '-i', 'mid.webm', '-i', 'mix.wav',
      '-c:v', 'copy', '-c:a', 'libopus', '-b:a', '128k', '-shortest',
      'out.webm',
    ]);
  });
});

describe('videoMime + segmentName', () => {
  it('maps formats', () => {
    expect(videoMime('mp4')).toBe('video/mp4');
    expect(videoMime('webm')).toBe('video/webm');
    expect(segmentName('webm', 12)).toBe('seg_012.webm');
  });
});
