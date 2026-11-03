import { html } from '../../lib/html.js';
import { useState } from 'preact/hooks';
import { setMyAddress } from '../../data/household.js';
import { genderOf, realName } from '../../domain/people.js';
import { showToast } from '../../lib/toast.js';

// Asked once: the name to call me and whether to say "אתה" or "את", so the
// app and the advisor speak to each person properly.
export function AddressAsk({ data, userId }) {
  const mine = (data.members || {})[userId];
  const [name, setName] = useState(() => realName(mine));
  const [busy, setBusy] = useState(false);
  if (!userId || genderOf(data.genders, userId)) return null;
  const save = async (gender) => {
    setBusy(true);
    try { await setMyAddress({ name, gender }); showToast('תודה! מעכשיו נפנה אליך ככה'); } catch (_e) { showToast('לא נשמר. נסו שוב.'); }
    setBusy(false);
  };
  return html`<div class="card stack address-ask" role="region" aria-label="איך לפנות אליך" style="border-inline-start:4px solid var(--accent)">
    <b>איך לפנות אליך?</b>
    <span class="muted" style="font-size:14px;line-height:1.6">כדי שהאפליקציה והיועץ ידברו אליך בשם ובלשון הנכונה, וגם אצל בן או בת הזוג.</span>
    <label class="field"><span>השם שלך</span>
      <input class="input" value=${name} maxlength="40" autocomplete="given-name" onInput=${(e) => setName(e.target.value)} placeholder="למשל: קובי" /></label>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button type="button" class="btn" style="width:auto" disabled=${busy || !name.trim()} onClick=${() => save('m')}>פנו אליי בלשון זכר</button>
      <button type="button" class="btn" style="width:auto" disabled=${busy || !name.trim()} onClick=${() => save('f')}>פנו אליי בלשון נקבה</button>
    </div>
  </div>`;
}
