// Voice in and out, with the browser's own speech services (no extra
// library). Both are optional: the buttons hide where unsupported.

import { mergeFinals } from '../domain/voice.js';

export function canListen() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Starts listening in Hebrew. Returns stop().
// onText(text): the whole final text heard so far in this session (it
// replaces, not appends: phones re-send earlier words, see mergeFinals).
// onInterim(words): the words still being recognized.
// continuous: keeps listening through pauses until stop().
export function listen({ onText, onInterim, onEnd, onError, continuous = false }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR();
  r.lang = 'he-IL';
  r.interimResults = !!onInterim;
  r.continuous = continuous;
  r.maxAlternatives = 1;
  r.onresult = (e) => {
    const finals = [];
    let interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finals.push(res[0].transcript); else interim += ' ' + res[0].transcript;
    }
    if (onInterim) onInterim(interim.trim());
    const text = mergeFinals(finals);
    if (text) onText(text);
  };
  r.onerror = (e) => onError && onError(e.error || 'error');
  r.onend = () => onEnd && onEnd();
  r.start();
  return () => { try { r.stop(); } catch (_err) { /* already stopped */ } };
}

export function canSpeak() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function speak(text, onEnd) {
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text || ''));
  u.lang = 'he-IL';
  const voice = window.speechSynthesis.getVoices().find((v) => /^he/i.test(v.lang));
  if (voice) u.voice = voice;
  u.onend = () => onEnd && onEnd();
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}
