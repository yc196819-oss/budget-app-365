import { html } from '../../lib/html.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { grouped } from '../../domain/shopping.js';

// In the store: the list on the whole screen, big tiles department by
// department, a tap marks a thing as bought (and again to undo), how much is
// left at the top. The screen is kept on while it is open (where the phone
// allows it), and lets go when it closes.
export function StoreMode({ items, onToggle, onFinish, onClose }) {
  const [hide, setHide] = useState(false);
  const lock = useRef(null);
  useEffect(() => {
    let live = true;
    const ask = async () => {
      try { if (live && navigator.wakeLock && document.visibilityState === 'visible') lock.current = await navigator.wakeLock.request('screen'); } catch (_e) { /* not allowed: the screen dims as usual */ }
    };
    ask();
    // A lock lets go when the app is hidden; asked again on coming back.
    const back = () => { if (document.visibilityState === 'visible') ask(); };
    document.addEventListener('visibilitychange', back);
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    document.body.classList.add('store-on');
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', back);
      document.removeEventListener('keydown', esc);
      document.body.classList.remove('store-on');
      try { if (lock.current) lock.current.release(); } catch (_e) { /* already let go */ }
    };
  }, []);
  const groups = grouped(items);
  const open = items.filter((i) => !i.cleared_at);
  const done = open.filter((i) => i.done).length;
  const pct = open.length ? Math.round((done / open.length) * 100) : 0;
  return html`<div class="store" role="dialog" aria-modal="true" aria-label="מצב בחנות">
    <header class="store-top">
      <div class="store-title"><b>בחנות</b><span class="num">נקנו ${done} מתוך ${open.length}</span></div>
      <button type="button" class=${'store-hide' + (hide ? ' on' : '')} aria-pressed=${String(hide)} onClick=${() => setHide((h) => !h)}>${hide ? 'להראות הכל' : 'להסתיר מה שנקנה'}</button>
      <button type="button" class="store-x" aria-label="לצאת ממצב בחנות" onClick=${onClose}><${Icon} name="x" size=${20} /></button>
      <span class="store-bar" aria-hidden="true"><i style=${'width:' + pct + '%'}></i></span>
    </header>
    <div class="store-body">
      ${groups.map((g) => {
        const rows = hide ? g.items.filter((i) => !i.done) : g.items;
        if (!rows.length) return null;
        return html`<section class="store-aisle" key=${g.aisle}>
          <h2>${g.label} <small class="num">${g.items.filter((i) => !i.done).length || '✓'}</small></h2>
          <div class="store-grid">${rows.map((i) => html`<button type="button" key=${i.id} class=${'store-tile' + (i.done ? ' done' : '')} aria-pressed=${String(!!i.done)} onClick=${() => onToggle(i)}>
            <span class="store-n">${i.name}</span>${i.qty && html`<span class="store-q">${i.qty}</span>`}
            <span class="store-tick" aria-hidden="true">${i.done && html`<${Icon} name="check" size=${16} stroke=${2.6} />`}</span>
          </button>`)}</div>
        </section>`;
      })}
      ${done === open.length && open.length > 0 && html`<p class="store-all" role="status">הכל נקנה.</p>`}
    </div>
    ${done > 0 && html`<footer class="store-foot"><button type="button" class="btn" onClick=${() => { onFinish(); onClose(); }}>סיימתי לקנות (${done} נקנו)</button></footer>`}
  </div>`;
}
