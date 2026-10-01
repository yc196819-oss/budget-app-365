import { html } from '../lib/html.js';

// Shown while a screen's data loads: the outline of what is coming, gently
// shimmering, instead of a bare "loading" line.
export function Loading({ label = 'טוען…' }) {
  return html`<div class="stack loading" role="status" aria-busy="true">
    <span class="sr-only">${label}</span>
    <div class="card skel-card"><span class="skel" style="width:40%"></span><span class="skel skel-big" style="width:65%"></span><span class="skel" style="width:85%"></span></div>
    ${[0, 1].map((i) => html`<div class="card skel-card" key=${i}><span class="skel" style="width:55%"></span><span class="skel" style="width:90%"></span><span class="skel" style="width:70%"></span></div>`)}
  </div>`;
}
