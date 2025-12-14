import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { DEFAULT_SECONDS_PER_SUBDIVISION } from '../hooks/useOtamatoneRollNotes';
import {
  DEFAULT_HIGHEST_MIDI,
  DEFAULT_LOWEST_MIDI,
  frequencyToMidi,
  midiToFrequency,
  stemPosition,
  midiToNoteName,
} from '../utils/frequency';
import { NotePlaybackEvent, getBeatBoundaries } from '../types/music';

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
const FALLBACK_PIXELS_PER_SUBDIVISION = 50;
const NOTE_THICKNESS_RATIO = 0.7;
const CHORD_ALIGNMENT_TOLERANCE_SUBDIVISIONS = 0.01; // in subdivisions

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

/**
 * Canvas-based piano roll visualization styled like an otamatone.
 * Displays notes as horizontal bars scrolling from right to left,
 * with a vertical "neck" representing the otamatone's stem.
 *
 * Features:
 * - Real-time animation synced to audio playback
 * - Beat and measure grid lines
 * - Active note highlighting
 * - Pitch labels on the left side
 * - Frequency range determined by store settings
 *
 * All state is read from the Zustand store:
 * - noteTimeline: The notes to display
 * - currentTime/isPlaying: Playback position
 * - lowestNoteHz/highestNoteHz: Vertical display range
 *
 * @example
 * <OtamatoneRoll />
 */
