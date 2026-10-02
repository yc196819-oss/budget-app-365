// Voice in and out, with the browser's own speech services (no extra
// library). Both are optional: the buttons hide where unsupported.

export function canListen() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Starts listening in Hebrew; calls onText with the final text and, when
// given, onInterim with the words heard so far. Returns stop().
// With continuous, onText is called for each finished phrase.
export function listen({ onText, onInterim, onEnd, onError, continuous = false }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR();
  r.lang = 'he-IL';
  r.interimResults = !!onInterim;
  // Continuous: keeps listening through pauses until stop() (a long recording).
  r.continuous = continuous;
  r.maxAlternatives = 1;
  r.onresult = (e) => {
    let final = '';
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) final += res[0].transcript; else interim += res[0].transcript;
    }
    if (interim && onInterim) onInterim(interim);
    if (final.trim()) onText(final.trim());
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
