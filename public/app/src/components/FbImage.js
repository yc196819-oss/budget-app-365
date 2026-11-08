import { html } from '../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { imageUrl } from '../data/feedback.js';

// A picture attached to a request, loaded through the server. A closed
// request's pictures are deleted, so it says so instead of a broken image.
export function FbImage({ path }) {
  const [src, setSrc] = useState(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let url = null;
    imageUrl(path).then((u) => { url = u; if (u) setSrc(u); else setGone(true); }).catch(() => setGone(true));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [path]);
  if (gone) return html`<span class="faint fb-img-gone">התמונה נמחקה כשהפנייה נסגרה</span>`;
  if (!src) return html`<span class="fb-img fb-img-wait" aria-label="טוען תמונה"></span>`;
  return html`<a href=${src} target="_blank" rel="noopener" class="fb-img-link"><img class="fb-img" src=${src} alt="תמונה שצורפה לפנייה" /></a>`;
}

// Choosing a picture: a button that opens the gallery or camera, and a
// small preview with "remove".
export function ImagePick({ file, onFile }) {
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!file) { setPreview(null); return undefined; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return html`<div class="img-pick">
    ${preview ? html`<span class="img-pick-chosen"><img src=${preview} alt="התמונה שנבחרה" /><button type="button" class="btn-text" onClick=${() => onFile(null)}>להסיר</button></span>`
      : html`<label class="btn btn-ghost img-pick-btn">צירוף תמונה (לא חובה)<input type="file" accept="image/png,image/jpeg,image/webp" aria-label="צירוף תמונה" onChange=${(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) onFile(f); }} /></label>`}
  </div>`;
}
