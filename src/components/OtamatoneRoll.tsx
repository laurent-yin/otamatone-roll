import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  useOtamatoneRollNotes,
  DEFAULT_SECONDS_PER_BEAT,
} from '../hooks/useOtamatoneRollNotes';
import { NoteCharTimeMap, NotePlaybackEvent } from '../types/music';
import {
  DEFAULT_HIGHEST_MIDI,
  DEFAULT_LOWEST_MIDI,
  frequencyToMidi,
  midiToFrequency,
  stemPosition,
  midiToNoteName,
} from '../utils/frequency';

interface OtamatoneRollProps {
  /** Current playback time in seconds */
  currentTime?: number;
  isPlaying?: boolean;
  activeNoteEvent?: NotePlaybackEvent | null;
  noteCharTimes?: NoteCharTimeMap;
  /** Current playback tempo - may change with warp/speed controls */
  currentSecondsPerBeat?: number;
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
const FALLBACK_PIXELS_PER_BEAT = 50;
const NOTE_THICKNESS_RATIO = 0.7;
const CHORD_ALIGNMENT_TOLERANCE_BEATS = 0.01; // in beats

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
  currentSecondsPerBeat,
  notation = '',
  lowestNoteHz,
  highestNoteHz,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);

  // Get the beat-based timeline (invariant to tempo changes)
  const {
    notes,
    totalBeats,
    secondsPerBeat: baselineSecondsPerBeat,
    measureBoundaries = [] as number[],
    beatBoundaries = [] as number[],
  } = useOtamatoneRollNotes(notation);

  // Use current playback tempo if provided, otherwise use baseline
  const effectiveSecondsPerBeat =
    typeof currentSecondsPerBeat === 'number' && currentSecondsPerBeat > 0
      ? currentSecondsPerBeat
      : typeof baselineSecondsPerBeat === 'number' && baselineSecondsPerBeat > 0
        ? baselineSecondsPerBeat
        : DEFAULT_SECONDS_PER_BEAT;

  // Convert seconds to beats using current tempo
  const secondsToBeats = useCallback(
    (seconds?: number): number | undefined => {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
        return undefined;
      }
      return seconds / effectiveSecondsPerBeat;
    },
    [effectiveSecondsPerBeat]
  );

  // Current position in beats (synced from playback)
  const syncedBeatRef = useRef(secondsToBeats(currentTime) ?? 0);
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

  // Map from startChar to note index (for highlighting)
  const noteIndexByStartChar = useMemo(() => {
    const map = new Map<number, number>();
    notes.forEach((note, index) => {
      const startChar = note.source?.startChar;
      if (typeof startChar !== 'number') {
        return;
      }
      const existingIndex = map.get(startChar);
      if (typeof existingIndex !== 'number') {
        map.set(startChar, index);
        return;
      }
      const existingNote = notes[existingIndex];
      if (!existingNote || note.pitch > existingNote.pitch) {
        map.set(startChar, index);
      }
    });
    return map;
  }, [notes]);

  // Compute adjusted start beats from noteCharTimes (if available)
  // This allows cursor sync from the ABC notation viewer
  const noteStartBeats = useMemo(() => {
    return notes.map((note) => {
      const startChar = note.source?.startChar;
      if (
        typeof startChar === 'number' &&
        noteCharTimes &&
        typeof noteCharTimes[startChar] === 'number'
      ) {
        const beatFromCharTime = secondsToBeats(noteCharTimes[startChar]);
        if (typeof beatFromCharTime === 'number') {
          return beatFromCharTime;
        }
      }
      return note.startBeat;
    });
  }, [secondsToBeats, notes, noteCharTimes]);

  // Compute total beats including any adjusted notes
  const renderedTotalBeats = useMemo(() => {
    let maxEnd = totalBeats;
    notes.forEach((note, index) => {
      const adjustedStart = noteStartBeats[index] ?? note.startBeat;
      const endBeat = adjustedStart + note.durationBeats;
      if (endBeat > maxEnd) {
        maxEnd = endBeat;
      }
    });
    return maxEnd;
  }, [notes, noteStartBeats, totalBeats]);

  // Find the note index for a playback event
  const findNoteIndexForEvent = useCallback(
    (event: NotePlaybackEvent): number | null => {
      const isChordEvent = event.midiPitches.length > 1;

      if (!isChordEvent && typeof event.startChar === 'number') {
        const match = noteIndexByStartChar.get(event.startChar);
        if (typeof match === 'number') {
          return match;
        }
      }

      const eventBeat = secondsToBeats(event.timeSeconds);

      if (event.midiPitches.length > 0) {
        const midiSet = new Set(event.midiPitches);
        const chordMaxPitch = event.midiPitches.reduce(
          (max, value) =>
            typeof value === 'number' ? Math.max(max, value) : max,
          Number.NEGATIVE_INFINITY
        );
        let bestIndex: number | null = null;
        let smallestDelta = Number.POSITIVE_INFINITY;
        let bestPitch = -Infinity;
        let bestPitchPriority = -1;

        notes.forEach((note, index) => {
          if (!midiSet.has(note.pitch)) {
            return;
          }
          const adjustedStart = noteStartBeats[index] ?? note.startBeat;
          const delta =
            typeof eventBeat === 'number'
              ? Math.abs(adjustedStart - eventBeat)
              : Number.POSITIVE_INFINITY;
          const pitchPriority = note.pitch === chordMaxPitch ? 1 : 0;
          const improvesPitchPriority = pitchPriority > bestPitchPriority;
          const matchesPitchPriority = pitchPriority === bestPitchPriority;
          const isClearlyCloser =
            delta + CHORD_ALIGNMENT_TOLERANCE_BEATS < smallestDelta;
          const isSimilarTiming =
            Math.abs(delta - smallestDelta) <= CHORD_ALIGNMENT_TOLERANCE_BEATS;
          if (
            improvesPitchPriority ||
            (matchesPitchPriority &&
              (isClearlyCloser ||
                (isSimilarTiming &&
                  (bestIndex === null || note.pitch > bestPitch))))
          ) {
            bestPitchPriority = pitchPriority;
            smallestDelta = delta;
            bestIndex = index;
            bestPitch = note.pitch;
          }
        });

        if (bestIndex !== null) {
          return bestIndex;
        }
      }

      return null;
    },
    [secondsToBeats, noteIndexByStartChar, notes, noteStartBeats]
  );

  // Get the current display beat, accounting for animation
  const getDisplayBeat = useCallback(() => {
    const now = getTimestamp();
    if (isPlayingRef.current) {
      const elapsedSeconds = (now - syncedTimestampRef.current) / 1000;
      const elapsedBeats = elapsedSeconds / effectiveSecondsPerBeat;
      return syncedBeatRef.current + elapsedBeats;
    }
    return syncedBeatRef.current;
  }, [effectiveSecondsPerBeat]);

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

    // Pixels per beat - this is now the primary unit
    const pixelsPerBeat =
      innerHeight > 0 && BEATS_PER_VERTICAL_SPAN > 0
        ? innerHeight / BEATS_PER_VERTICAL_SPAN
        : FALLBACK_PIXELS_PER_BEAT;

    const noteHeight = Math.min(
      Math.max(2, innerWidth * NOTE_THICKNESS_RATIO),
      playableHeight
    );

    const pitchRange = maxPitch - minPitch;

    // Draw pitch lines
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

    // Get current beat position
    const currentBeat = (() => {
      const beat = getDisplayBeat();
      return renderedTotalBeats > 0 ? Math.min(beat, renderedTotalBeats) : beat;
    })();

    // Draw instrument (otamatone neck)
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

    // Draw markers (beat/measure lines)
    const drawMarkers = (
      markers: number[],
      options: {
        width: number;
        color: string;
        filter?: (value: number) => boolean;
        onFirstVisible?: (info: { position: number; centerX: number }) => void;
      }
    ) => {
      if (!markers.length) {
        return;
      }
      const markerWidth = Math.max(0.5, options.width);
      ctx.save();
      ctx.beginPath();
      ctx.rect(innerX, innerY, width - innerX, innerHeight);
      ctx.clip();
      ctx.fillStyle = options.color;
      let firstVisible: { position: number; centerX: number } | null = null;
      markers.forEach((markerBeat) => {
        if (typeof markerBeat !== 'number' || !Number.isFinite(markerBeat)) {
          return;
        }
        if (options.filter && !options.filter(markerBeat)) {
          return;
        }
        const centerX = playheadX + (markerBeat - currentBeat) * pixelsPerBeat;
        if (centerX + markerWidth < innerX || centerX - markerWidth > width) {
          return;
        }
        ctx.fillRect(
          centerX - markerWidth / 2,
          innerY,
          markerWidth,
          innerHeight
        );
        if (!firstVisible) {
          firstVisible = { position: markerBeat, centerX };
        }
      });
      if (firstVisible && options.onFirstVisible) {
        options.onFirstVisible(firstVisible);
      }
      ctx.restore();
    };

    // Skip beats that are near measure boundaries
    const measureNearBeatEpsilon = 0.01; // in beats
    const skipBeatsNearMeasures = (beat: number) => {
      return measureBoundaries.some(
        (boundary) => Math.abs(boundary - beat) < measureNearBeatEpsilon
      );
    };

    const thinLineWidth = Math.max(1, widthScale);
    drawMarkers(beatBoundaries, {
      width: thinLineWidth,
      color: 'rgba(255, 255, 255, 0.12)',
      filter: (value) => !skipBeatsNearMeasures(value),
    });

    const barWidth = Math.max(2, 4 * widthScale);
    drawMarkers(measureBoundaries, {
      width: barWidth,
      color: 'rgba(255, 255, 255, 0.35)',
      onFirstVisible: ({ position, centerX }) => {
        const summaryObject = {
          boundaryBeat: Number(position.toFixed(4)),
          canvasX: Number(centerX.toFixed(2)),
          currentBeat: Number(currentBeat.toFixed(3)),
          pixelsPerBeat: Number(pixelsPerBeat.toFixed(2)),
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
      },
    });

    const activeNoteIndex = activeNoteIndexRef.current;

    // Draw notes
    ctx.save();
    ctx.beginPath();
    ctx.rect(innerX, 0, width - innerX, height);
    ctx.clip();

    notes.forEach((note, index) => {
      const adjustedStartBeat = noteStartBeats[index] ?? note.startBeat;
      const beatDiff = adjustedStartBeat - currentBeat;
      const durationBeats = Math.max(note.durationBeats, 0);
      const x = playheadX + beatDiff * pixelsPerBeat;
      const noteWidth = durationBeats * pixelsPerBeat;
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
      } else if (beatDiff > 0) {
        color = '#4a9eff';
      } else if (beatDiff + durationBeats > 0) {
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
    getDisplayBeat,
    notes,
    noteStartBeats,
    renderedTotalBeats,
    minPitch,
    maxPitch,
    minFrequency,
    maxFrequency,
    measureBoundaries,
    beatBoundaries,
  ]);

  useEffect(() => {
    console.debug('[OtamatoneRoll] measure boundaries updated (beats)', {
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

  // Sync current time (in seconds) to current beat
  useEffect(() => {
    const beat = secondsToBeats(currentTime);
    if (typeof beat === 'number') {
      syncedBeatRef.current = beat;
    }
    syncedTimestampRef.current = getTimestamp();
    if (!isPlayingRef.current) {
      renderFrame();
    }
  }, [secondsToBeats, currentTime, renderFrame]);

  // Handle play/pause state changes
  useEffect(() => {
    const now = getTimestamp();
    if (isPlayingRef.current && !isPlaying) {
      // Stopping: update synced beat to current animated position
      const elapsedSeconds = (now - syncedTimestampRef.current) / 1000;
      const elapsedBeats = elapsedSeconds / effectiveSecondsPerBeat;
      syncedBeatRef.current += elapsedBeats;
    }
    syncedTimestampRef.current = now;
    isPlayingRef.current = isPlaying;
    if (!isPlaying) {
      renderFrame();
    }
  }, [isPlaying, renderFrame, effectiveSecondsPerBeat]);

  // Handle active note events
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

    const beat = secondsToBeats(activeNoteEvent.timeSeconds);
    if (typeof beat === 'number') {
      syncedBeatRef.current = beat;
    }
    syncedTimestampRef.current = getTimestamp();

    renderFrame();
  }, [activeNoteEvent, secondsToBeats, findNoteIndexForEvent, renderFrame]);

  // Reset active note when notes change
  useEffect(() => {
    activeNoteIndexRef.current = null;
    latestEventIdRef.current = 0;
  }, [notes]);

  return <canvas ref={canvasRef} className="otamatone-roll-canvas" />;
};
