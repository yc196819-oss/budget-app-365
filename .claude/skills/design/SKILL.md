---
name: design
description: The visual language of "התקציב שלנו" (tokens, fonts, radii, motion, RTL). Use before writing or changing any CSS, markup or SVG in public/app, so new UI matches the existing look instead of inventing a new one.
---

# Design rules for this app

Adapted from Anthropic's official `frontend-design` skill
(github.com/anthropics/claude-plugins-official). That skill pushes toward a
new, distinctive identity. **This one does the opposite:** the identity
already exists and was approved. The job is to stay inside it. Take from the
original only its quality floor, restraint, self-critique and writing advice.

## Hard rules

1. **No new colours.** Every colour comes from `public/app/styles/tokens.css`
   via `var(--…)`. No new hex, `rgb()`, `rgba()`, `hsl()`.
   `npm run design:check` enforces this in CI. If a needed colour has no
   token, stop and ask the user. Don't add a token on your own.
2. **No change to the identity** (palette, fonts, the warm espresso/gold
   feel, Hebrew wording style) without asking the user first.
3. **Preview before building** a visible change (CLAUDE.md): a screenshot or a
   prototype, then wait for approval.
4. Keep RTL, accessibility, behaviour and data exactly as they are unless the
   task is to change them.

## Colour tokens

Dark is the default. Light follows the system, or `data-theme="light"`.
Each token has a value per theme, so never hard-code either theme's value.

| Token | Use |
|---|---|
| `--bg`, `--surface`, `--surface-2` | page, cards, raised or inner areas |
| `--line` | borders, dividers |
| `--text`, `--muted`, `--faint` | main text, secondary text, least important text |
| `--accent`, `--accent-ink`, `--accent-tint` | main action (gold in dark, brown in light), the text on it, soft highlight |
| `--income`, `--income-tint` | money in, success |
| `--danger`, `--danger-tint` | money out over the limit, errors |
| `--warn`, `--warn-tint` | warnings |
| `--hero-bg`, `--hero-text`, `--hero-muted`, `--hero-track` | the month card |
| `--nav` | bottom nav and sidebar |
| `--scrim` | behind sheets and dialogs |

For a transparent version of a colour, use the matching `-tint` token.

## Type

- Body: `var(--font)`: **Assistant** (400/600/700/800). Display and headings:
  `var(--font-display)`: **Frank Ruhl Libre** (500/700), or the `.display` class.
- Fonts are self-hosted (`fonts.css`). Never load from Google or any CDN.
- Sizes in use: 15px body, 14/13/12px secondary, 16px inputs (stops iOS
  zooming), 30px screen title. Pick one of the existing sizes, don't add new ones.
- Weights: labels and buttons are 800. Don't add new weights.
- Money and numbers: wrap in `.num` (LTR, isolated) so they read correctly
  inside Hebrew text.

## Shape

- Radii tokens: `--radius-s` 12px, `--radius-m` 16px (buttons, inputs),
  `--radius-l` 22px (cards), `--radius-xl` 28px (sheet tops). Pills use
  `999px`, round icons use `50%`.
- Prefer the tokens. Older rules use raw px values. Don't add new radius values.
- Touch targets: buttons are at least 48px tall, icon buttons 44×44.

## Motion (`motion.css`)

- Easings: `var(--out)` for entrances, `var(--spring)` for pops.
  Keyframes that already exist: `rise`, `pop`, `fade-in`, `sheet-in`, `grow-x`, `grow-y`, `toast-in`.
- Reuse these before writing a new animation. Keep durations at 0.14–0.5s for
  feedback and under about 1s for reveals.
- Motion answers the user (press, open, confirm). Don't add decorative
  looping motion. The splash screen is the one exception.
- `prefers-reduced-motion` turns all animation off globally (`base.css`).
  Never use `!important` to force motion back on. If you add a key moment,
  add a still fallback for it, the way `.splash` does.

## RTL

- The page is `<html lang="he" dir="rtl">`. The start of a line is on the right.
- Use logical properties: `inset-inline`, `margin-inline-start`,
  `padding-inline-end`, `text-align: start`. Avoid `left`/`right` in new
  code unless something is physically placed (like the `.ask-fab`).
- Things that grow or point follow the reading direction: bars grow from the
  right (`transform-origin: right`), and a hover "forward" nudge is
  `translateX(-2px)`. Mirror with `[dir="ltr"]` where needed.
- Arrow icons that mean "next" point left.

## Accessibility floor

- Text contrast passes WCAG AA in **both** themes. The tokens are tuned for
  this, which is another reason not to hand-pick colours.
- Visible focus: the global `:focus-visible` outline in `--accent` stays. Don't remove outlines.
- Real buttons and labels. Icons-only buttons need `aria-label` in Hebrew.
- `tests/e2e/a11y.e2e.mjs` runs axe (WCAG 2 A/AA) on every main screen in
  light and dark. Run it after any visual change.

## Writing in the UI

Plain, short Hebrew, from the user's side. A button says what happens
("שמירה", not "שליחה"), and the same action keeps the same name across the
flow. Errors say what happened and how to fix it, without apologising. Use
made-up names and amounts in examples (public repo).

## Before you finish

1. `npm run design:check`: the count must not go up. If you removed raw
   colours, lower the baseline with `npm run design:check -- --update`.
2. `npm test` and the relevant e2e tests, including `a11y.e2e.mjs`.
3. Take a screenshot in light and in dark and look at it. Ask yourself
   whether it looks like it was always part of the app. Then remove one thing
   that isn't needed.
