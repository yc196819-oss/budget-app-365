import { html } from '../../lib/html.js';
import { money, shortDate } from '../../domain/format.js';
import { VOTES, STATUS, roomText, signedMoney, outcome, votesFor, answerers, needsMyAnswer, isClosed, impact, findPurchase, wantedLabel } from '../../domain/decisions.js';
import { close } from '../../data/decisions.js';
import { DecisionChat } from './DecisionChat.js';
import { showToast } from '../../lib/toast.js';

// One purchase: who wants it, why, what it does to the money, and each
// partner's answer with their reason.
export function DecisionCard({ d, data, dec, userId, memberIds, nameOf, onAnswer }) {
  const today = new Date();
  const st = outcome(d, dec.votes, memberIds);
  const votes = votesFor(d, dec.votes);
  const mine = d.created_by === userId;
  const cat = d.category_id && (data.categories || []).find((c) => c.id === d.category_id);
  const open = !isClosed(d) && st !== 'not_now';
  const fx = open ? impact(d, data, today) : null;
  const linked = dec.decisions.map((x) => x.transaction_id).filter(Boolean);
  const bought = st === 'approved' ? findPurchase(d, data.txs || [], linked) : null;
  const myVote = votes.find((v) => v.user_id === userId);

  const finish = async (status, txId = null) => {
    try { await close(d, status, txId); showToast(status === 'bought' ? 'סומן כנקנה' : 'הבקשה בוטלה'); } catch (_err) { showToast('לא נשמר. נסו שוב.'); }
  };

  return html`<article class=${'card decision st-' + st}>
    <div class="decision-head">
      <span class="stack" style="gap:2px;min-width:0"><b class="decision-title">${d.title}</b>
        <span class="muted" style="font-size:13px">${mine ? 'את/ה רוצה' : nameOf(d.created_by) + ' רוצה'} · ${wantedLabel(d.wanted_by, today)}${cat ? ' · ' + cat.name : ''}</span></span>
      <span class="stack" style="gap:4px;align-items:flex-end"><b class="num decision-amount">${money(d.amount)}</b><span class="status-chip">${STATUS[st]}</span></span>
    </div>
    ${d.note && html`<p class="decision-note"><span class="faint">למה: </span>${d.note}</p>`}
    ${fx && html`<div class=${'decision-impact' + (fx.turnsNegative || (fx.roomAfter !== null && fx.roomAfter < 0) ? ' warn' : '')}>
      ${fx.roomBefore !== null && html`<span>החודש: <b class="num">${roomText(fx.roomBefore)}</b> ← <b class="num">${roomText(fx.roomAfter)}</b></span>`}
      ${fx.hasBalance && html`<span>בסוף ${fx.month} בחשבון: <b class="num">${signedMoney(fx.endBefore)}</b> ← <b class="num">${signedMoney(fx.endAfter)}</b></span>`}
      ${fx.turnsNegative && html`<b>הקנייה מכניסה את החשבון למינוס ב${fx.month}</b>`}
    </div>`}
    <div class="answers">
      ${answerers(d, memberIds).map((id) => {
        const v = votes.find((x) => x.user_id === id);
        return html`<div class="answer" key=${id}>
          <span class="answer-who">${v ? VOTES[v.vote].icon : '…'} <b>${nameOf(id)}</b>: ${v ? VOTES[v.vote].label : id === userId ? 'עוד לא ענית' : 'עוד לא ענה/תה'}</span>
          ${v && v.note && html`<span class="answer-note">${v.note}</span>`}
        </div>`;
      })}
    </div>
    <${DecisionChat} d=${d} dec=${dec} data=${data} userId=${userId} memberIds=${memberIds} nameOf=${nameOf} />
    ${bought && html`<div class="decision-match"><span>נראה שזה נקנה: ${bought.description} · ${shortDate(bought.tx_date)} · <span class="num">${money(bought.amount)}</span></span>
      <button type="button" class="btn-text" onClick=${() => finish('bought', bought.id)}>כן, לסגור</button></div>`}
    ${!isClosed(d) && html`<div class="decision-actions">
      ${needsMyAnswer(d, dec.votes, userId, memberIds) && html`<button type="button" class="btn" onClick=${onAnswer}>לענות</button>`}
      ${myVote && html`<button type="button" class="btn btn-ghost" onClick=${onAnswer}>לשנות תשובה</button>`}
      ${st === 'approved' && !bought && html`<button type="button" class="btn btn-ghost" onClick=${() => finish('bought')}>נקנה ✓</button>`}
      ${mine && html`<button type="button" class="btn-text" style="color:var(--danger)" onClick=${() => finish('withdrawn')}>לבטל את הבקשה</button>`}
    </div>`}
  </article>`;
}
