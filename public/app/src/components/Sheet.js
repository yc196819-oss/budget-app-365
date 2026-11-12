import { html } from '../lib/html.js';
import { useEffect, useRef } from 'preact/hooks';
import { Icon } from './Icon.js';
import { lockScroll } from '../lib/scrollLock.js';

// Bottom sheet on mobile, centered dialog on desktop (see layout.css).
// Closes on Escape and on the scrim, and returns focus to where it was.
// full: takes the whole screen on phones (long forms, like the voice review).
export function Sheet({ title, onClose, children, full = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    // Into the sheet, unless the person is already typing inside it (the
    // effect runs a moment after it opens; a fast Enter would go nowhere).
    if (ref.current && !ref.current.contains(document.activeElement)) ref.current.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    // The page behind stays still while the sheet is open.
    const unlock = lockScroll();
    return () => {
      unlock();
      document.removeEventListener('keydown', onKey);
      if (prev && prev.focus) prev.focus();
    };
  }, []);
  return html`
    <div class="scrim" onClick=${onClose}></div>
    <div class=${'sheet' + (full ? ' sheet-full' : '')} role="dialog" aria-modal="true" aria-label=${title} tabIndex="-1" ref=${ref}>
      <span class="sheet-handle"></span>
      <div class="sheet-head">
        <h2>${title}</h2>
        <button type="button" class="icon-btn" style="width:36px;height:36px" aria-label="סגירה" onClick=${onClose}><${Icon} name="x" size=${18} stroke=${2.2} /></button>
      </div>
      ${children}
    </div>`;
}
