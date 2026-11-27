import { html } from '../../lib/html.js';
import { useEffect, useState } from 'preact/hooks';
import { Sheet } from '../../components/Sheet.js';
import { Icon } from '../../components/Icon.js';
import { CartDraw } from '../../components/CartDraw.js';
import { TEMPLATES, fromTemplate, personal } from '../../domain/shopTemplates.js';
import { shopContext, parseList, LIST_MARK, recipeItems } from '../../domain/shopList.js';
import { RecipeInput } from './RecipeInput.js';
import { personalCart } from '../../data/shopping.js';
import { getKosherPref } from '../../data/prices.js';
import { ShopListCard } from '../advisor/ShopListCard.js';
import { track } from '../../lib/telemetry.js';

const STEPS = ['בודק מה אתם קונים בדרך כלל', 'מתאים לכמות האנשים', 'מסדר לפי מחלקות בסופר'];
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

// "The advisor fills a cart": for the week, Shabbat, a holiday or guests
// (dairy or meat), for the number of people at home. A ready cart, made this
// home's own by the advisor when the home has bought enough before (its
// receipts and lists); shown being filled, then as the advisor's list.
// The kinds offered: the ready ones, and a recipe (a link, its text or a photo).
const KINDS = [...TEMPLATES, { key: 'recipe', label: 'ממתכון', hint: 'קישור, טקסט או תמונה של מתכון' }];

export function CartBuilder({ hid, items, receipts = [], people: homePeople, onClose, onAdded, shared = null, toList = null }) {
  const [kind, setKind] = useState(shared ? 'recipe' : null);
  const [meal, setMeal] = useState(null);
  const [typed, setTyped] = useState(String(homePeople || 4));
  const [list, setList] = useState(null);
  const [step, setStep] = useState(-1); // -1: choosing; 0..: filling
  const [ctx, setCtx] = useState(null);
  // "0", "45" or nothing is not quietly made another number: the cart says
  // how many it is for, so the number must be one it can be for.
  const typedN = Math.round(Number(String(typed).trim()));
  const validPeople = String(typed).trim() !== '' && typedN >= 1 && typedN <= 30;
  const people = validPeople ? typedN : Math.max(1, Math.min(30, Number(homePeople) || 4));
  const ready = kind && (kind !== 'guests' || meal) && validPeople;

  useEffect(() => {
    if (step < 0 || step >= STEPS.length) return undefined;
    const t = setTimeout(() => setStep((s) => s + 1), 650);
    return () => clearTimeout(t);
  }, [step]);

  // A recipe read: its ingredients, sized for the people, are the cart.
  const fromRecipe = async (r) => {
    setStep(0);
    track('shop_cart_recipe');
    const kosher = await getKosherPref(hid).catch(() => null);
    setCtx(shopContext({ items, receipts, people, kosher }));
    await wait(1600);
    setList({ title: r.title || 'מתכון', people, kosher: '', items: recipeItems(r, people) });
  };
  const build = async () => {
    setStep(0);
    track('shop_cart_build', { kind });
    const kosher = await getKosherPref(hid).catch(() => null);
    const c = shopContext({ items, receipts, people, kosher });
    setCtx(c);
    const cart = fromTemplate(kind, people, { meal: meal || 'meat', kosher: Array.isArray(kosher) && kosher.length ? kosher[0] : '' });
    let out = cart;
    // The home's own buying: the advisor adapts the ready cart to it.
    if (personal(c.usual)) {
      try {
        const j = await personalCart(cart, c.usual, c.onList);
        const p = j && parseList(LIST_MARK + JSON.stringify(j));
        if (p) out = { ...p, people: cart.people, personal: true };
      } catch (_e) { /* the ready cart stands */ }
    }
    // The filling is shown for a moment at least (it reads as the advisor's work).
    await wait(1800);
    setList(out);
  };

  const filling = step >= 0 && (!list || step < STEPS.length);
  return html`<${Sheet} title="היועץ מכין עגלה" onClose=${onClose}>
    <div class="stack cart-builder">
      ${step < 0 && html`
        <span class="muted" style="font-size:14px;line-height:1.55">בחרו לאיזה צורך, והיועץ ימלא את העגלה לפי מספר האנשים${receipts.length ? ' ולפי מה שאתם קונים בדרך כלל' : ''}.</span>
        <div class="cb-kinds" role="radiogroup" aria-label="לאיזה צורך">${KINDS.map((t) => html`<button type="button" role="radio" key=${t.key} aria-checked=${String(kind === t.key)} class=${'cb-kind' + (t.key === 'recipe' ? ' wide' : '')} onClick=${() => { setKind(t.key); if (t.key !== 'guests') setMeal(null); }}>
          <b>${t.label}</b><small>${t.hint}</small></button>`)}</div>
        ${kind === 'guests' && html`<div class="cb-meal" role="radiogroup" aria-label="איזו ארוחה">
          <span>איזו ארוחה?</span>
          ${[['dairy', 'חלבית'], ['meat', 'בשרית']].map(([k, l]) => html`<button type="button" role="radio" key=${k} aria-checked=${String(meal === k)} onClick=${() => setMeal(k)}>${l}</button>`)}
        </div>`}
        <label class="cart-people cb-people">כמה אנשים? <input class="cart-num num" type="number" inputmode="numeric" min="1" max="30" value=${typed} aria-label="כמה אנשים" aria-invalid=${String(!validPeople)} aria-describedby=${validPeople ? undefined : 'cb-people-bad'} onInput=${(e) => setTyped(e.currentTarget.value)} /></label>
        ${!validPeople && html`<small id="cb-people-bad" class="trip-bad" role="alert">כמה אנשים? מספר בין 1 ל-30</small>`}
        ${kind === 'recipe'
          ? html`<${RecipeInput} onRecipe=${fromRecipe} start=${shared} />`
          : html`<button type="button" class="btn" disabled=${!ready} onClick=${build}><${Icon} name="spark" size=${16} /> להכין את העגלה</button>`}`}
      ${filling && html`<div class="cart-fill" role="status" aria-live="polite">
        <${CartDraw} />
        <span class="cart-fill-t"><b>היועץ מכין לכם את העגלה…</b>${STEPS.map((s, i) => html`<small key=${i} class=${i < step ? 'done' : i === step ? 'now' : ''}>${i < step ? '✓ ' : ''}${s}</small>`)}</span>
      </div>`}
      ${!filling && list && html`<${ShopListCard} list=${list} hid=${hid} people=${people} onList=${(ctx && ctx.onList) || []} build=${false} onAdded=${onAdded} toList=${toList} />
        <button type="button" class="btn-text" onClick=${() => { setList(null); setStep(-1); }}>עגלה אחרת</button>`}
    </div>
  <//>`;
}
