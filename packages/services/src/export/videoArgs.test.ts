import { describe, expect, it } from 'vitest';
import { SEGMENT_SECONDS, WEBM_MAX_FRAMES, concatListText, concatMuxArgs, evenDim, segmentEncodeArgs, segmentName, segmentPlan, singlePassArgs, videoMime } from './videoArgs';

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
  it('webm: vp9 verbatim codec args', () => {
    const args = segmentEncodeArgs({ format: 'webm', fps: 24, frameCount: 48, hasAudio: false }, { index: 0, frames: 48 });
    expect(args).toEqual([
      '-framerate', '24', '-i', 'frame%05d.jpg', '-frames:v', '48',
      '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'good', '-cpu-used', '5', '-pix_fmt', 'yuv420p',
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

describe('singlePassArgs (webm single-pass ruling, spec §6 amendment)', () => {
  it('webm with audio: one exec — frames + wav in, vp9+opus out, -shortest', () => {
    expect(singlePassArgs({ format: 'webm', fps: 30, frameCount: 90, hasAudio: true })).toEqual([
      '-framerate', '30', '-i', 'frame%05d.jpg', '-frames:v', '90', '-i', 'mix.wav',
      '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'good', '-cpu-used', '5', '-pix_fmt', 'yuv420p',
      '-c:a', 'libopus', '-b:a', '128k', '-shortest',
      'out.webm',
    ]);
  });
  it('webm without audio: no wav input, no -c:a, no -shortest', () => {
    const args = singlePassArgs({ format: 'webm', fps: 30, frameCount: 90, hasAudio: false });
    expect(args).toEqual([
      '-framerate', '30', '-i', 'frame%05d.jpg', '-frames:v', '90',
      '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-deadline', 'good', '-cpu-used', '5', '-pix_fmt', 'yuv420p',
      'out.webm',
    ]);
  });
  it('exports the 1800-frame cap', () => {
    expect(WEBM_MAX_FRAMES).toBe(1800);
  });
});

describe('videoMime + segmentName', () => {
  it('maps formats', () => {
    expect(videoMime('mp4')).toBe('video/mp4');
    expect(videoMime('webm')).toBe('video/webm');
    expect(segmentName('webm', 12)).toBe('seg_012.webm');
  });
});
