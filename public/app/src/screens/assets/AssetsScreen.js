import { html } from '../../lib/html.js';
import { SoonCard } from '../../components/SoonCard.js';

export function AssetsScreen() {
  return html`<${SoonCard} stage="שלב 4" title="נכסים"
    items=${['חשבונות וכרטיסי אשראי', 'הלוואות, חובות ותשלומים', 'חיסכון לטווח ארוך: השקעות ופנסיה']} />`;
}
