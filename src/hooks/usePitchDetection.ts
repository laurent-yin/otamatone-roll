import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/appStore';
import { PitchDetectionService } from '../services/pitchDetection';

/**
 * React hook that manages the pitch detection lifecycle.
 *
 * When `isMicrophoneActive` is true in the store, this hook:
 * 1. Requests microphone permission
 * 2. Starts real-time pitch detection
 * 3. Writes detected pitch results to the store
 *
 * When `isMicrophoneActive` becomes false, it stops detection and releases the mic.
 * If microphone access is denied, it resets `isMicrophoneActive` to false.
 *
 * Mount this hook once at the top level (e.g., in App) so the audio pipeline
 * is independent of panel layout changes.
 *
 * @example
 * // In App.tsx:
 * usePitchDetection();
 */
export const usePitchDetection = (): void => {
  const isMicrophoneActive = useAppStore((state) => state.isMicrophoneActive);
  const setDetectedPitch = useAppStore((state) => state.setDetectedPitch);
  const setIsMicrophoneActive = useAppStore(
    (state) => state.setIsMicrophoneActive
  );

  const serviceRef = useRef<PitchDetectionService | null>(null);

  useEffect(() => {
    if (!isMicrophoneActive) {
      // Stop any running service when mic is deactivated
      if (serviceRef.current) {
        serviceRef.current.stop();
        serviceRef.current = null;
      }
      setDetectedPitch(null);
      return;
    }

    // Start pitch detection
    const service = new PitchDetectionService((result) => {
      setDetectedPitch(result);
    });
    serviceRef.current = service;

    service.start().catch((err) => {
      console.warn(
        '[usePitchDetection] Microphone access denied or failed:',
        err
      );
      setIsMicrophoneActive(false);
    });

    return () => {
      service.stop();
      if (serviceRef.current === service) {
        serviceRef.current = null;
      }
    };
  }, [isMicrophoneActive, setDetectedPitch, setIsMicrophoneActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (serviceRef.current) {
        serviceRef.current.destroy();
        serviceRef.current = null;
      }
    };
  }, []);
};
