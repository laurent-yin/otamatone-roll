import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  useOtamatoneRollNotes,
  DEFAULT_SECONDS_PER_BEAT,
} from '../hooks/useOtamatoneRollNotes';
import {
  NoteCharTimeMap,
  NotePlaybackEvent,
  NoteTimeline,
} from '../types/music';
import {
  DEFAULT_HIGHEST_MIDI,
  DEFAULT_LOWEST_MIDI,
  frequencyToMidi,
  midiToFrequency,
  stemPosition,
  midiToNoteName,
} from '../utils/frequency';

interface OtamatoneRollProps {
  currentTime?: number;
  isPlaying?: boolean;
  activeNoteEvent?: NotePlaybackEvent | null;
  noteCharTimes?: NoteCharTimeMap;
  noteTimeline?: NoteTimeline | null;
  notation?: string;
  lowestNoteHz?: number;
  highestNoteHz?: number;
}

const PLAYHEAD_VERTICAL_INSET = 12;
const PLAYABLE_EDGE_RATIO = 0.03;

const OTAMATONE_LENGTH_UNITS = 23;
const OTAMATONE_WIDTH_UNITS = 1.5;
const OTAMATONE_WIDTH_PER_LENGTH =
  OTAMATONE_WIDTH_UNITS / OTAMATONE_LENGTH_UNITS;

const BASE_PLAYHEAD_OUTER_WIDTH = 28;
const BASE_PLAYHEAD_INNER_PADDING = 5;
const BASE_PLAYHEAD_RADIUS = 14;
const NOTE_LABEL_MARGIN = 14;
const NOTE_LABEL_GAP = 12;
const MIN_PLAYHEAD_FRACTION = 0.12;
const BEATS_PER_VERTICAL_SPAN = 4;
const FALLBACK_PIXELS_PER_SECOND = 100;
const NOTE_THICKNESS_RATIO = 0.7; // portion of inner width used for note thickness

const getTimestamp = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const clampMidiPitch = (pitch: number): number => {
  if (!Number.isFinite(pitch)) {
    return 0;
  }
  return Math.min(127, Math.max(0, Math.round(pitch)));
};

const derivePitchFromFrequency = (frequency?: number, fallback?: number) => {
  if (
    typeof frequency !== 'number' ||
    !Number.isFinite(frequency) ||
    frequency <= 0
  ) {
    return clampMidiPitch(fallback ?? DEFAULT_LOWEST_MIDI);
  }
  return clampMidiPitch(frequencyToMidi(frequency));
};

const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

