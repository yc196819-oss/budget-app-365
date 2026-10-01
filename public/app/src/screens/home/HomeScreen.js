import { html } from '../../lib/html.js';
import { SoonCard } from '../../components/SoonCard.js';

export function HomeScreen() {
  return html`
    <div class="stack">
      <section class="hero rise">
        <span style="font-weight:700;color:var(--hero-muted)">נשאר להוציא החודש</span>
        <span class="display num" style="font-size:52px;line-height:1">—</span>
        <span style="font-weight:600;color:var(--hero-muted)">יופיע כאן בשלב 2, מהתנועות שלכם</span>
      </section>
      <${SoonCard} stage="שלב 2" title="מסך הבית"
        items=${['נשאר להוציא החודש וכסף פנוי בחשבון', 'דברים שדורשים תשומת לב, עם פעולה אחת לכל דבר', 'התרעה לפני חגים ובדיקה רבעונית', 'המושג של היום מפינת הלמידה']} />
    </div>`;
}
