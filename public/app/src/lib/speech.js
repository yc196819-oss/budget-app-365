// Voice in and out, with the browser's own speech services (no extra
// library). Both are optional: the buttons hide where unsupported.

export function canListen() {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

// Starts listening in Hebrew; calls onText with the final text. Returns stop().
export function listen({ onText, onEnd, onError }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR();
  r.lang = 'he-IL';
  r.interimResults = false;
  r.maxAlternatives = 1;
  r.onresult = (e) => { const t = e.results[0] && e.results[0][0] ? e.results[0][0].transcript : ''; if (t) onText(t); };
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
