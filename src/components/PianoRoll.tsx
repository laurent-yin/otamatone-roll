import { useEffect, useRef } from 'react';
import { usePianoRollNotes } from '../hooks/usePianoRollNotes';

interface PianoRollProps {
  notation: string;
  currentTime?: number;
  isPlaying?: boolean;
}

const PIXELS_PER_SECOND = 100; // Scroll speed
const NOTE_HEIGHT = 6; // Height of each note rectangle
const PITCH_PADDING = 1; // Vertical padding between notes
const MIN_PITCH = 24; // C1 - very low
const MAX_PITCH = 108; // C8 - very high

export const PianoRoll: React.FC<PianoRollProps> = ({
  notation,
  currentTime = 0,
  isPlaying = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const { notes, totalDuration } = usePianoRollNotes(notation);

  // Handle canvas resizing and rendering together
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      // Set canvas size accounting for device pixel ratio
      canvas.width = width * dpr;
      canvas.height = height * dpr;

      // Reset transform and scale for high DPI
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      // Playhead is 20% from the left edge
      const playheadX = width * 0.2;

      // Clear canvas
      ctx.clearRect(0, 0, width, height);

      // Draw background
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, width, height);

      // Calculate pitch range
      const pitchRange = MAX_PITCH - MIN_PITCH;
      const pitchHeight = NOTE_HEIGHT + PITCH_PADDING;

      // Draw horizontal grid lines for pitches
      ctx.strokeStyle = '#2a2a2a';
      ctx.lineWidth = 1;
      for (let i = 0; i <= pitchRange; i++) {
        const y = height - i * pitchHeight - pitchHeight / 2;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Draw notes
      let notesDrawn = 0;
      notes.forEach((note) => {
        const timeDiff = note.startTime - currentTime;
        const x = playheadX + timeDiff * PIXELS_PER_SECOND;
        const noteWidth = note.duration * PIXELS_PER_SECOND;
        const pitchIndex = note.pitch - MIN_PITCH;
        const y = height - pitchIndex * pitchHeight - pitchHeight;

        // Only draw notes that are visible on screen
        if (x + noteWidth < 0 || x > width) {
          return;
        }

        // Skip notes outside pitch range
        if (note.pitch < MIN_PITCH || note.pitch > MAX_PITCH) {
          return;
        }

        notesDrawn++;

        // Color based on timing
        let color: string;
        if (timeDiff > 0) {
          color = '#4a9eff'; // Blue for upcoming notes
        } else if (timeDiff + note.duration > 0) {
          color = '#4ade80'; // Green for currently playing
        } else {
          color = '#666666'; // Gray for played notes
        }

        ctx.fillStyle = color;
        ctx.fillRect(x, y, noteWidth, NOTE_HEIGHT);

        // Add border
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, noteWidth, NOTE_HEIGHT);
      });

      // Draw playhead line
      ctx.strokeStyle = '#ff4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      // Draw time indicator
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px monospace';
      ctx.fillText(
        `Time: ${currentTime.toFixed(2)}s / ${totalDuration.toFixed(2)}s | Notes: ${notes.length} | Drawn: ${notesDrawn}`,
        10,
        20
      );
    };

    // Re-render when window resizes
    const resizeObserver = new ResizeObserver(() => {
      render();
    });

    resizeObserver.observe(canvas);

    // Animation loop for playback
    const animate = () => {
      render();
      if (isPlaying) {
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    };

    // Initial render
    animate();

    return () => {
      resizeObserver.disconnect();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [notes, currentTime, isPlaying, totalDuration]);

  return <canvas ref={canvasRef} className="piano-roll-canvas" />;
};
