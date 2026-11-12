import { html } from '../../lib/html.js';
import { Icon } from '../../components/Icon.js';
import { useState } from 'preact/hooks';
import { sendReengage, mailHistory } from '../../data/account.js';

// The owner's email board: four numbers on top, then three tabs. "To send"
// (each email, who it is for, how many are waiting, how it did), "History"
// (who got which, clicked, uploaded after it) and "Unsubscribed".
const when = (iso) => { if (!iso) return ''; const d = new Date(iso); return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const hm = (iso) => when(iso).slice(6);
const dm = (iso) => String(iso || '').slice(5, 10).split('-').reverse().join('.');
const pctOf = (n, of) => (of ? Math.round((n / of) * 100) : 0);
const COLORS = ['#B5651D', '#4F7A5A', '#2F5E8C', '#8A4F7D', '#7A6A2F'];
const avatarOf = (r) => {
  const ch = r.name ? r.name.trim()[0] : '#';
  const n = [...String(r.code || r.name || '')].reduce((a, c) => a + c.charCodeAt(0), 0);
  return html`<span class="mb-av" aria-hidden="true" style=${'background:' + (r.ok === false ? 'var(--danger)' : COLORS[n % COLORS.length])}>${ch}</span>`;
};
const personOf = (r) => html`<span class="mh-who"><b><bdi>${r.name || r.code}</bdi>${r.email && html` · <small class="faint"><bdi>${r.email}</bdi></small>`}</b></span>`;
const PROVIDER = { resend: 'Resend', smtp: 'Gmail / SMTP', 'google-gmail': 'Gmail' };

function Kpis({ k, stopped }) {
  const tile = (cls, label, big, sub, bar) => html`<div class=${'mb-kpi ' + cls}><small>${label}</small><b class="num">${big}</b>${bar != null && html`<span class="mb-kbar" aria-hidden="true"><i style=${'width:' + bar + '%'}></i></span>`}${sub && html`<i>${sub}</i>`}</div>`;
  return html`<div class="mb-kpis">
    ${k && tile('', 'נשלחו החודש', k.month.sent, k.month.failed ? html`<span style="color:var(--danger)">נכשלו ${k.month.failed}</span>` : 'לא נכשל אף אחד')}
    ${k && tile('', 'לחצו על הכפתור', k.clickPct == null ? '–' : k.clickPct + '%', k.went ? k.clicked + ' מתוך ' + k.went + ' מיילים' : 'עוד לא נשלח', k.clickPct || 0)}
    ${k && tile('', 'העלו פירוט אחרי המייל', k.uploaded, k.people ? 'מתוך ' + k.people + ' שקיבלו מייל (עד שבועיים אחרי)' : '')}
    ${tile('campaign-stopped', 'ביקשו הסרה', stopped || 0, k && k.stoppedPct != null ? k.stoppedPct + '% מכל מי שקיבל' : '')}
  </div>`;
}

// A drawing of the email, small: lines, and its picture if it has one.
const Thumb = ({ image }) => html`<span class="mb-thumb" aria-hidden="true"><i></i><i class="s"></i>${image ? html`<img src=${image} alt="" loading="lazy" />` : html`<i></i><i class="s"></i>`}<i class="b"></i></span>`;

function History({ d, show, setShow }) {
  const tabs = [['all', 'הכול', d.rows.length], ['clicked', 'לחצו', d.rows.filter((r) => r.clicked).length], ['uploaded', 'העלו אחרי', d.rows.filter((r) => r.uploaded).length], ['failed', 'נכשלו', d.rows.filter((r) => !r.ok).length]];
  const rows = d.rows.filter((r) => show === 'all' || (show === 'clicked' && r.clicked) || (show === 'uploaded' && r.uploaded) || (show === 'failed' && !r.ok));
  return html`<div class="stack mail-history">
    <ul class="mh-sum">${Object.entries(d.byCampaign).map(([id, c]) => html`<li key=${id}><span>${c.title}</span><span class="num">נשלח ${c.sent}${c.sent ? ' · לחצו ' + c.clicked + ' (' + pctOf(c.clicked, c.sent) + '%)' : ''}${c.uploaded ? ' · העלו ' + c.uploaded : ''}${c.failed ? ' · נכשל ' + c.failed : ''}</span></li>`)}</ul>
    <div class="chips" role="group" aria-label="סינון">${tabs.map(([k, label, n]) => html`<button type="button" class="chip" key=${k} aria-pressed=${show === k} onClick=${() => setShow(k)}>${label} (${n})</button>`)}</div>
    ${rows.length ? html`<ul class="mh-list mb-list">${rows.map((r, i) => html`<li key=${i}>${avatarOf(r)}<span class="mb-row-main">${personOf(r)}<small class="faint">${r.title} · ${when(r.at)}</small></span>
      <span class="mb-trail">${r.ok ? html`<span class="mb-step">נשלח</span>` : html`<span class="mb-step bad">נכשל</span>`}${r.clicked && html`<span class="mb-arrow" aria-hidden="true">←</span><span class="mb-step blue">לחץ ${hm(r.clicked)}</span>`}${r.uploaded && html`<span class="mb-arrow" aria-hidden="true">←</span><span class="mb-step ok">העלה פירוט ✓</span>`}</span></li>`)}</ul>` : html`<span class="muted">אין מיילים כאן.</span>`}
    <span class="faint" style="font-size:12px;line-height:1.5">"לחץ" = נכנס לאפליקציה מהכפתור שבמייל (רק אצל מי שלא כיבה ספירת שימוש). "העלה פירוט" = העלה פירוט עד שבועיים אחרי המייל. פתיחת המייל עצמה לא נספרת כאן: רואים אותה ב-Brevo.</span>
  </div>`;
}

export function MailBoard({ back, setBack }) {
  const [tab, setTab] = useState('send');
  const [hist, setHist] = useState(false);
  const [show, setShow] = useState('all');
  const [sure, setSure] = useState('');
  const [busy, setBusy] = useState('');
  const [peek, setPeek] = useState('');
  const [job, setJob] = useState({});
  const setJ = (id, j) => setJob((all) => ({ ...all, [id]: j && { ...(all[id] || {}), ...j } }));
  // History and the unsubscribed list are loaded only when asked for.
  const openTab = (t) => {
    setTab(t);
    if (t !== 'send' && hist === false) { setHist(undefined); mailHistory().then(setHist).catch(() => setHist(null)); }
  };
  const send = async (c) => {
    if (sure !== c.id) { setSure(c.id); return; }
    setSure(''); setBusy(c.id);
    const total = c.count;
    setJ(c.id, { kind: 'send', phase: 'sending', step: 1, total, sent: 0, failed: 0, error: '' });
    let sent = 0, failed = 0, error = '';
    try {
      // One at a time, so the bar shows the real progress.
      for (let guard = 0; guard < 500; guard++) {
        const r = await sendReengage(c.id, { limit: 1 });
        sent += r.sent || 0; failed += r.failed || 0; if (r.error) error = r.error;
        setJ(c.id, { step: 2, sent, failed, error });
        if (!r.left || (!r.sent && !r.failed)) break;
      }
      // Nothing went and nothing failed: no one was emailed, say so.
      if (!sent && !failed) error = error || 'אף מייל לא נשלח. ייתכן שכל מי שברשימה כבר קיבל מייל השבוע. נסו שוב מחר, או כתבו לנו.';
      setJ(c.id, { phase: !sent ? 'error' : 'done', step: 3, error });
      setBack((bk) => ({ ...bk, campaigns: bk.campaigns.map((x) => (x.id === c.id ? { ...x, count: Math.max(0, x.count - sent - failed) } : x)) }));
      if (hist) mailHistory().then(setHist).catch(() => {});
    } catch (err) { setJ(c.id, { phase: 'error', error: err.message || 'השליחה נכשלה. נסו שוב.' }); }
    setBusy('');
  };
  const test = async (c) => {
    setBusy('t' + c.id);
    setJ(c.id, { kind: 'test', phase: 'sending', step: 1, error: '' });
    const t = setTimeout(() => setJ(c.id, { step: 2 }), 700);
    try {
      const r = await sendReengage(c.id, { test: true });
      clearTimeout(t);
      setJ(c.id, { phase: 'done', step: 3, to: r.to, provider: r.provider || '' });
    } catch (err) { clearTimeout(t); setJ(c.id, { phase: 'error', error: err.message || 'הניסיון לא נשלח.' }); }
    setBusy('');
  };
  const jobView = (c) => {
    const j = job[c.id];
    if (!j) return null;
    const active = j.phase === 'sending';
    const steps = j.kind === 'test'
      ? ['מכינים את המייל עם העיצוב', 'שולחים לשרת המיילים', 'השרת קיבל את המייל']
      : ['מכינים את רשימת הנמענים', 'שולחים אחד אחד', 'סיימנו'];
    const pct = j.kind === 'send' && j.total ? pctOf(j.sent + j.failed, j.total) : 0;
    return html`<div class=${'mail-job ' + (active ? 'is-active' : j.phase === 'error' ? 'is-error' : 'is-done')} role="status" aria-live="polite">
      <div class="mail-fly" aria-hidden="true"><span class="mail-env"><${Icon} name="mail" size=${20} /></span><span class="mail-trail"></span></div>
      <ol class="mail-steps">${steps.map((st, i) => {
        const n = i + 1;
        const state = j.phase === 'error' && n >= (j.step || 1) ? 'fail' : n < (j.step || 1) || (n === 3 && j.phase === 'done') ? 'ok' : n === j.step && active ? 'now' : 'wait';
        return html`<li class=${'st-' + state} key=${n}><span class="st-dot">${state === 'ok' ? '✓' : state === 'fail' ? '✗' : ''}</span>${st}</li>`;
      })}</ol>
      ${j.kind === 'send' && html`<div class="mail-bar" aria-hidden="true"><i style=${'width:' + pct + '%'}></i></div>
        <span class="mail-count">נשלחו <b class="num">${j.sent}</b> מתוך <b class="num">${j.total}</b>${j.failed ? html` · <span style="color:var(--danger)">${j.failed} לא נשלחו</span>` : ''}</span>`}
      ${j.phase === 'done' && j.kind === 'test' && html`<span class="mail-result">נשלח אל <bdi dir="ltr">${j.to}</bdi>${j.provider ? ' דרך ' + (PROVIDER[j.provider] || j.provider) : ''}. אם לא הגיע תוך כמה דקות, בדקו בספאם.</span>`}
      ${j.error && html`<span class="mail-result" style="color:var(--danger)">${j.error}</span>`}
    </div>`;
  };
  const ready = !back.mail || back.mail.ready;
  const waiting = back.campaigns.filter((c) => c.count > 0).length;
  // Emails waiting for people come first; within them, ones never sent.
  const rank = (c) => (c.count > 0 ? 0 : 2) + (c.done && (c.done.sent || c.done.failed) ? 1 : 0);
  const order = [...back.campaigns].sort((a, b) => rank(a) - rank(b));
  const card = (c) => {
    const d = c.done || { sent: 0, failed: 0 };
    const fresh = c.count > 0 && !d.sent && !d.failed;
    return html`<div class=${'campaign mb-mail campaign-' + c.id + (fresh ? ' is-new' : '')} key=${c.id}>
      <${Thumb} image=${c.image} />
      <div class="mb-mail-body">
        <span class="mb-who">${c.title}${fresh ? ' · חדש' : ''}</span>
        <b class="mb-subj">${c.preview.subject}</b>
        <span class="mb-count"><b class="num">${c.count}</b><span>${c.count ? 'אנשים מחכים' : 'אין כרגע למי לשלוח'}</span></span>
        <span class="mb-tags">${fresh && html`<span class="mb-tag new">עוד לא נשלח</span>`}
          ${(d.sent > 0 || d.failed > 0) && html`<span class="campaign-done mb-tag ok">נשלח ל-${d.sent}${d.sent ? ' · לחצו ' + (d.clicked || 0) + ' (' + pctOf(d.clicked || 0, d.sent) + '%)' : ''}${d.uploaded ? ' · העלו ' + d.uploaded : ''}${d.failed ? ' · נכשל ' + d.failed : ''}${d.last ? ' · אחרון ' + dm(d.last) : ''}</span>`}</span>
        <div class="mb-acts">
          ${c.count > 0 && ready && html`<button type="button" class=${'btn mb-btn' + (sure === c.id ? ' is-sure' : '')} disabled=${!!busy} onClick=${() => send(c)}>${busy === c.id ? 'שולח…' : sure === c.id ? 'בטוח? לשלוח עכשיו ל-' + c.count : 'לשלוח ל-' + c.count}</button>`}
          <button type="button" class="btn btn-ghost mb-btn" disabled=${!!busy} onClick=${() => test(c)}>${busy === 't' + c.id ? 'שולח…' : 'ניסיון אליי'}</button>
          <button type="button" class="mb-link mb-peek" aria-expanded=${peek === c.id} onClick=${() => setPeek(peek === c.id ? '' : c.id)}>${peek === c.id ? 'להסתיר את המייל' : 'לראות את המייל'}</button>
        </div>
      </div>
      ${peek === c.id && html`<iframe class="mail-preview" src=${'/mail-preview/' + c.id} title=${'המייל: ' + c.preview.subject} sandbox="" loading="lazy"></iframe>`}
      ${jobView(c)}
    </div>`;
  };
  return html`<div class="card stack admin-reengage mail-board">
    <div class="mb-top"><b style="font-size:18px">מיילים למשתמשים</b>${ready ? html`<span class="mb-pill ok">השרת מוכן לשלוח</span>` : html`<span class="mb-pill bad">השרת לא מוכן</span>`}</div>
    ${back.mail && !back.mail.ready && html`<span class="card mail-not-ready" role="status" style="font-size:13px;line-height:1.55;border:1px solid var(--danger)">השרת עוד לא מוגדר לשלוח מיילים למשתמשים${back.mail.resendTestOnly ? ' (Resend מוגדר רק בכתובת הניסיון שלו, שמגיעה רק אליכם)' : ''}. צריך לחבר את Brevo (חינם): BREVO_API_KEY ו-BREVO_FROM בהגדרות השרת ב-Render.</span>`}
    <${Kpis} k=${back.kpis} stopped=${back.stopped} />
    <div class="mb-tabs" role="tablist">
      <button type="button" role="tab" aria-selected=${tab === 'send'} onClick=${() => openTab('send')}>לשלוח${waiting > 0 && html`<small class="num">${waiting}</small>`}</button>
      <button type="button" role="tab" class="mh-open" aria-selected=${tab === 'history'} onClick=${() => openTab('history')}>היסטוריה</button>
      <button type="button" role="tab" class="mh-stopped" aria-selected=${tab === 'stopped'} onClick=${() => openTab('stopped')}>הסירו</button>
    </div>
    ${tab === 'send' && html`
      <span class="muted" style="font-size:13px;line-height:1.55">כל מייל נשלח לכל אדם פעם אחת, לכל היותר מייל אחד בשבוע לאדם, ורק כשלוחצים פעמיים. כדאי לשלוח קודם ניסיון לעצמכם. מי שלחץ "להסרה" לא יקבל יותר אף אחד מהם.</span>
      <div class="mb-grid">${order.map(card)}</div>
      <span class="faint" style="font-size:12px;line-height:1.5">"נשלח" = השרת מסר את המייל ל-Brevo. אם הוא הגיע ונפתח רואים ב-Brevo: Transactional ← Logs.</span>`}
    ${tab !== 'send' && (hist === undefined ? html`<span class="muted">טוען…</span>` : hist === null || hist === false ? html`<span class="muted">ההיסטוריה לא זמינה כרגע.</span>`
      : tab === 'history' ? html`<${History} d=${hist} show=${show} setShow=${setShow} />`
      : hist.stopped.length ? html`<ul class="mh-list mb-list mb-stopped">${hist.stopped.map((r, i) => html`<li key=${i}>${avatarOf({ ...r, ok: false })}<span class="mb-row-main">${personOf(r)}</span><span class="mb-trail"><span class="mb-step bad">ביקש הסרה${r.at ? ' · ' + dm(r.at) : ''}</span></span></li>`)}</ul>` : html`<span class="muted">אף אחד לא ביקש הסרה.</span>`)}
  </div>`;
}
