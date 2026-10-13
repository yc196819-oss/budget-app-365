import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { todaysNews } from '../../data/news.js';
import { personalLine } from '../../domain/news.js';

const TOPIC = { rate: '🏦 ריבית', currency: '💵 מטבע', prices: '📈 מחירים', jobs: '💼 עבודה ושכר', tax: '🧾 מיסים', housing: '🏠 דיור', markets: '📊 שוק ההון', energy: '⛽ אנרגיה', benefits: '🎁 הטבות', other: '📰 כלכלה' };
const isoToday = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// Morning news in the learning corner: what happened in the economy, and what
// it means for this family (from its own numbers, on the device).
export function NewsView({ data }) {
  const [state, setState] = useState({ status: 'loading' });
  const [mine, setMine] = useState(true);
  const [open, setOpen] = useState(null);
  const [pick, setPick] = useState(null);
  const load = () => { setState({ status: 'loading' }); todaysNews(isoToday()).then((d) => setState({ status: 'ready', d }), (e) => setState({ status: 'error', error: e.message })); };
  useEffect(load, []);

  if (state.status === 'loading') return html`<div class="news stack" aria-busy="true">${[0, 1, 2].map((i) => html`<div class="card" key=${i}><span class="skel" style="width:40%"></span><span class="skel" style="width:90%"></span><span class="skel" style="width:75%"></span></div>`)}</div>`;
  if (state.status === 'error') return html`<div class="card stack" role="alert"><b>החדשות של הבוקר לא זמינות כרגע</b><span class="muted" style="font-size:14px">${state.error}</span><button type="button" class="btn btn-ghost" onClick=${load}>לנסות שוב</button></div>`;
  const d = state.d;
  const when = new Date(d.day + 'T08:00:00').toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
  return html`<div class="news stack">
    <section class="card news-hero">
      <span class="muted" style="font-size:13px">${when} · ${d.items.length} ידיעות</span>
      <b class="news-h">מה קרה בכלכלה, ומה זה אומר עליכם</b>
      ${d.pulse && d.pulse.length > 0 && html`<div class="news-pulse">${d.pulse.map((p) => html`<div key=${p.label}><span>${p.label}</span><b class="num">${p.value}</b>${p.note && html`<small>${p.note}</small>`}</div>`)}</div>`}
    </section>
    <label class="check news-mine"><input type="checkbox" checked=${mine} onChange=${(e) => setMine(e.target.checked)} /><span>להתאים לנתונים שלנו <span class="faint">(מחושב בטלפון)</span></span></label>
    ${d.items.map((it, i) => {
      const own = mine ? personalLine(it.topic, data) : null;
      return html`<article class="card news-item" key=${i}>
        <span class="news-cat">${TOPIC[it.topic] || TOPIC.other}</span>
        <h3>${it.title}</h3>
        <p>${it.summary}</p>
        <div class=${'news-you' + (own ? '' : ' general')}><span aria-hidden="true">${own ? '👨‍👩‍👧' : '💡'}</span><span><b>${own ? 'מה זה אומר עליכם: ' : 'מה זה אומר למשפחות: '}</b>${own || it.families}</span></div>
        <div class="news-foot"><span class="faint">מקור: <a href=${it.source.link} target="_blank" rel="noopener">${it.source.name}</a></span>
          ${it.question && html`<button type="button" class="chip" aria-expanded=${String(open === i)} onClick=${() => setOpen(open === i ? null : i)}>✨ ${it.question}</button>`}</div>
        ${open === i && html`<p class="news-answer">${it.answer}</p>`}
      </article>`;
    })}
    ${d.term && html`<section class="card news-term">
      <span class="muted" style="font-size:13px">המונח של היום</span>
      <b class="news-h">${d.term.name}</b>
      <p>${d.term.explain}</p>
      ${d.term.quiz && html`<div class="stack" style="gap:6px"><b style="font-size:15px">${d.term.quiz.q}</b>
        ${d.term.quiz.options.map((o, i) => html`<button type="button" class=${'quiz-opt' + (pick === null ? '' : i === d.term.quiz.correct ? ' right' : i === pick ? ' wrong' : '')} disabled=${pick !== null} onClick=${() => setPick(i)}>${o}</button>`)}
        ${pick !== null && html`<span role="status" class="muted">${pick === d.term.quiz.correct ? 'נכון!' : 'כמעט. התשובה הנכונה מסומנת.'}</span>`}</div>`}
    </section>`}
    <p class="adv-legal">מידע כללי בלבד, לא ייעוץ השקעות, מס או פנסיה. התקצירים נכתבים בעזרת בינה מלאכותית ועלולים לטעות; הפרטים המלאים במקור המקושר.</p>
  </div>`;
}
