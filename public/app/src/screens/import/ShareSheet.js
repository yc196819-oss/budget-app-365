import { html } from '../../lib/html.js';
import { Sheet } from '../../components/Sheet.js';
import { Icon } from '../../components/Icon.js';
import { sourcesOf, nameOf, providerOf, shareGuess } from '../../domain/sources.js';
import { Logo } from '../picture/Picture.js';

// A file shared to the app from the phone: which account or card it is for,
// bank by bank (each bank account, then the cards charged to it), with a
// guess from the file's name (the company, the card's last 4 digits). Then
// the usual upload, which finds the month in the file.
export function ShareSheet({ data, file, onPick, onClose }) {
  const sources = sourcesOf({ accounts: data.accounts, cards: data.cards });
  const guess = shareGuess(file.name, sources);
  const groups = data.accounts.map((a) => ({ bank: sources.find((x) => x.id === a.id), cards: sources.filter((x) => x.kind === 'card' && x.bankId === a.id) }));
  const loose = sources.filter((x) => x.kind === 'card' && !data.accounts.some((a) => a.id === x.bankId));
  const label = (x) => (x.kind === 'bank' ? 'עו״ש ' + nameOf(x) : nameOf(x) + (x.last4 ? ' ••' + x.last4 : ''));
  const opt = (x) => html`<button type="button" key=${x.id} class=${'share-opt' + (x.id === guess ? ' on' : '')} onClick=${() => onPick(x)}>
    <span class="pg-tile">${providerOf(x.provider) ? html`<${Logo} provider=${x.provider} size="s" />` : html`<${Icon} name=${x.kind === 'card' ? 'money' : 'assets'} size=${20} />`}</span>
    <span class="share-opt-t"><b>${label(x)}</b>${x.kind === 'card' && html`<small>${x.bankId && data.accounts.find((a) => a.id === x.bankId) ? 'יורד מ' + (data.accounts.find((a) => a.id === x.bankId).name || 'החשבון') : 'כרטיס אשראי'}</small>`}</span>
    ${x.id === guess && html`<span class="share-tag">לפי הקובץ</span>`}
  </button>`;
  return html`<${Sheet} title="פירוט חדש" onClose=${onClose}>
    <div class="stack share-sheet">
      <div class="share-file"><span class="share-ext">${(String(file.name).split('.').pop() || '').slice(0, 4).toUpperCase()}</span><span><b><bdi>${file.name}</bdi></b><small>שותף מהטלפון</small></span></div>
      <b class="share-q">של איזה חשבון או כרטיס הפירוט הזה?</b>
      ${!sources.length && html`<span class="muted">עוד אין חשבונות וכרטיסים. אפשר להעלות בכל זאת, ונזהה מהקובץ.</span>`}
      ${groups.map((g, i) => html`<div class="share-group" key=${'g' + i}>${g.bank && opt(g.bank)}${g.cards.map(opt)}</div>`)}
      ${loose.length > 0 && html`<div class="share-group">${loose.map(opt)}</div>`}
      <button type="button" class="pg-link" onClick=${() => onPick(null)}>לא בטוח? להעלות, ונזהה מהקובץ</button>
      <span class="faint" style="font-size:12.5px;text-align:center">את החודש נזהה מהקובץ, ואפשר לשנות אותו במסך הבא.</span>
    </div>
  <//>`;
}
