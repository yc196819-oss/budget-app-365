import { html } from '../../lib/html.js';
import { useRef, useState } from 'preact/hooks';
import { Icon } from '../../components/Icon.js';
import { readRecipe } from '../../data/shopping.js';

// A recipe in: a link to a recipe site, its text pasted, or a photo (a
// cookbook page, a screenshot). The advisor reads its ingredients; the photo
// and the page are not kept. `start` brings a recipe shared from the phone.
export function RecipeInput({ onRecipe, onCancel = null, start = null, people = null }) {
  const [tab, setTab] = useState(start && start.file ? 'image' : start && start.text && !/^https?:\/\//.test(start.text.trim()) ? 'text' : 'link');
  const [url, setUrl] = useState(start && start.text && /^https?:\/\//.test(start.text.trim()) ? start.text.trim() : '');
  const [text, setText] = useState(start && start.text && !/^https?:\/\//.test(start.text.trim()) ? start.text : '');
  const [file, setFile] = useState((start && start.file) || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pick = useRef(null);
  const ready = tab === 'link' ? /^https?:\/\/\S+\.\S+/.test(url.trim()) : tab === 'text' ? text.trim().length > 10 : !!file;
  const go = async () => {
    setBusy(true); setError('');
    try {
      const r = await readRecipe(tab === 'link' ? { url: url.trim() } : tab === 'text' ? { text } : { file });
      if (!r) throw new Error('לא מצאנו כאן מתכון עם מצרכים.');
      onRecipe(r);
    } catch (e) { setError(e.message || 'לא הצלחנו לקרוא את המתכון.'); }
    setBusy(false);
  };
  return html`<div class="rcp" role="group" aria-label="מתכון">
    <div class="rcp-tabs" role="tablist">${[['link', 'קישור'], ['text', 'טקסט'], ['image', 'תמונה']].map(([k, l]) => html`<button type="button" role="tab" key=${k} aria-selected=${String(tab === k)} onClick=${() => { setTab(k); setError(''); }}>${l}</button>`)}</div>
    ${tab === 'link' && html`<input class="input" type="url" dir="ltr" inputmode="url" placeholder="https://…" aria-label="קישור למתכון" value=${url} onInput=${(e) => setUrl(e.currentTarget.value)} />`}
    ${tab === 'text' && html`<textarea class="input" rows="5" placeholder="מדביקים כאן את המתכון, או רק את רשימת המצרכים" aria-label="טקסט המתכון" value=${text} onInput=${(e) => setText(e.currentTarget.value)}></textarea>`}
    ${tab === 'image' && html`<button type="button" class="rcp-pick" onClick=${() => pick.current && pick.current.click()}><${Icon} name="image" size=${18} /> ${file ? file.name || 'תמונה נבחרה' : 'לצלם או לבחור תמונה של המתכון'}</button>
      <input type="file" accept="image/*" hidden ref=${pick} onChange=${(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) setFile(f); }} />`}
    ${error && html`<span class="adv-err" role="alert">${error}</span>`}
    <div class="rcp-go">
      <button type="button" class="btn" disabled=${!ready || busy} onClick=${go}>${busy ? 'היועץ קורא את המתכון…' : 'לקרוא את המתכון'}</button>
      ${onCancel && html`<button type="button" class="btn-text" onClick=${onCancel} disabled=${busy}>ביטול</button>`}
    </div>
    <small class="rcp-note">התמונה והדף לא נשמרים. מה שיש לכם בבית מסמנים ב"יש לי".${people ? '' : ''}</small>
  </div>`;
}
