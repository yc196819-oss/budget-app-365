import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { routeView } from '../../domain/routes.js';
import { ChatScreen } from './DecisionChat.js';
import { PushNudge } from './PushNudge.js';
import { Loading } from '../../components/Loading.js';
import { InviteButton } from '../../components/InviteButton.js';
import { money } from '../../domain/format.js';
import { groups } from '../../domain/decisions.js';
import { DecisionCard } from './DecisionCard.js';
import { NewDecisionSheet } from './NewDecisionSheet.js';
import { AnswerSheet } from './AnswerSheet.js';
import { AgreementSheet } from './AgreementSheet.js';

// "מחליטים ביחד": purchases above the amount the couple agreed on are decided
// together. Whoever wants something opens a card; the partner approves, says
// "not now" or "let's talk", with a reason. Nothing stays unspoken.
export function TogetherScreen({ data, dec, userId }) {
  // One sheet at a time: { kind: 'new' } | { kind: 'answer', decision } | { kind: 'agreement' }
  const [sheet, setSheet] = useState(null);
  const close = () => setSheet(null);
  // The open conversation: from a tap, or from a notification (#/together/<id>).
  const [chatId, setChatId] = useState(() => routeView(location.hash) || null);
  useEffect(() => {
    const onHash = () => { const id = routeView(location.hash); if (id) setChatId(id); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const openChat = (id) => setChatId(id);
  const closeChat = () => { setChatId(null); if (routeView(location.hash)) history.replaceState(null, '', '#/together'); };

  if (data.status === 'loading' || data.status === 'idle' || dec.status === 'loading' || dec.status === 'idle') return html`<${Loading} />`;
  if (dec.status === 'error') {
    return html`<div class="card empty" role="alert"><b style="color:var(--text)">${dec.missing ? 'מחליטים ביחד עוד לא הופעל במסד הנתונים' : 'לא הצלחנו לטעון את ההחלטות'}</b>
      <button type="button" class="btn btn-ghost" onClick=${dec.reload}>לנסות שוב</button></div>`;
  }

  const names = data.members || {};
  const memberIds = Object.keys(names);
  const nameOf = (id) => (id === userId ? 'את/ה' : names[id] || 'בן/בת הזוג');
  const partners = memberIds.filter((id) => id !== userId);
  const g = groups(dec.decisions, dec.votes, userId, memberIds);
  const card = (d) => html`<${DecisionCard} key=${d.id} d=${d} data=${data} dec=${dec} userId=${userId} memberIds=${memberIds} nameOf=${nameOf} onAnswer=${() => setSheet({ kind: 'answer', decision: d })} onChat=${() => openChat(d.id)} />`;
  const chat = chatId && dec.decisions.find((d) => d.id === chatId);
  const section = (title, list, hint) => list.length > 0 && html`<section class="stack" style="gap:10px">
    <div class="sec-title"><b>${title}</b>${hint && html`<span class="faint">${hint}</span>`}</div>${list.map(card)}</section>`;

  return html`<div class="together">
    <aside class="stack together-side">
      <div class="card agreement">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
          <span class="stack" style="gap:4px"><b style="font-size:16px">ההסכם שלנו</b>
            <span class="muted" style="font-size:14px;line-height:1.5">קנייה מעל <b class="num">${money(dec.threshold)}</b> מחליטים ביחד.${dec.allowance ? html` כל אחד מוציא עד <b class="num">${money(dec.allowance)}</b> בחודש בלי לשאול.` : ''}</span></span>
          <button type="button" class="btn-text" onClick=${() => setSheet({ kind: 'agreement' })}>לשנות</button>
        </div>
      </div>
      <button type="button" class="btn" onClick=${() => setSheet({ kind: 'new' })}>+ אני רוצה לקנות משהו</button>
      ${partners.length > 0 && html`<${PushNudge} userId=${userId} hid=${data.hid} partnerPush=${dec.partnerPush} names=${partners.map(nameOf)} />`}
      ${partners.length === 0 && html`<div class="card stack"><b>מחליטים ביחד עובד כששניכם באפליקציה</b>
        <span class="muted" style="font-size:14px">הזמינו את בן/בת הזוג, ואז כל כרטיס יגיע אליהם לאישור עם התראה.</span>
        <${InviteButton} hid=${data.hid} userId=${userId} /></div>`}
    </aside>
    <div class="stack together-main">
      ${section('מחכה לתשובה שלך', g.mine)}
      ${section('בשיחה, עוד לא החלטנו', g.talk, 'נשאר כאן עד שתסכמו')}
      ${section('מחכה לתשובה', g.waiting)}
      ${section('סוכם, עוד לא נקנה', g.approved)}
      ${dec.decisions.length === 0 && html`<div class="card empty"><b style="color:var(--text)">עוד אין כרטיסים</b>
        <span>רוצים לקנות משהו מעל ${money(dec.threshold)}? פתחו כרטיס, ובן/בת הזוג יקבלו אותו לאישור.</span></div>`}
      ${g.history.length > 0 && html`<details class="history"><summary>היסטוריה (${g.history.length})</summary><div class="stack" style="gap:10px;margin-top:10px">${g.history.map(card)}</div></details>`}
    </div>

    ${sheet && sheet.kind === 'new' && html`<${NewDecisionSheet} data=${data} threshold=${dec.threshold} userId=${userId} onClose=${close} />`}
    ${chat && html`<${ChatScreen} key=${chat.id} d=${chat} dec=${dec} data=${data} userId=${userId} memberIds=${memberIds} nameOf=${nameOf} onClose=${closeChat} onAnswer=${() => setSheet({ kind: 'answer', decision: chat })} />`}
    ${sheet && sheet.kind === 'answer' && html`<${AnswerSheet} decision=${sheet.decision} votes=${dec.votes} userId=${userId} memberIds=${memberIds} nameOf=${nameOf} onClose=${close} />`}
    ${sheet && sheet.kind === 'agreement' && html`<${AgreementSheet} hid=${data.hid} threshold=${dec.threshold} allowance=${dec.allowance} onClose=${close} />`}
  </div>`;
}
