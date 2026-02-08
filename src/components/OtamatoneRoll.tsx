import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { getBeatBoundaries } from '../types/music';

// ── Layout constants ──────────────────────────────────────────────────────────

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

/** Maximum cents deviation for "in tune" (green). Beyond this, shifts toward red. */
const IN_TUNE_CENTS = 50;

// ── Helpers ───────────────────────────────────────────────────────────────────

const clampMidiPitch = (pitch: number): number => {
  if (!Number.isFinite(pitch)) return 0;
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

/** Layout geometry computed from container dimensions */
interface LayoutGeometry {
  width: number;
  height: number;
  playheadX: number;
  playheadOuterX: number;
  playheadOuterWidth: number;
  innerX: number;
  innerY: number;
  innerWidth: number;
  innerHeight: number;
  innerRadius: number;
  playableTop: number;
  playableBottom: number;
  playableHeight: number;
  pixelsPerSubdivision: number;
  noteHeight: number;
  widthScale: number;
  labelX: number;
}

/**
 * Compute all layout geometry from container width/height and beat grouping.
 *
 * @param width - Container width in CSS pixels
 * @param height - Container height in CSS pixels
 * @param subdivisionsPerBeat - Beat grouping (1 for simple, 3 for compound)
 * @returns All layout dimensions needed for rendering
 */
function computeLayout(
  width: number,
  height: number,
  subdivisionsPerBeat: number
): LayoutGeometry {
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
  const minPlayheadCenter =
    NOTE_LABEL_MARGIN + NOTE_LABEL_GAP + playheadOuterWidth / 2;
  const playheadX = Math.max(width * MIN_PLAYHEAD_FRACTION, minPlayheadCenter);
  const playheadOuterX = playheadX - playheadOuterWidth / 2;

  const innerWidth = Math.max(1, playheadOuterWidth - playheadInnerPadding * 2);
  const innerX = playheadOuterX + playheadInnerPadding;
  const innerY = PLAYHEAD_VERTICAL_INSET;
  const innerHeight = Math.max(
    height - PLAYHEAD_VERTICAL_INSET * 2,
    Math.max(4, BASE_PLAYHEAD_RADIUS * widthScale)
  );
  const innerRadius = Math.max(2, (BASE_PLAYHEAD_RADIUS - 4) * widthScale);
  const playableTop = innerY + innerHeight * PLAYABLE_EDGE_RATIO;
  const playableBottom = innerY + innerHeight * (1 - PLAYABLE_EDGE_RATIO);
  const playableHeight = Math.max(1, playableBottom - playableTop);

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

  const labelX = Math.max(NOTE_LABEL_MARGIN, playheadOuterX - NOTE_LABEL_GAP);

  return {
    width,
    height,
    playheadX,
    playheadOuterX,
    playheadOuterWidth,
    innerX,
    innerY,
    innerWidth,
    innerHeight,
    innerRadius,
    playableTop,
    playableBottom,
    playableHeight,
    pixelsPerSubdivision,
    noteHeight,
    widthScale,
    labelX,
  };
}

/**
 * DOM-based piano roll visualization styled like an otamatone.
 * Displays notes as horizontal bars scrolling from right to left,
 * with a vertical "neck" representing the otamatone's stem.
 *
 * Features:
 * - GPU-accelerated scrolling via CSS transform on a single container div
 * - Beat and measure grid lines as DOM elements
 * - Active note highlighting via CSS class toggling
 * - Pitch labels on the left side
 * - Frequency range determined by store settings
 * - HTML-overlaid pitch detection ball (when microphone is active)
 *
 * The entire scrollable content (notes + grid lines) is pre-laid-out inside
 * a single container div. Scrolling is achieved by applying a CSS
 * `transform: translateX(...)` to this container on each animation frame.
 * Notes disappear behind the left edge of the otamatone neck via z-index
 * layering: a cover div with the background color sits above the notes.
 *
 * All state is read from the Zustand store.
 *
 * @example
 * <OtamatoneRoll />
 */
export const OtamatoneRoll: React.FC = () => {
  // ── Store state ───────────────────────────────────────────────────────────

  const currentTime = useAppStore((state) => state.currentTime);
  const isPlaying = useAppStore((state) => state.isPlaying);
  const currentSecondsPerSubdivision = useAppStore(
    (state) => state.currentSecondsPerSubdivision
  );
  const noteTimeline = useAppStore((state) => state.noteTimeline);
  const lowestNoteHz = useAppStore((state) => state.lowestNoteHz);
  const highestNoteHz = useAppStore((state) => state.highestNoteHz);
  const detectedPitch = useAppStore((state) => state.detectedPitch);
  const isMicrophoneActive = useAppStore((state) => state.isMicrophoneActive);

  // ── Refs ──────────────────────────────────────────────────────────────────

  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pitchBallRef = useRef<HTMLDivElement>(null);
  const noteElementsRef = useRef<(HTMLDivElement | null)[]>([]);

  // Animation state refs (avoid re-renders)
  const syncedSubdivisionRef = useRef(0);
  const isPlayingRef = useRef(isPlaying);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const prevSecondsPerSubdivisionRef = useRef(0);

  // Web Animations API refs
  const scrollAnimationRef = useRef<Animation | null>(null);
  /** Subdivision at which the current Web Animation started */
  const animStartSubRef = useRef(0);
  /** Seconds-per-subdivision when the current Web Animation was created */
  const animTempoRef = useRef(0);

  // Track which notes currently have the 'playing' / 'played' classes
  const activeNoteIndicesRef = useRef<Set<number>>(new Set());
  const playedNoteIndicesRef = useRef<Set<number>>(new Set());

  // ── Container dimensions (triggers re-render for layout) ──────────────────

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // ── Derived data ──────────────────────────────────────────────────────────

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

  const effectiveSecondsPerSubdivision =
    typeof currentSecondsPerSubdivision === 'number' &&
    currentSecondsPerSubdivision > 0
      ? currentSecondsPerSubdivision
      : DEFAULT_SECONDS_PER_SUBDIVISION;

  const secondsToSubdivisions = useCallback(
    (seconds?: number): number | undefined => {
      if (typeof seconds !== 'number' || !Number.isFinite(seconds))
        return undefined;
      return seconds / effectiveSecondsPerSubdivision;
    },
    [effectiveSecondsPerSubdivision]
  );

  // Frequency range
  const minFrequency = useMemo(() => {
    if (
      typeof lowestNoteHz === 'number' &&
      Number.isFinite(lowestNoteHz) &&
      lowestNoteHz > 0
    )
      return lowestNoteHz;
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
    )
      return Math.max(highestNoteHz, minFrequency + 1);
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

  const noteStartSubdivisions = useMemo(
    () => notes.map((note) => note.startSubdivision),
    [notes]
  );

  const renderedTotalSubdivisions = useMemo(() => {
    let maxEnd = totalSubdivisions;
    notes.forEach((note, index) => {
      const adjustedStart =
        noteStartSubdivisions[index] ?? note.startSubdivision;
      const endSubdivision = adjustedStart + note.durationSubdivisions;
      if (endSubdivision > maxEnd) maxEnd = endSubdivision;
    });
    return maxEnd;
  }, [notes, noteStartSubdivisions, totalSubdivisions]);

  // ── Layout geometry ───────────────────────────────────────────────────────

  const layout = useMemo(
    () =>
      computeLayout(
        containerSize.width,
        containerSize.height,
        subdivisionsPerBeat
      ),
    [containerSize.width, containerSize.height, subdivisionsPerBeat]
  );

  // ── Get current subdivision from the Web Animation or synced ref ──────────

  /**
   * Returns the current subdivision position.
   * During playback, derived from the running Web Animation's elapsed time.
   * When paused, returns the last captured position.
   */
  const getCurrentSubdivision = useCallback(() => {
    const anim = scrollAnimationRef.current;
    if (anim && anim.playState === 'running' && animTempoRef.current > 0) {
      const elapsedMs =
        typeof anim.currentTime === 'number' ? anim.currentTime : 0;
      const elapsedSub = elapsedMs / 1000 / animTempoRef.current;
      const sub = animStartSubRef.current + elapsedSub;
      return renderedTotalSubdivisions > 0
        ? Math.min(sub, renderedTotalSubdivisions)
        : sub;
    }
    return syncedSubdivisionRef.current;
  }, [renderedTotalSubdivisions]);

  // ── Compute pitch lines & labels (static, don't scroll) ──────────────────

  const pitchRange = maxPitch - minPitch;

  const pitchLines = useMemo(() => {
    const lines: { y: number; noteName: string }[] = [];
    for (let i = 0; i <= pitchRange; i++) {
      const pitchValue = minPitch + i;
      const freq = midiToFrequency(pitchValue);
      const normalized = stemPosition(minFrequency, maxFrequency, freq);
      const y = Math.min(
        Math.max(layout.playableTop + normalized * layout.playableHeight, 0),
        layout.height
      );
      const noteName = midiToNoteName(pitchValue);
      lines.push({ y, noteName });
    }
    return lines;
  }, [
    pitchRange,
    minPitch,
    minFrequency,
    maxFrequency,
    layout.playableTop,
    layout.playableHeight,
    layout.height,
  ]);

  // ── Compute note element styles (pre-positioned in container-local coords) ─

  const noteStyles = useMemo(() => {
    return notes.map((note, index) => {
      const adjustedStart =
        noteStartSubdivisions[index] ?? note.startSubdivision;
      const durationSubdivisions = Math.max(note.durationSubdivisions, 0);
      // Position relative to the scrollable container's origin (subdivision 0)
      const left = adjustedStart * layout.pixelsPerSubdivision;
      const noteWidth = durationSubdivisions * layout.pixelsPerSubdivision;
      const noteFrequency = midiToFrequency(note.pitch);
      const normalized = stemPosition(
        minFrequency,
        maxFrequency,
        noteFrequency
      );
      const centerY = layout.playableTop + normalized * layout.playableHeight;
      const top = Math.min(
        Math.max(centerY - layout.noteHeight / 2, layout.playableTop),
        Math.min(
          layout.playableBottom - layout.noteHeight / 2,
          layout.height - layout.noteHeight
        )
      );

      // Skip notes outside pitch range
      if (note.pitch < minPitch || note.pitch > maxPitch) return null;

      return {
        left,
        top,
        width: noteWidth,
        height: layout.noteHeight,
        borderRadius: layout.noteHeight / 2,
        startSubdivision: adjustedStart,
        durationSubdivisions,
      };
    });
  }, [
    notes,
    noteStartSubdivisions,
    layout.pixelsPerSubdivision,
    layout.playableTop,
    layout.playableBottom,
    layout.playableHeight,
    layout.noteHeight,
    layout.height,
    minFrequency,
    maxFrequency,
    minPitch,
    maxPitch,
  ]);

  // ── Compute grid lines (in container-local coords) ────────────────────────

  const measureNearBeatEpsilon = 0.01;
  const skipBeatsNearMeasures = useCallback(
    (beatPosition: number) =>
      measureBoundaries.some(
        (boundary) => Math.abs(boundary - beatPosition) < measureNearBeatEpsilon
      ),
    [measureBoundaries]
  );

  const beatLineStyles = useMemo(() => {
    const lineWidth = Math.max(1, layout.widthScale);
    return beatBoundaries
      .filter((b) => !skipBeatsNearMeasures(b))
      .map((b) => ({
        left: b * layout.pixelsPerSubdivision - lineWidth / 2,
        width: lineWidth,
        top: layout.innerY,
        height: layout.innerHeight,
      }));
  }, [
    beatBoundaries,
    skipBeatsNearMeasures,
    layout.pixelsPerSubdivision,
    layout.widthScale,
    layout.innerY,
    layout.innerHeight,
  ]);

  const measureLineStyles = useMemo(() => {
    const lineWidth = Math.max(2, 4 * layout.widthScale);
    return measureBoundaries.map((b) => ({
      left: b * layout.pixelsPerSubdivision - lineWidth / 2,
      width: lineWidth,
      top: layout.innerY,
      height: layout.innerHeight,
    }));
  }, [
    measureBoundaries,
    layout.pixelsPerSubdivision,
    layout.widthScale,
    layout.innerY,
    layout.innerHeight,
  ]);

  // ── ResizeObserver ────────────────────────────────────────────────────────

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize((prev) => {
          if (prev.width === width && prev.height === height) return prev;
          return { width, height };
        });
      }
    });

    observer.observe(wrapper);
    // Trigger initial measurement
    const rect = wrapper.getBoundingClientRect();
    setContainerSize({ width: rect.width, height: rect.height });

    return () => observer.disconnect();
  }, []);

  // ── Scroll animation controls (Web Animations API) ────────────────────────

  /**
   * Set the container's transform to a static position (no animation).
   */
  const setStaticTransform = useCallback(
    (subdivision: number) => {
      const el = containerRef.current;
      if (!el) return;
      const clamped =
        renderedTotalSubdivisions > 0
          ? Math.min(subdivision, renderedTotalSubdivisions)
          : subdivision;
      el.style.transform = `translateX(${-clamped * layout.pixelsPerSubdivision}px)`;
    },
    [layout.pixelsPerSubdivision, renderedTotalSubdivisions]
  );

  /**
   * Start a Web Animation that scrolls the container from `fromSubdivision`
   * to the end of the piece at the current tempo. The browser's compositor
   * handles the interpolation natively on the GPU — no JS per frame.
   */
  const startScrollAnimation = useCallback(
    (fromSubdivision: number) => {
      const el = containerRef.current;
      if (!el) return;

      // Cancel any existing animation
      if (scrollAnimationRef.current) {
        scrollAnimationRef.current.cancel();
        scrollAnimationRef.current = null;
      }

      const clampedFrom =
        renderedTotalSubdivisions > 0
          ? Math.min(fromSubdivision, renderedTotalSubdivisions)
          : fromSubdivision;
      const endSub = renderedTotalSubdivisions;
      const remainingSub = endSub - clampedFrom;

      if (remainingSub <= 0) {
        setStaticTransform(clampedFrom);
        return;
      }

      const startX = -clampedFrom * layout.pixelsPerSubdivision;
      const endX = -endSub * layout.pixelsPerSubdivision;
      const durationMs = remainingSub * effectiveSecondsPerSubdivision * 1000;

      animStartSubRef.current = clampedFrom;
      animTempoRef.current = effectiveSecondsPerSubdivision;

      const animation = el.animate(
        [
          { transform: `translateX(${startX}px)` },
          { transform: `translateX(${endX}px)` },
        ],
        {
          duration: durationMs,
          easing: 'linear',
          fill: 'forwards',
        }
      );

      scrollAnimationRef.current = animation;
    },
    [
      layout.pixelsPerSubdivision,
      renderedTotalSubdivisions,
      effectiveSecondsPerSubdivision,
      setStaticTransform,
    ]
  );

  /**
   * Stop the scroll animation, capture the current position,
   * and apply it as a static transform.
   *
   * @returns The subdivision position at the moment the animation was stopped
   */
  const stopScrollAnimation = useCallback(() => {
    const sub = getCurrentSubdivision();
    if (scrollAnimationRef.current) {
      scrollAnimationRef.current.cancel();
      scrollAnimationRef.current = null;
    }
    syncedSubdivisionRef.current = sub;
    setStaticTransform(sub);
    return sub;
  }, [getCurrentSubdivision, setStaticTransform]);

  // ── Update note CSS classes based on current subdivision ──────────────────

  /**
   * Efficiently updates CSS classes on note elements to reflect their
   * playback state (upcoming, playing, paused-at-playhead, or played).
   * Only touches DOM elements whose state actually changed.
   *
   * @param currentSubdivision - Current playback position in subdivisions
   * @param playing - Whether playback is currently active
   */
  const updateNoteClasses = useCallback(
    (currentSubdivision: number, playing: boolean) => {
      const elements = noteElementsRef.current;
      const prevActive = activeNoteIndicesRef.current;
      const prevPlayed = playedNoteIndicesRef.current;
      const nextActive = new Set<number>();
      const nextPlayed = new Set<number>();

      for (let i = 0; i < noteStyles.length; i++) {
        const style = noteStyles[i];
        if (!style) continue;
        const el = elements[i];
        if (!el) continue;

        const subdivisionDiff = style.startSubdivision - currentSubdivision;
        const noteAtLeftEdge = subdivisionDiff <= 0;
        const noteStillPlaying =
          subdivisionDiff + style.durationSubdivisions > 0;

        if (noteAtLeftEdge && noteStillPlaying) {
          if (playing) {
            nextActive.add(i);
          } else {
            // At playhead but paused — green
            if (!el.classList.contains('paused-at-playhead')) {
              el.classList.remove('playing', 'played');
              el.classList.add('paused-at-playhead');
            }
          }
        } else if (noteAtLeftEdge && !noteStillPlaying) {
          nextPlayed.add(i);
        } else {
          // Upcoming — remove any state classes
          if (
            el.classList.contains('playing') ||
            el.classList.contains('played') ||
            el.classList.contains('paused-at-playhead')
          ) {
            el.classList.remove('playing', 'played', 'paused-at-playhead');
          }
        }
      }

      // Update 'playing' class: add to newly active, remove from no longer active
      for (const i of nextActive) {
        if (!prevActive.has(i)) {
          const el = elements[i];
          if (el) {
            el.classList.remove('played', 'paused-at-playhead');
            el.classList.add('playing');
          }
        }
      }
      for (const i of prevActive) {
        if (!nextActive.has(i)) {
          const el = elements[i];
          if (el) {
            el.classList.remove('playing', 'paused-at-playhead');
          }
        }
      }

      // Update 'played' class
      for (const i of nextPlayed) {
        if (!prevPlayed.has(i)) {
          const el = elements[i];
          if (el) {
            el.classList.remove('playing', 'paused-at-playhead');
            el.classList.add('played');
          }
        }
      }

      activeNoteIndicesRef.current = nextActive;
      playedNoteIndicesRef.current = nextPlayed;
    },
    [noteStyles]
  );

  // ── Reset note classes when notes change ──────────────────────────────────

  useEffect(() => {
    activeNoteIndicesRef.current = new Set();
    playedNoteIndicesRef.current = new Set();
  }, [notes]);

  // ── rAF loop — only for note class updates ────────────────────────────────
  // The scroll is handled entirely by the Web Animation on the compositor.
  // We keep a lightweight rAF loop solely to toggle CSS classes on notes.

  useEffect(() => {
    const animate = () => {
      if (isPlayingRef.current) {
        const sub = getCurrentSubdivision();
        updateNoteClasses(sub, true);
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    // Initial position
    const initialSub = syncedSubdivisionRef.current;
    setStaticTransform(initialSub);
    updateNoteClasses(initialSub, isPlayingRef.current);

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      // Clean up Web Animation on unmount
      if (scrollAnimationRef.current) {
        scrollAnimationRef.current.cancel();
        scrollAnimationRef.current = null;
      }
    };
  }, [getCurrentSubdivision, setStaticTransform, updateNoteClasses]);

  // ── Sync currentTime → subdivision ────────────────────────────────────────

  useEffect(() => {
    const subdivision = secondsToSubdivisions(currentTime);
    if (typeof subdivision === 'number') {
      syncedSubdivisionRef.current = subdivision;
    }
    if (!isPlayingRef.current) {
      setStaticTransform(syncedSubdivisionRef.current);
      updateNoteClasses(syncedSubdivisionRef.current, false);
    }
  }, [
    secondsToSubdivisions,
    currentTime,
    setStaticTransform,
    updateNoteClasses,
  ]);

  // ── Handle play/pause transitions ─────────────────────────────────────────

  useEffect(() => {
    if (isPlayingRef.current && !isPlaying) {
      // Pausing: capture position from running animation, stop it
      const sub = stopScrollAnimation();
      updateNoteClasses(sub, false);
    } else if (!isPlayingRef.current && isPlaying) {
      // Resuming: launch Web Animation from current position
      startScrollAnimation(syncedSubdivisionRef.current);
    }
    isPlayingRef.current = isPlaying;
  }, [isPlaying, startScrollAnimation, stopScrollAnimation, updateNoteClasses]);

  // ── Handle tempo changes while playing ────────────────────────────────────

  useEffect(() => {
    const prevTempo = prevSecondsPerSubdivisionRef.current;
    const newTempo = effectiveSecondsPerSubdivision;
    prevSecondsPerSubdivisionRef.current = newTempo;

    if (prevTempo === newTempo || prevTempo === 0 || !isPlayingRef.current)
      return;

    // Capture current position, then restart animation with new tempo
    const sub = stopScrollAnimation();
    startScrollAnimation(sub);

    console.debug('[OtamatoneRoll] tempo changed, re-syncing animation', {
      prevTempo,
      newTempo,
      currentSubdivision: sub,
    });
  }, [
    effectiveSecondsPerSubdivision,
    stopScrollAnimation,
    startScrollAnimation,
  ]);

  // ── Restart animation when layout changes (resize) ────────────────────────

  const prevPixelsPerSubRef = useRef(layout.pixelsPerSubdivision);
  useEffect(() => {
    if (prevPixelsPerSubRef.current === layout.pixelsPerSubdivision) return;
    prevPixelsPerSubRef.current = layout.pixelsPerSubdivision;

    if (isPlayingRef.current) {
      // Layout changed while playing — restart with new pixel scale
      const sub = getCurrentSubdivision();
      if (scrollAnimationRef.current) {
        scrollAnimationRef.current.cancel();
        scrollAnimationRef.current = null;
      }
      syncedSubdivisionRef.current = sub;
      startScrollAnimation(sub);
    } else {
      setStaticTransform(syncedSubdivisionRef.current);
    }
  }, [
    layout.pixelsPerSubdivision,
    getCurrentSubdivision,
    startScrollAnimation,
    setStaticTransform,
  ]);

  // ── Pitch ball overlay (direct DOM manipulation) ──────────────────────────

  useEffect(() => {
    const ball = pitchBallRef.current;
    if (!ball) return;

    if (!isMicrophoneActive || !detectedPitch) {
      ball.style.display = 'none';
      return;
    }

    if (
      detectedPitch.frequency < minFrequency ||
      detectedPitch.frequency > maxFrequency
    ) {
      ball.style.display = 'none';
      return;
    }

    const normalized = stemPosition(
      minFrequency,
      maxFrequency,
      detectedPitch.frequency
    );
    const ballY = layout.playableTop + normalized * layout.playableHeight;
    const ballRadius = layout.innerWidth * 0.35;
    const ballAlpha = Math.max(0.15, Math.min(1, detectedPitch.confidence));

    // Determine color based on tuning accuracy vs currently-playing notes
    let hue = 200; // neutral blue when no note is expected
    if (isPlaying && noteTimeline) {
      const currentSubdivision = secondsToSubdivisions(currentTime) ?? 0;
      let minCentsDist = Infinity;
      for (const note of notes) {
        const diff = note.startSubdivision - currentSubdivision;
        if (diff <= 0 && diff + note.durationSubdivisions > 0) {
          const noteFreq = midiToFrequency(note.pitch);
          const dist = Math.abs(
            1200 * Math.log2(detectedPitch.frequency / noteFreq)
          );
          if (dist < minCentsDist) minCentsDist = dist;
        }
      }
      if (minCentsDist < Infinity) {
        const ratio = Math.min(1, minCentsDist / IN_TUNE_CENTS);
        hue = 120 * (1 - ratio);
      }
    }

    ball.style.display = 'block';
    ball.style.left = `${layout.playheadX - ballRadius}px`;
    ball.style.top = `${ballY - ballRadius}px`;
    ball.style.width = `${ballRadius * 2}px`;
    ball.style.height = `${ballRadius * 2}px`;
    ball.style.background = `hsl(${hue}, 80%, 55%)`;
    ball.style.borderColor = `hsla(${hue}, 60%, 30%, ${ballAlpha})`;
    ball.style.opacity = `${ballAlpha}`;
  }, [
    detectedPitch,
    isMicrophoneActive,
    isPlaying,
    currentTime,
    notes,
    noteTimeline,
    minFrequency,
    maxFrequency,
    secondsToSubdivisions,
    layout.playheadX,
    layout.playableTop,
    layout.playableHeight,
    layout.innerWidth,
  ]);

  // ── Render ────────────────────────────────────────────────────────────────

  // Before first measurement, render an empty wrapper so the ResizeObserver
  // can fire and provide dimensions.
  if (containerSize.width === 0 || containerSize.height === 0) {
    return <div ref={wrapperRef} className="otamatone-roll-wrapper" />;
  }

  return (
    <div ref={wrapperRef} className="otamatone-roll-wrapper">
      {/* Background: pitch grid lines & labels */}
      <div className="otamatone-background">
        {pitchLines.map((line, i) => (
          <div key={i}>
            <div className="otamatone-pitch-line" style={{ top: line.y }} />
            {line.noteName && (
              <div
                className="otamatone-pitch-label"
                style={{ top: line.y, left: 0, width: layout.labelX }}
              >
                {line.noteName}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Otamatone neck: white outer */}
      <div
        className="otamatone-neck-outer"
        style={{
          left: layout.playheadOuterX,
          width: layout.playheadOuterWidth,
        }}
      />

      {/* Otamatone neck: black inner */}
      <div
        className="otamatone-neck-inner"
        style={{
          left: layout.innerX,
          top: layout.innerY,
          width: layout.innerWidth,
          height: layout.innerHeight,
          borderRadius: layout.innerRadius,
        }}
      />

      {/* Notes viewport: starts at innerX, extends to right edge */}
      <div className="otamatone-notes-viewport" style={{ left: layout.innerX }}>
        {/* Scrollable container: translateX drives the scroll */}
        <div ref={containerRef} className="otamatone-notes-container">
          {/* Beat grid lines */}
          {beatLineStyles.map((style, i) => (
            <div
              key={`beat-${i}`}
              className="otamatone-grid-beat"
              style={{
                left: style.left,
                width: style.width,
                top: style.top,
                height: style.height,
              }}
            />
          ))}

          {/* Measure grid lines */}
          {measureLineStyles.map((style, i) => (
            <div
              key={`measure-${i}`}
              className="otamatone-grid-measure"
              style={{
                left: style.left,
                width: style.width,
                top: style.top,
                height: style.height,
              }}
            />
          ))}

          {/* Note rectangles */}
          {noteStyles.map((style, i) => {
            if (!style) return null;
            return (
              <div
                key={i}
                ref={(el) => {
                  noteElementsRef.current[i] = el;
                }}
                className="otamatone-note"
                style={{
                  left: style.left,
                  top: style.top,
                  width: style.width,
                  height: style.height,
                  borderRadius: style.borderRadius,
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Pitch detection ball */}
      <div
        ref={pitchBallRef}
        className="otamatone-pitch-ball"
        style={{ display: 'none' }}
      />

      {/* Microphone indicator */}
      {isMicrophoneActive && (
        <div
          className="otamatone-roll-mic-indicator"
          aria-label="Microphone active"
          title="Microphone active"
        >
          <svg
            width="14"
            height="18"
            viewBox="0 0 14 18"
            fill="none"
            stroke="#4ade80"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <rect x="4" y="0.5" width="6" height="9" rx="3" />
            <path d="M13 7v0.5a6 6 0 0 1-12 0V7" />
            <line x1="7" y1="13.5" x2="7" y2="16" />
            <line x1="4" y1="16" x2="10" y2="16" />
          </svg>
        </div>
      )}
    </div>
  );
};
