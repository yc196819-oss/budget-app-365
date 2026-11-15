import { html } from '../../lib/html.js';
import { Loading } from '../../components/Loading.js';
import { useState } from 'preact/hooks';
import { Segmented } from '../../components/Segmented.js';
import { routeView } from '../../domain/routes.js';
import { summary, symbolsOf, investDeposits, withDeposits } from '../../domain/assets.js';
import { useMarket } from '../../data/market.js';
import { AssetsHero } from './AssetsHero.js';
import { DailyView } from './DailyView.js';
import { LongView } from './LongView.js';
import { AccountSheet } from './AccountSheet.js';
import { InvestmentSheet } from './InvestmentSheet.js';
import { LoanSheet } from './LoanSheet.js';
import { CardSheet } from './CardSheet.js';
import { PropertiesView, propertiesTotals } from './PropertiesView.js';
import { PropertySheet } from './PropertySheet.js';
import { useProperties } from '../../data/property.js';

const VIEWS = [{ key: 'daily', label: 'יומיומי' }, { key: 'long', label: 'לטווח ארוך' }];
// Apartments and mortgages: for now on the owner's board only.
const HOMES = { key: 'homes', label: 'דירות ומשכנתא' };

// What the household has and owes. One sheet at a time:
// { kind: 'account' | 'card' | 'investment' | 'pension' | 'loan' | 'property', id: string | null (new) } | null
export function AssetsScreen({ data, userId, owner = false }) {
  const views = owner ? [...VIEWS, HOMES] : VIEWS;
  const [picked, setView] = useState(() => routeView(location.hash) || 'daily');
  const view = views.some((v) => v.key === picked) ? picked : 'daily';
  const [sheet, setSheet] = useState(null);
  // Loaded only for the owner (everyone else never asks for the table).
  const props = useProperties(owner ? data.hid : null);
  const { market, error: marketError } = useMarket(data.status === 'ready' ? symbolsOf(data.investments) : []);

  if (data.status === 'loading' || data.status === 'idle') return html`<${Loading} label="טוען…" />`;
  if (data.status === 'error') {
    return html`<div class="card empty" role="alert"><b style="color:var(--text)">לא הצלחנו לטעון את הנתונים</b><span>${data.error}</span>
      <button type="button" class="btn btn-ghost" onClick=${data.reload}>לנסות שוב</button></div>`;
  }
  const today = new Date();
  // The apartments see their own accounts' lines too (kept out of the household's month).
  const allTxs = data.apartmentTxs && data.apartmentTxs.length ? [...data.txs, ...data.apartmentTxs] : data.txs;
  // What went into investments, from the sorted lines: no typing needed.
  const deposits = investDeposits(data.txs, data.categories, today);
  // The investments with what the lines say: deposits kept up to date, and
  // places money went to listed on their own.
  const investments = withDeposits(data.investments, deposits.places);
  const s = summary({ ...data, investments, market, today, properties: owner && props.status === 'ready' ? props.list : [] });
  const open = (kind, id = null) => setSheet({ kind, id });
  const close = () => setSheet(null);
  const find = (list) => (sheet && sheet.id ? list.find((r) => r.id === sheet.id) : null);

  return html`<div class="stack">
    <${Segmented} variant="tabs" label="תצוגה" value=${view} onChange=${setView} options=${views} />
    <${AssetsHero} view=${view} s=${s} deposits=${deposits} homes=${view === 'homes' ? propertiesTotals(props.list, today, allTxs) : null} />
    ${view === 'daily'
      ? html`<${DailyView} data=${data} today=${today} onOpen=${open} userId=${userId} />`
      : view === 'homes'
        ? html`<${PropertiesView} props=${props} today=${today} onOpen=${open} txs=${allTxs} accounts=${data.accounts} />`
        : html`<${LongView} data=${data} investments=${investments} deposits=${deposits} market=${market} marketError=${marketError} onOpen=${open} />`}
    ${sheet && sheet.kind === 'account' && html`<${AccountSheet} account=${find(data.accounts)} onClose=${close} />`}
    ${sheet && (sheet.kind === 'investment' || sheet.kind === 'pension') && html`<${InvestmentSheet} inv=${find(data.investments)} market=${market} pension=${sheet.kind === 'pension'} onClose=${close} />`}
    ${sheet && sheet.kind === 'card' && html`<${CardSheet} card=${find(data.cards)} accounts=${data.accounts} members=${data.members} userId=${userId} onClose=${close} />`}
    ${sheet && sheet.kind === 'loan' && html`<${LoanSheet} loan=${find(data.loans)} today=${today} onClose=${close} />`}
    ${owner && sheet && sheet.kind === 'property' && html`<${PropertySheet} property=${find(props.list)} txs=${allTxs} accounts=${data.accounts} onClose=${close} />`}
  </div>`;
}
