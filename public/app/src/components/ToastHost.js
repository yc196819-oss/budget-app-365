import { html } from '../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { subscribeToast, hideToast } from '../lib/toast.js';

export function ToastHost() {
  const [toast, setToast] = useState(null);
  useEffect(() => subscribeToast(setToast), []);
  if (!toast) return null;
  const undo = () => { hideToast(); toast.undo(); };
  return html`<div class="toast" role="status" key=${toast.id}>
    <span>${toast.message}</span>
    ${toast.undo && html`<button type="button" onClick=${undo}>ביטול</button>`}
  </div>`;
}
