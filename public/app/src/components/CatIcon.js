import { html } from '../lib/html.js';
import { catColor } from '../domain/colors.js';

// The category's emoji in a soft circle of its color.
export function CatIcon({ category, size = 38 }) {
  const color = catColor(category && category.id);
  const label = category && category.icon ? category.icon : (category && category.name ? category.name.slice(0, 1) : '·');
  return html`<span class="cat-icon" aria-hidden="true" style=${'width:' + size + 'px;height:' + size + 'px;background:' + color + '29;color:' + color}>${label}</span>`;
}
