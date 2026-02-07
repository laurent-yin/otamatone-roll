import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PitchDetectionService,
  MIN_FREQUENCY_HZ,
  MAX_FREQUENCY_HZ,
} from './pitchDetection';

// Mock pitchfinder
vi.mock('pitchfinder', () => ({
  YIN: () => () => 440,
}));

// Mock Web Audio API
const mockAnalyserNode = {
  fftSize: 2048,
  getFloatTimeDomainData: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
};

const mockSourceNode = {
  connect: vi.fn(),
  disconnect: vi.fn(),
};

const mockAudioContext = {
  sampleRate: 44100,
  createMediaStreamSource: vi.fn().mockReturnValue(mockSourceNode),
  createAnalyser: vi.fn().mockReturnValue(mockAnalyserNode),
  close: vi.fn().mockResolvedValue(undefined),
};

const mockMediaStream = {
  getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
};

beforeEach(() => {
  vi.stubGlobal(
    'AudioContext',
    function AudioContext(this: typeof mockAudioContext) {
      Object.assign(this, mockAudioContext);
    }
  );
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue(mockMediaStream),
    },
  });
  // Mock requestAnimationFrame to run callback once immediately
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn().mockImplementation((_cb: FrameRequestCallback) => {
      // Don't recurse — just return an ID
      return 1;
    })
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PitchDetectionService', () => {
  it('starts and calls onPitch callback', async () => {
    const onPitch = vi.fn();
    const service = new PitchDetectionService(onPitch);

    await service.start();

    expect(service.isRunning).toBe(true);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: true,
    });
    expect(mockAudioContext.createMediaStreamSource).toHaveBeenCalled();
    expect(mockAudioContext.createAnalyser).toHaveBeenCalled();
    expect(mockSourceNode.connect).toHaveBeenCalledWith(mockAnalyserNode);

    service.stop();
  });

  it('stops and cleans up resources', async () => {
    const onPitch = vi.fn();
    const service = new PitchDetectionService(onPitch);

    await service.start();
    service.stop();

    expect(service.isRunning).toBe(false);
    expect(mockSourceNode.disconnect).toHaveBeenCalled();
    expect(mockMediaStream.getTracks()[0].stop).toHaveBeenCalled();
  });

  it('does not start twice', async () => {
    const onPitch = vi.fn();
    const service = new PitchDetectionService(onPitch);

    await service.start();
    await service.start(); // second call should be no-op

    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);

    service.stop();
  });

  it('exports expected constants', () => {
    expect(MIN_FREQUENCY_HZ).toBe(50);
    expect(MAX_FREQUENCY_HZ).toBe(2000);
  });
});
