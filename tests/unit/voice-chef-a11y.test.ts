// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { voiceChef } from '../../src/web/lib/voice-chef';

class RecognitionBoundary {
  static latest: RecognitionBoundary;
  start = vi.fn();
  stop = vi.fn();
  onerror?: (event: { error: string }) => void;
  onend?: () => void;
  onresult?: (event: { results: Array<Array<{ transcript: string }>> }) => void;

  constructor() { RecognitionBoundary.latest = this; }
}

describe('hands-free accessibility feedback at the browser boundary', () => {
  beforeEach(() => {
    vi.stubGlobal('SpeechRecognition', RecognitionBoundary);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    voiceChef.stopListening();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports capability failure and does not silently restart a failed listener', () => {
    const onError = vi.fn();
    voiceChef.startListening({ onError });
    const recognition = RecognitionBoundary.latest;
    recognition.onerror?.({ error: 'not-allowed' });
    recognition.onend?.();
    expect(onError).toHaveBeenCalledExactlyOnceWith({ error: 'not-allowed' });
    expect(recognition.start).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing no-speech retry and does not report an intentional stop as failure', () => {
    const onError = vi.fn();
    voiceChef.startListening({ onError });
    const recognition = RecognitionBoundary.latest;
    recognition.onerror?.({ error: 'no-speech' });
    recognition.onend?.();
    expect(recognition.start).toHaveBeenCalledTimes(2);
    voiceChef.stopListening();
    recognition.onerror?.({ error: 'aborted' });
    recognition.onend?.();
    expect(onError).not.toHaveBeenCalled();
    expect(recognition.start).toHaveBeenCalledTimes(2);
  });

  it('preserves heard feedback and all existing cooking command delegates', () => {
    const callbacks = {
      onNext: vi.fn(), onPrev: vi.fn(), onRepeat: vi.fn(),
      onStartTimer: vi.fn(), onPauseTimer: vi.fn(), onHeardCommand: vi.fn(),
    };
    voiceChef.startListening(callbacks);
    for (const transcript of ['tiếp', 'lùi', 'đọc lại', 'hẹn giờ', 'tạm dừng']) {
      RecognitionBoundary.latest.onresult?.({ results: [[{ transcript }]] });
      expect(callbacks.onHeardCommand).toHaveBeenLastCalledWith(transcript);
    }
    expect(callbacks.onHeardCommand).toHaveBeenCalledTimes(5);
    for (const action of ['onNext', 'onPrev', 'onRepeat', 'onStartTimer', 'onPauseTimer'] as const) {
      expect(callbacks[action]).toHaveBeenCalledTimes(1);
    }
  });
});