export const OtamatoneRoll: React.FC<OtamatoneRollProps> = ({
  currentTime = 0,
  isPlaying = false,
  activeNoteEvent = null,
  noteCharTimes,
  noteTimeline,
  notation = '',
  lowestNoteHz,
  highestNoteHz,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const {
    notes,
    totalDuration,
    baselineSecondsPerBeat,
    playbackSecondsPerBeat,
    measureBoundaries = [] as number[],
  } = useOtamatoneRollNotes(notation, noteTimeline);
  const effectiveSecondsPerBeat =
    typeof baselineSecondsPerBeat === 'number' && baselineSecondsPerBeat > 0
      ? baselineSecondsPerBeat
      : DEFAULT_SECONDS_PER_BEAT;
  const warpRatio = useMemo(() => {
    if (
      typeof playbackSecondsPerBeat === 'number' &&
      playbackSecondsPerBeat > 0
    ) {
      return playbackSecondsPerBeat / effectiveSecondsPerBeat;
    }
    return 1;
  }, [playbackSecondsPerBeat, effectiveSecondsPerBeat]);
  const warpSafe = Number.isFinite(warpRatio) && warpRatio > 0 ? warpRatio : 1;
  const convertPlaybackTime = useCallback(
    (time?: number) => {
      if (typeof time !== 'number' || !Number.isFinite(time)) {
        return undefined;
      }
      return time / warpSafe;
    },
    [warpSafe]
  );
  const syncedTimeRef = useRef(convertPlaybackTime(currentTime) ?? 0);
  const syncedTimestampRef = useRef<number>(0);
  const isPlayingRef = useRef(isPlaying);
  const activeNoteIndexRef = useRef<number | null>(null);
  const latestEventIdRef = useRef(0);
  const measureBoundaryLogRef = useRef('');

  const minFrequency = useMemo(() => {
    if (
      typeof lowestNoteHz === 'number' &&
      Number.isFinite(lowestNoteHz) &&
      lowestNoteHz > 0
    ) {
      return lowestNoteHz;
    }
    return midiToFrequency(DEFAULT_LOWEST_MIDI);
  }, [lowestNoteHz]);

  const maxFrequency = useMemo(() => {
    const fallback = Math.max(
      minFrequency + 1,
      midiToFrequency(DEFAULT_HIGHEST_MIDI)
    );
    if (
      typeof highestNoteHz === 'number' &&
      Number.isFinite(highestNoteHz) &&
      highestNoteHz > 0
    ) {
      return Math.max(highestNoteHz, minFrequency + 1);
    }
    return fallback;
  }, [highestNoteHz, minFrequency]);

  const { minPitch, maxPitch } = useMemo(() => {
    const derivedMin = derivePitchFromFrequency(
      minFrequency,
      DEFAULT_LOWEST_MIDI
    );
    const derivedMax = derivePitchFromFrequency(
      maxFrequency,
      DEFAULT_HIGHEST_MIDI
    );

    return {
      minPitch: derivedMin,
      maxPitch: Math.max(derivedMin + 1, derivedMax),
    };
  }, [minFrequency, maxFrequency]);

  const noteIndexByStartChar = useMemo(() => {
    const map = new Map<number, number>();
    notes.forEach((note, index) => {
      const startChar = note.source?.startChar;
      if (typeof startChar === 'number' && !map.has(startChar)) {
        map.set(startChar, index);
      }
    });
    return map;
  }, [notes]);

  const noteStartTimes = useMemo(() => {
    return notes.map((note) => {
      const startChar = note.source?.startChar;
      if (
        typeof startChar === 'number' &&
        noteCharTimes &&
        typeof noteCharTimes[startChar] === 'number'
      ) {
        const converted = convertPlaybackTime(noteCharTimes[startChar]);
        if (typeof converted === 'number') {
          return converted;
        }
      }
      return note.startTime;
    });
  }, [convertPlaybackTime, notes, noteCharTimes]);

  const renderedTotalDuration = useMemo(() => {
    let maxEnd = totalDuration;
    notes.forEach((note, index) => {
      const adjustedStart = noteStartTimes[index] ?? note.startTime;
      const endTime = adjustedStart + note.duration;
      if (endTime > maxEnd) {
        maxEnd = endTime;
      }
    });
    return maxEnd;
  }, [notes, noteStartTimes, totalDuration]);

  const findNoteIndexForEvent = useCallback(
    (event: NotePlaybackEvent): number | null => {
      if (typeof event.startChar === 'number') {
        const match = noteIndexByStartChar.get(event.startChar);
        if (typeof match === 'number') {
          return match;
        }
      }

      const baselineTime = convertPlaybackTime(event.timeSeconds);

      if (event.midiPitches.length > 0) {
        const midiSet = new Set(event.midiPitches);
        let bestIndex: number | null = null;
        let smallestDelta = Number.POSITIVE_INFINITY;

        notes.forEach((note, index) => {
          if (!midiSet.has(note.pitch)) {
            return;
          }
          const adjustedStart = noteStartTimes[index] ?? note.startTime;
          const delta =
            typeof baselineTime === 'number'
              ? Math.abs(adjustedStart - baselineTime)
              : Number.POSITIVE_INFINITY;
          if (delta < smallestDelta) {
            smallestDelta = delta;
            bestIndex = index;
          }
        });

        if (bestIndex !== null) {
          return bestIndex;
        }
      }

      return null;
    },
    [convertPlaybackTime, noteIndexByStartChar, notes, noteStartTimes]
  );

  const getDisplayTime = useCallback(() => {
    const now = getTimestamp();
    if (isPlayingRef.current) {
      const elapsed = (now - syncedTimestampRef.current) / 1000;
      return syncedTimeRef.current + elapsed / warpSafe;
    }
    return syncedTimeRef.current;
  }, [warpSafe]);

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    canvas.width = width * dpr;
    canvas.height = height * dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const playheadOuterWidth =
      height > 0
        ? height * OTAMATONE_WIDTH_PER_LENGTH
        : BASE_PLAYHEAD_OUTER_WIDTH;
    const widthScale =
      BASE_PLAYHEAD_OUTER_WIDTH > 0
        ? playheadOuterWidth / BASE_PLAYHEAD_OUTER_WIDTH
        : 1;
    const playheadInnerPadding = Math.max(
      1,
      BASE_PLAYHEAD_INNER_PADDING * widthScale
    );
    const playheadRadius = Math.max(4, BASE_PLAYHEAD_RADIUS * widthScale);
    const minPlayheadCenter =
      NOTE_LABEL_MARGIN + NOTE_LABEL_GAP + playheadOuterWidth / 2;
    const playheadX = Math.max(
      width * MIN_PLAYHEAD_FRACTION,
      minPlayheadCenter
    );
    const playheadOuterX = playheadX - playheadOuterWidth / 2;

    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    const innerWidth = Math.max(
      1,
      playheadOuterWidth - playheadInnerPadding * 2
    );
    const innerX = playheadOuterX + playheadInnerPadding;
    const innerY = PLAYHEAD_VERTICAL_INSET;
    const innerHeight = Math.max(
      height - PLAYHEAD_VERTICAL_INSET * 2,
      playheadRadius
    );
    const playableTop = innerY + innerHeight * PLAYABLE_EDGE_RATIO;
    const playableBottom = innerY + innerHeight * (1 - PLAYABLE_EDGE_RATIO);
    const playableHeight = Math.max(1, playableBottom - playableTop);
    const pixelsPerBeat =
      innerHeight > 0 && BEATS_PER_VERTICAL_SPAN > 0
        ? innerHeight / BEATS_PER_VERTICAL_SPAN
        : null;
    const pixelsPerSecond = pixelsPerBeat
      ? pixelsPerBeat / effectiveSecondsPerBeat
      : FALLBACK_PIXELS_PER_SECOND;
    const noteHeight = Math.min(
      Math.max(2, innerWidth * NOTE_THICKNESS_RATIO),
      playableHeight
    );

    const pitchRange = maxPitch - minPitch;

    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    const labelX = Math.max(NOTE_LABEL_MARGIN, playheadOuterX - NOTE_LABEL_GAP);
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= pitchRange; i++) {
      const pitchValue = minPitch + i;
      const freq = midiToFrequency(pitchValue);
      const normalized = stemPosition(minFrequency, maxFrequency, freq);
      const y = Math.min(
        Math.max(playableTop + normalized * playableHeight, 0),
        height
      );
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      const noteName = midiToNoteName(pitchValue);
      if (noteName) {
        ctx.fillStyle = '#d1d5db';
        ctx.fillText(noteName, labelX, y);
      }
    }

    const effectiveTime = (() => {
      const time = getDisplayTime();
      return renderedTotalDuration > 0
        ? Math.min(time, renderedTotalDuration)
        : time;
    })();

    const drawInstrument = () => {
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(playheadOuterX, 0, playheadOuterWidth, height);
      ctx.fillStyle = '#111111';
      const innerRadius = Math.max(2, playheadRadius - 4 * widthScale);
      drawRoundedRect(
        ctx,
        innerX,
        innerY,
        innerWidth,
        innerHeight,
        innerRadius
      );
      ctx.fill();
    };

    drawInstrument();
    const drawMeasureMarkers = () => {
      if (!measureBoundaries.length) {
        return;
      }
      const barWidth = Math.max(1, 2 * widthScale);
      ctx.save();
      ctx.beginPath();
      ctx.rect(innerX, innerY, width - innerX, innerHeight);
      ctx.clip();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
      let firstBoundarySeconds: number | null = null;
      let firstBoundaryCenterX: number | null = null;
      measureBoundaries.forEach((boundary) => {
        if (typeof boundary !== 'number' || !Number.isFinite(boundary)) {
          return;
        }
        const centerX =
          playheadX + (boundary - effectiveTime) * pixelsPerSecond;
        if (centerX + barWidth < innerX || centerX - barWidth > width) {
          return;
        }
        ctx.fillRect(centerX - barWidth / 2, innerY, barWidth, innerHeight);
        if (firstBoundarySeconds === null || firstBoundaryCenterX === null) {
          firstBoundarySeconds = boundary;
          firstBoundaryCenterX = centerX;
        }
      });
      if (
        typeof firstBoundarySeconds === 'number' &&
        typeof firstBoundaryCenterX === 'number'
      ) {
        const boundarySecondsValue = firstBoundarySeconds as number;
        const boundaryCenterXValue = firstBoundaryCenterX as number;
        const summaryObject = {
          boundarySeconds: Number(boundarySecondsValue.toFixed(4)),
          canvasX: Number(boundaryCenterXValue.toFixed(2)),
          effectiveTime: Number(effectiveTime.toFixed(3)),
          pixelsPerSecond: Number(pixelsPerSecond.toFixed(2)),
        };
        const summary = JSON.stringify(summaryObject);
        if (measureBoundaryLogRef.current !== summary) {
          measureBoundaryLogRef.current = summary;
          console.debug('[OtamatoneRoll] measure marker debug', {
            ...summaryObject,
            playheadX: Number(playheadX.toFixed(2)),
            innerX: Number(innerX.toFixed(2)),
          });
        }
      }
      ctx.restore();
    };

    drawMeasureMarkers();

    const activeNoteIndex = activeNoteIndexRef.current;

    ctx.save();
    ctx.beginPath();
    ctx.rect(innerX, 0, width - innerX, height);
    ctx.clip();

    notes.forEach((note, index) => {
      const adjustedStart = noteStartTimes[index] ?? note.startTime;
      const timeDiff = adjustedStart - effectiveTime;
      const effectiveDuration = Math.max(note.duration, 0);
      const x = playheadX + timeDiff * pixelsPerSecond;
      const noteWidth = effectiveDuration * pixelsPerSecond;
      const noteRight = x + noteWidth;
      const noteFrequency = midiToFrequency(note.pitch);
      const normalized = stemPosition(
        minFrequency,
        maxFrequency,
        noteFrequency
      );
      const centerY = playableTop + normalized * playableHeight;
      const y = Math.min(
        Math.max(centerY - noteHeight / 2, playableTop),
        Math.min(playableBottom - noteHeight / 2, height - noteHeight)
      );

      if (noteRight < innerX || x > width) {
        return;
      }

      if (note.pitch < minPitch || note.pitch > maxPitch) {
        return;
      }

      const isActiveNote =
        typeof activeNoteIndex === 'number' && index === activeNoteIndex;

      let color: string;
      if (isActiveNote) {
        color = '#facc15';
      } else if (timeDiff > 0) {
        color = '#4a9eff';
      } else if (timeDiff + note.duration > 0) {
        color = '#4ade80';
      } else {
        color = '#666666';
      }

      const drawStart = Math.max(x, innerX);
      const drawWidth = noteRight - drawStart;
      if (drawWidth <= 0) {
        return;
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      drawRoundedRect(ctx, drawStart, y, drawWidth, noteHeight, noteHeight / 2);
      ctx.fill();

      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    ctx.restore();
  }, [
    getDisplayTime,
    notes,
    noteStartTimes,
    renderedTotalDuration,
    minPitch,
    maxPitch,
    minFrequency,
    maxFrequency,
    effectiveSecondsPerBeat,
    measureBoundaries,
  ]);

  useEffect(() => {
    console.debug('[OtamatoneRoll] measure boundaries updated', {
      count: measureBoundaries.length,
      values: measureBoundaries.slice(0, 8),
    });
  }, [measureBoundaries]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (syncedTimestampRef.current === 0) {
      syncedTimestampRef.current = getTimestamp();
    }

    const resizeObserver = new ResizeObserver(() => {
      renderFrame();
    });

    resizeObserver.observe(canvas);

    const animate = () => {
      if (isPlayingRef.current) {
        renderFrame();
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    renderFrame();
    animate();

    return () => {
      resizeObserver.disconnect();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [renderFrame]);

  useEffect(() => {
    const baselineTime = convertPlaybackTime(currentTime);
    if (typeof baselineTime === 'number') {
      syncedTimeRef.current = baselineTime;
    }
    syncedTimestampRef.current = getTimestamp();
    if (!isPlayingRef.current) {
      renderFrame();
    }
  }, [convertPlaybackTime, currentTime, renderFrame]);

  useEffect(() => {
    const now = getTimestamp();
    if (isPlayingRef.current && !isPlaying) {
      syncedTimeRef.current +=
        (now - syncedTimestampRef.current) / 1000 / warpSafe;
    }
    syncedTimestampRef.current = now;
    isPlayingRef.current = isPlaying;
    if (!isPlaying) {
      renderFrame();
    }
  }, [isPlaying, renderFrame, warpSafe]);

  useEffect(() => {
    if (!activeNoteEvent) {
      activeNoteIndexRef.current = null;
      return;
    }

    if (activeNoteEvent.sequenceId <= latestEventIdRef.current) {
      return;
    }

    latestEventIdRef.current = activeNoteEvent.sequenceId;
    activeNoteIndexRef.current = findNoteIndexForEvent(activeNoteEvent);

    const baselineTime = convertPlaybackTime(activeNoteEvent.timeSeconds);
    if (typeof baselineTime === 'number') {
      syncedTimeRef.current = baselineTime;
    }
    syncedTimestampRef.current = getTimestamp();

    renderFrame();
  }, [
    activeNoteEvent,
    convertPlaybackTime,
    findNoteIndexForEvent,
    renderFrame,
  ]);

  useEffect(() => {
    activeNoteIndexRef.current = null;
    latestEventIdRef.current = 0;
  }, [notes]);

  return <canvas ref={canvasRef} className="otamatone-roll-canvas" />;
};
