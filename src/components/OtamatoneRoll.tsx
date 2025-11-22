import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useOtamatoneRollNotes } from '../hooks/useOtamatoneRollNotes';
import {
  NoteCharTimeMap,
  NotePlaybackEvent,
  NoteTimeline,
} from '../types/music';

interface OtamatoneRollProps {
  notation: string;
  currentTime?: number;
  isPlaying?: boolean;
  activeNoteEvent?: NotePlaybackEvent | null;
  noteCharTimes?: NoteCharTimeMap;
  noteTimeline?: NoteTimeline | null;
}

const PIXELS_PER_SECOND = 100;
const NOTE_HEIGHT = 6;
const PITCH_PADDING = 1;
const MIN_PITCH = 24;
const MAX_PITCH = 108;

export const OtamatoneRoll: React.FC<OtamatoneRollProps> = ({
  notation,
  currentTime = 0,
  isPlaying = false,
  activeNoteEvent = null,
  noteCharTimes,
  noteTimeline,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const { notes, totalDuration } = useOtamatoneRollNotes(
    notation,
    noteTimeline
  );
  const syncedTimeRef = useRef(currentTime);
  const syncedTimestampRef = useRef(
    typeof performance !== 'undefined' ? performance.now() : Date.now()
  );
  const isPlayingRef = useRef(isPlaying);
  const activeNoteIndexRef = useRef<number | null>(null);
  const latestEventIdRef = useRef(0);

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
        return noteCharTimes[startChar];
      }
      return note.startTime;
    });
  }, [notes, noteCharTimes]);

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

      if (event.midiPitches.length > 0) {
        const midiSet = new Set(event.midiPitches);
        let bestIndex: number | null = null;
        let smallestDelta = Number.POSITIVE_INFINITY;

        notes.forEach((note, index) => {
          if (!midiSet.has(note.pitch)) {
            return;
          }
          const adjustedStart = noteStartTimes[index] ?? note.startTime;
          const delta = Math.abs(adjustedStart - event.timeSeconds);
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
    [noteIndexByStartChar, notes, noteStartTimes]
  );

  const getDisplayTime = useCallback(() => {
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (isPlayingRef.current) {
      const elapsed = (now - syncedTimestampRef.current) / 1000;
      return syncedTimeRef.current + elapsed;
    }
    return syncedTimeRef.current;
  }, []);

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

    const playheadX = width * 0.2;

    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    const pitchRange = MAX_PITCH - MIN_PITCH;
    const pitchHeight = NOTE_HEIGHT + PITCH_PADDING;

    ctx.strokeStyle = '#2a2a2a';
    ctx.lineWidth = 1;
    for (let i = 0; i <= pitchRange; i++) {
      const y = height - i * pitchHeight - pitchHeight / 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const effectiveTime = (() => {
      const time = getDisplayTime();
      return renderedTotalDuration > 0
        ? Math.min(time, renderedTotalDuration)
        : time;
    })();

    let notesDrawn = 0;
    const activeNoteIndex = activeNoteIndexRef.current;

    notes.forEach((note, index) => {
      const adjustedStart = noteStartTimes[index] ?? note.startTime;
      const timeDiff = adjustedStart - effectiveTime;
      const x = playheadX + timeDiff * PIXELS_PER_SECOND;
      const noteWidth = note.duration * PIXELS_PER_SECOND;
      const pitchIndex = note.pitch - MIN_PITCH;
      const y = height - pitchIndex * pitchHeight - pitchHeight;

      if (x + noteWidth < 0 || x > width) {
        return;
      }

      if (note.pitch < MIN_PITCH || note.pitch > MAX_PITCH) {
        return;
      }

      notesDrawn++;

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

      ctx.fillStyle = color;
      ctx.fillRect(x, y, noteWidth, NOTE_HEIGHT);

      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, noteWidth, NOTE_HEIGHT);
    });

    ctx.strokeStyle = '#ff4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '12px monospace';
    ctx.fillText(
      `Time: ${effectiveTime.toFixed(2)}s / ${renderedTotalDuration.toFixed(2)}s | Notes: ${notes.length} | Drawn: ${notesDrawn}`,
      10,
      20
    );
  }, [getDisplayTime, notes, noteStartTimes, renderedTotalDuration]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

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
    syncedTimeRef.current = currentTime;
    syncedTimestampRef.current =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!isPlayingRef.current) {
      renderFrame();
    }
  }, [currentTime, renderFrame]);

  useEffect(() => {
    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (isPlayingRef.current && !isPlaying) {
      syncedTimeRef.current += (now - syncedTimestampRef.current) / 1000;
    }
    syncedTimestampRef.current = now;
    isPlayingRef.current = isPlaying;
    if (!isPlaying) {
      renderFrame();
    }
  }, [isPlaying, renderFrame]);

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

    syncedTimeRef.current = activeNoteEvent.timeSeconds;
    syncedTimestampRef.current =
      typeof performance !== 'undefined' ? performance.now() : Date.now();

    renderFrame();
  }, [activeNoteEvent, findNoteIndexForEvent, renderFrame]);

  useEffect(() => {
    activeNoteIndexRef.current = null;
    latestEventIdRef.current = 0;
  }, [notes]);

  return <canvas ref={canvasRef} className="otamatone-roll-canvas" />;
};
