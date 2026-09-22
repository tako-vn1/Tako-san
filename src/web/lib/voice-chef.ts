/**
 * AI Voice Sous Chef
 * Web Speech API for Vietnamese speech synthesis and hands-free voice commands
 */

export interface VoiceCommandCallbacks {
  onNext?: () => void;
  onPrev?: () => void;
  onRepeat?: () => void;
  onStartTimer?: () => void;
  onPauseTimer?: () => void;
  onHeardCommand?: (text: string) => void;
  onError?: (err: any) => void;
}

class VoiceSousChef {
  private isSpeaking = false;
  private recognition: any = null;
  private isListening = false;

  /**
   * Speak cooking step instruction in Vietnamese
   */
  speakInstruction(text: string, onEnd?: () => void): boolean {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return false;
    }

    try {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'vi-VN';
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      // Select Vietnamese voice if available
      const voices = window.speechSynthesis.getVoices();
      const viVoice = voices.find((v) => v.lang === 'vi-VN' || v.lang.startsWith('vi'));
      if (viVoice) {
        utterance.voice = viVoice;
      }

      utterance.onstart = () => {
        this.isSpeaking = true;
      };

      utterance.onend = () => {
        this.isSpeaking = false;
        if (onEnd) onEnd();
      };

      utterance.onerror = () => {
        this.isSpeaking = false;
      };

      window.speechSynthesis.speak(utterance);
      return true;
    } catch {
      return false;
    }
  }

  stopSpeaking() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      this.isSpeaking = false;
    }
  }

  getSpeakingStatus(): boolean {
    return this.isSpeaking;
  }

  /**
   * Start listening for voice commands in Vietnamese
   */
  startListening(callbacks: VoiceCommandCallbacks): () => void {
    if (typeof window === 'undefined') return () => {};

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      if (callbacks.onError) {
        callbacks.onError(new Error('Trình duyệt chưa hỗ trợ nhận diện giọng nói Web Speech.'));
      }
      return () => {};
    }

    try {
      if (this.recognition) {
        this.recognition.stop();
      }

      const recognition = new SpeechRecognition();
      recognition.lang = 'vi-VN';
      recognition.continuous = true;
      recognition.interimResults = false;

      recognition.onresult = (event: any) => {
        const lastResult = event.results[event.results.length - 1];
        if (!lastResult || !lastResult[0]) return;

        const transcript = lastResult[0].transcript.trim().toLowerCase();
        if (callbacks.onHeardCommand) {
          callbacks.onHeardCommand(transcript);
        }

        // Match commands
        if (
          transcript.includes('tiếp') ||
          transcript.includes('kế tiếp') ||
          transcript.includes('xong') ||
          transcript.includes('next')
        ) {
          if (callbacks.onNext) callbacks.onNext();
        } else if (
          transcript.includes('lùi') ||
          transcript.includes('quay lại') ||
          transcript.includes('trước') ||
          transcript.includes('back')
        ) {
          if (callbacks.onPrev) callbacks.onPrev();
        } else if (
          transcript.includes('đọc lại') ||
          transcript.includes('nói lại') ||
          transcript.includes('nhắc lại') ||
          transcript.includes('repeat')
        ) {
          if (callbacks.onRepeat) callbacks.onRepeat();
        } else if (
          transcript.includes('bấm giờ') ||
          transcript.includes('hẹn giờ') ||
          transcript.includes('bắt đầu') ||
          transcript.includes('timer')
        ) {
          if (callbacks.onStartTimer) callbacks.onStartTimer();
        } else if (
          transcript.includes('dừng') ||
          transcript.includes('ngừng') ||
          transcript.includes('tạm dừng') ||
          transcript.includes('pause')
        ) {
          if (callbacks.onPauseTimer) callbacks.onPauseTimer();
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error !== 'no-speech') {
          console.warn('Speech recognition event:', event.error);
          if (this.isListening) {
            this.isListening = false;
            callbacks.onError?.(event);
          }
        }
      };

      recognition.onend = () => {
        // Auto-restart if user kept listening active
        if (this.isListening) {
          try {
            recognition.start();
          } catch {
            // Ignore
          }
        }
      };

      recognition.start();
      this.recognition = recognition;
      this.isListening = true;

      return () => {
        this.isListening = false;
        if (this.recognition) {
          try {
            this.recognition.stop();
          } catch {
            // Ignore
          }
          this.recognition = null;
        }
      };
    } catch (err) {
      if (callbacks.onError) callbacks.onError(err);
      return () => {};
    }
  }

  stopListening() {
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore
      }
      this.recognition = null;
    }
  }
}

export const voiceChef = new VoiceSousChef();
