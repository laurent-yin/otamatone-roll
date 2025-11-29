import { NoteTimeline } from '../types/music';
import { midiToFrequency, stemPosition } from './frequency';

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const hasBrowserCanvasSupport = () =>
  typeof document !== 'undefined' && typeof window !== 'undefined';

const DEFAULT_PREVIEW_WIDTH = 960;
const DEFAULT_PREVIEW_HEIGHT = 120;
const FALLBACK_MIN_FREQUENCY = midiToFrequency(36);
const FALLBACK_MAX_FREQUENCY = midiToFrequency(84);

export const buildTimelinePreviewImage = (
  timeline: NoteTimeline | null | undefined,
  options?: {
    width?: number;
    height?: number;
    minFrequency?: number;
    maxFrequency?: number;
  }
): string | null => {
  if (
    !hasBrowserCanvasSupport() ||
    !timeline ||
    !Array.isArray(timeline.notes) ||
    timeline.notes.length === 0 ||
    typeof timeline.totalBeats !== 'number' ||
    timeline.totalBeats <= 0
  ) {
    return null;
  }

  const width = Math.max(32, options?.width ?? DEFAULT_PREVIEW_WIDTH);
  const height = Math.max(16, options?.height ?? DEFAULT_PREVIEW_HEIGHT);
  const canvas = document.createElement('canvas');
  const dpr = Math.max(1, Math.min(4, window.devicePixelRatio || 1));
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return null;
  }
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const { notes, totalBeats } = timeline;
  const measureBoundaries = Array.isArray(timeline.measureBoundaries)
    ? timeline.measureBoundaries
    : [];
  const beatBoundaries = Array.isArray(timeline.beatBoundaries)
    ? timeline.beatBoundaries
    : [];

  const minPitch = notes.reduce(
    (acc, note) => Math.min(acc, note.pitch),
    Number.POSITIVE_INFINITY
  );
  const maxPitch = notes.reduce(
    (acc, note) => Math.max(acc, note.pitch),
    Number.NEGATIVE_INFINITY
  );
  if (!Number.isFinite(minPitch) || !Number.isFinite(maxPitch)) {
    return null;
  }

  const requestedMinFrequency = Number(options?.minFrequency);
  const requestedMaxFrequency = Number(options?.maxFrequency);
  const effectiveMinFrequency = Number.isFinite(requestedMinFrequency)
    ? Math.max(1e-3, requestedMinFrequency)
    : Math.max(FALLBACK_MIN_FREQUENCY, midiToFrequency(minPitch));
  const effectiveMaxFrequencyCandidate = Number.isFinite(requestedMaxFrequency)
    ? Math.max(1e-3, requestedMaxFrequency)
    : Math.max(FALLBACK_MAX_FREQUENCY, midiToFrequency(maxPitch));
  const effectiveMaxFrequency = Math.max(
    effectiveMinFrequency + 1e-3,
    effectiveMaxFrequencyCandidate
  );

  const verticalPadding = height * 0.15;
  const usableHeight = Math.max(1, height - verticalPadding * 2);

  const drawBoundarySet = (beats: number[], opacity: number, dash = false) => {
    if (beats.length === 0) {
      return;
    }
    ctx.save();
    ctx.lineWidth = dash ? 0.75 : 1;
    ctx.strokeStyle = `rgba(255, 255, 255, ${opacity.toFixed(3)})`;
    if (dash) {
      ctx.setLineDash([4, 4]);
    }
    beats.forEach((beat) => {
      if (typeof beat !== 'number' || beat <= 0) {
        return;
      }
      const ratio = clamp(beat / totalBeats, 0, 1);
      const x = ratio * width;
      ctx.beginPath();
      ctx.moveTo(x, verticalPadding * 0.3);
      ctx.lineTo(x, height - verticalPadding * 0.3);
      ctx.stroke();
    });
    ctx.restore();
  };

  drawBoundarySet(measureBoundaries, 0.28);
  drawBoundarySet(beatBoundaries, 0.12, true);

  ctx.save();
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#0f172a');
  gradient.addColorStop(1, '#020617');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(12, 20, 40, 0.35)';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  ctx.lineCap = 'round';

  notes.forEach((note) => {
    if (!note) {
      return;
    }
    const startRatio = clamp(note.startBeat / totalBeats, 0, 1);
    const endRatio = clamp(
      (note.startBeat + Math.max(0, note.durationBeats)) / totalBeats,
      startRatio + 0.001,
      1
    );
    const velocityNorm = clamp(
      Number.isFinite(note.velocity) ? note.velocity / 127 : 0.65,
      0.2,
      1
    );
    const frequency = midiToFrequency(note.pitch);
    const normalized = stemPosition(
      effectiveMinFrequency,
      effectiveMaxFrequency,
      frequency
    );
    const centerY = verticalPadding + normalized * usableHeight;
    const noteWidth = Math.max(1.2, (endRatio - startRatio) * width);
    const baseThickness = Math.min(height * 0.5, Math.max(2, noteWidth * 0.12));
    const thickness = clamp(baseThickness, 1.5, height * 0.55);

    ctx.strokeStyle = `rgba(255, 225, 185, ${(0.55 + 0.35 * velocityNorm).toFixed(3)})`;
    ctx.lineWidth = thickness;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 1.5;

    ctx.beginPath();
    ctx.moveTo(startRatio * width, centerY);
    ctx.lineTo(endRatio * width, centerY);
    ctx.stroke();
  });

  return canvas.toDataURL('image/png');
};
