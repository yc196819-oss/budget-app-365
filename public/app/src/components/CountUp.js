import { html } from '../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (t) => 1 - Math.pow(1 - t, 3);

// A number that counts up to its value (from 0 the first time, then from the
// previous value). Screen readers get the final value right away; people who
// turned motion off see it without animation.
export function CountUp({ value, format, duration = 700 }) {
  const target = Number(value) || 0;
  const [shown, setShown] = useState(() => (reduced() ? target : 0));
  const from = useRef(reduced() ? target : 0);
  useEffect(() => {
    if (reduced()) { setShown(target); from.current = target; return undefined; }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(a + (target - a) * ease(t));
      if (t < 1) raf = requestAnimationFrame(step); else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target]);
  return html`<span class="countup"><span class="sr-only">${format(target)}</span><span aria-hidden="true">${format(Math.round(shown))}</span></span>`;
}
