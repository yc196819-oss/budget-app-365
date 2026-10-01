import { html } from '../../lib/html.js';
import { SoonCard } from '../../components/SoonCard.js';

export function MoneyScreen() {
  return html`<${SoonCard} stage="שלב 1 · הבא בתור" title="כסף: תנועות, קטגוריות ודוח"
    items=${['דפדוף בין חודשים, וגם 12 החודשים האחרונים', 'חיפוש בכל השנה', 'שינוי קטגוריה שחל על כל בית העסק, עם ביטול', 'העלאת פירוט כרטיס']} />`;
}