export const OtamatoneRoll: React.FC = () => {
  // Read state from store
  const currentTime = useAppStore((state) => state.currentTime);
  const isPlaying = useAppStore((state) => state.isPlaying);
  const activeNoteEvent = useAppStore((state) => state.activeNoteEvent);
  const currentSecondsPerSubdivision = useAppStore(
    (state) => state.currentSecondsPerSubdivision
  );
  const noteTimeline = useAppStore((state) => state.noteTimeline);
  // Subscribe to frequency values to trigger re-render on change
  const lowestNoteHz = useAppStore((state) => state.lowestNoteHz);
  const highestNoteHz = useAppStore((state) => state.highestNoteHz);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);

  // Extract timeline data from the passed noteTimeline prop (single source of truth)
  const notes = useMemo(() => noteTimeline?.notes ?? [], [noteTimeline?.notes]);
  const totalSubdivisions = noteTimeline?.totalSubdivisions ?? 0;
  const subdivisionsPerBeat = noteTimeline?.subdivisionsPerBeat ?? 1;
  const measureBoundaries = useMemo(
    () => noteTimeline?.measureBoundaries ?? [],
    [noteTimeline?.measureBoundaries]
  );
  const beatBoundaries = useMemo(
    () => getBeatBoundaries(totalSubdivisions, subdivisionsPerBeat),
    [totalSubdivisions, subdivisionsPerBeat]
  );

  // Use current playback tempo from store.
  // IMPORTANT: This value changes when warp/speed changes. It's the ACTUAL
  // playback tempo, not the original tempo from the ABC notation.
  // abcjs reports real-time positions (affected by warp), so we need the
  // warped tempo to correctly convert back to musical subdivisions.
  const effectiveSecondsPerSubdivision =
    typeof currentSecondsPerSubdivision === 'number' &&
    currentSecondsPerSubdivision > 0
      ? currentSecondsPerSubdivision
      : DEFAULT_SECONDS_PER_SUBDIVISION;

  // Convert real-time seconds to subdivisions using current (warped) tempo.
  // This is used to sync playback position from abcjs (which reports in real-time)
  // to musical position (subdivisions) which the timeline uses.
  const secondsToSubdivisions = useCallback(
    (seconds?: number): number | undefined => {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
        return undefined;
      }
      return seconds / effectiveSecondsPerSubdivision;
    },
    [effectiveSecondsPerSubdivision]
  );

  // Current position in subdivisions (synced from playback)
  const syncedSubdivisionRef = useRef(secondsToSubdivisions(currentTime) ?? 0);
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

  // Use the note's startSubdivision directly - it's already invariant to tempo changes.
  // Note: noteCharTimes stores seconds at original tempo (for cursor sync during playback),
  // but we don't use it here because note positions are already correct in subdivisions.
  const noteStartSubdivisions = useMemo(() => {
    return notes.map((note) => note.startSubdivision);
  }, [notes]);

  // Compute total subdivisions including any adjusted notes
  const renderedTotalSubdivisions = useMemo(() => {
    let maxEnd = totalSubdivisions;
    notes.forEach((note, index) => {
      const adjustedStart =
        noteStartSubdivisions[index] ?? note.startSubdivision;
      const endSubdivision = adjustedStart + note.durationSubdivisions;
      if (endSubdivision > maxEnd) {
        maxEnd = endSubdivision;
      }
    });
    return maxEnd;
  }, [notes, noteStartSubdivisions, totalSubdivisions]);

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

      const eventSubdivision = secondsToSubdivisions(event.timeSeconds);

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
          const adjustedStart =
            noteStartSubdivisions[index] ?? note.startSubdivision;
          const delta =
            typeof eventSubdivision === 'number'
              ? Math.abs(adjustedStart - eventSubdivision)
              : Number.POSITIVE_INFINITY;
          const pitchPriority = note.pitch === chordMaxPitch ? 1 : 0;
          const improvesPitchPriority = pitchPriority > bestPitchPriority;
          const matchesPitchPriority = pitchPriority === bestPitchPriority;
          const isClearlyCloser =
            delta + CHORD_ALIGNMENT_TOLERANCE_SUBDIVISIONS < smallestDelta;
          const isSimilarTiming =
            Math.abs(delta - smallestDelta) <=
            CHORD_ALIGNMENT_TOLERANCE_SUBDIVISIONS;
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
    [secondsToSubdivisions, noteIndexByStartChar, notes, noteStartSubdivisions]
  );

  // Get the current display subdivision, accounting for animation
  const getDisplaySubdivision = useCallback(() => {
    const now = getTimestamp();
    if (isPlayingRef.current) {
      const elapsedSeconds = (now - syncedTimestampRef.current) / 1000;
      const elapsedSubdivisions =
        elapsedSeconds / effectiveSecondsPerSubdivision;
      return syncedSubdivisionRef.current + elapsedSubdivisions;
    }
    return syncedSubdivisionRef.current;
  }, [effectiveSecondsPerSubdivision]);

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

    // Pixels per subdivision - derived from beats per vertical span
    const subdivisionsPerVerticalSpan =
      BEATS_PER_VERTICAL_SPAN * subdivisionsPerBeat;
    const pixelsPerSubdivision =
      innerHeight > 0 && subdivisionsPerVerticalSpan > 0
        ? innerHeight / subdivisionsPerVerticalSpan
        : FALLBACK_PIXELS_PER_SUBDIVISION;

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

    // Get current subdivision position
    const currentSubdivision = (() => {
      const subdivision = getDisplaySubdivision();
      return renderedTotalSubdivisions > 0
        ? Math.min(subdivision, renderedTotalSubdivisions)
        : subdivision;
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

    // Draw markers (subdivision/measure lines)
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
      markers.forEach((markerSubdivision) => {
        if (
          typeof markerSubdivision !== 'number' ||
          !Number.isFinite(markerSubdivision)
        ) {
          return;
        }
        if (options.filter && !options.filter(markerSubdivision)) {
          return;
        }
        const centerX =
          playheadX +
          (markerSubdivision - currentSubdivision) * pixelsPerSubdivision;
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
          firstVisible = { position: markerSubdivision, centerX };
        }
      });
      if (firstVisible && options.onFirstVisible) {
        options.onFirstVisible(firstVisible);
      }
      ctx.restore();
    };

    // Skip beats that are near measure boundaries
    const measureNearBeatEpsilon = 0.01; // in subdivisions
    const skipBeatsNearMeasures = (beatPosition: number) => {
      return measureBoundaries.some(
        (boundary) => Math.abs(boundary - beatPosition) < measureNearBeatEpsilon
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
          boundarySubdivision: Number(position.toFixed(4)),
          canvasX: Number(centerX.toFixed(2)),
          currentSubdivision: Number(currentSubdivision.toFixed(3)),
          pixelsPerSubdivision: Number(pixelsPerSubdivision.toFixed(2)),
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
      const adjustedStartSubdivision =
        noteStartSubdivisions[index] ?? note.startSubdivision;
      const subdivisionDiff = adjustedStartSubdivision - currentSubdivision;
      const durationSubdivisions = Math.max(note.durationSubdivisions, 0);
      const x = playheadX + subdivisionDiff * pixelsPerSubdivision;
      const noteWidth = durationSubdivisions * pixelsPerSubdivision;
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
      } else if (subdivisionDiff > 0) {
        color = '#4a9eff';
      } else if (subdivisionDiff + durationSubdivisions > 0) {
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
    getDisplaySubdivision,
    notes,
    noteStartSubdivisions,
    renderedTotalSubdivisions,
    minPitch,
    maxPitch,
    minFrequency,
    maxFrequency,
    measureBoundaries,
    beatBoundaries,
    subdivisionsPerBeat,
  ]);

  useEffect(() => {
    console.debug('[OtamatoneRoll] measure boundaries updated (subdivisions)', {
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

  // Sync current time (in seconds) to current subdivision
  useEffect(() => {
    const subdivision = secondsToSubdivisions(currentTime);
    if (typeof subdivision === 'number') {
      syncedSubdivisionRef.current = subdivision;
    }
    syncedTimestampRef.current = getTimestamp();
    if (!isPlayingRef.current) {
      renderFrame();
    }
  }, [secondsToSubdivisions, currentTime, renderFrame]);

  // Handle play/pause state changes
  useEffect(() => {
    const now = getTimestamp();
    if (isPlayingRef.current && !isPlaying) {
      // Stopping: update synced subdivision to current animated position
      const elapsedSeconds = (now - syncedTimestampRef.current) / 1000;
      const elapsedSubdivisions =
        elapsedSeconds / effectiveSecondsPerSubdivision;
      syncedSubdivisionRef.current += elapsedSubdivisions;
    }
    syncedTimestampRef.current = now;
    isPlayingRef.current = isPlaying;
    if (!isPlaying) {
      renderFrame();
    }
  }, [isPlaying, renderFrame, effectiveSecondsPerSubdivision]);

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

    const subdivision = secondsToSubdivisions(activeNoteEvent.timeSeconds);
    if (typeof subdivision === 'number') {
      syncedSubdivisionRef.current = subdivision;
    }
    syncedTimestampRef.current = getTimestamp();

    renderFrame();
  }, [
    activeNoteEvent,
    secondsToSubdivisions,
    findNoteIndexForEvent,
    renderFrame,
  ]);

  // Reset active note when notes change
  useEffect(() => {
    activeNoteIndexRef.current = null;
    latestEventIdRef.current = 0;
  }, [notes]);

  return <canvas ref={canvasRef} className="otamatone-roll-canvas" />;
};
