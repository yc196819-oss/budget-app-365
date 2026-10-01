import { html } from '../../lib/html.js';
import { SoonCard } from '../../components/SoonCard.js';

export function PlansScreen() {
  return html`<${SoonCard} stage="שלב 3" title="תוכניות"
    items=${['החודשים הקרובים: משפט אחד, עד שתי פעולות ועמודות פשוטות', 'תקציב לכל קטגוריה', 'יעדים, כולל חיסכון קבוע לחופשות', 'לבדוק החלטה לפני שעושים אותה']} />`;
}
