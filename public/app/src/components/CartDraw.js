import { html } from '../lib/html.js';

// While the advisor fills a cart: a shopping cart drawn line by line, its
// wheels, then products dropping into it one after another (and again).
// Only looks; the words next to it say what is happening.
export function CartDraw() {
  return html`<svg class="cd" viewBox="0 0 120 84" aria-hidden="true" focusable="false">
    <path class="cd-line cd-handle" d="M8 14h12l4 8" />
    <path class="cd-line cd-body" d="M24 22h80l-10 34H34L24 22z" />
    <path class="cd-line cd-rail" d="M30 39h68" />
    <circle class="cd-line cd-wheel" cx="40" cy="68" r="6" />
    <circle class="cd-line cd-wheel w2" cx="88" cy="68" r="6" />
    <rect class="cd-item i0" x="34" y="8" width="16" height="13" rx="3" />
    <rect class="cd-item i1" x="53" y="4" width="13" height="17" rx="3" />
    <rect class="cd-item i2" x="69" y="10" width="17" height="11" rx="3" />
    <rect class="cd-item i3" x="88" y="7" width="10" height="14" rx="3" />
  </svg>`;
}
