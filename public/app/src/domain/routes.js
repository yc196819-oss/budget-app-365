// The tabs, in the same order on mobile and desktop. Hash routing
// (#/money) so the server only ever serves one HTML file.

export const TABS = [
  { key: 'home', label: 'בית', icon: 'home' },
  { key: 'money', label: 'כסף', icon: 'money' },
  { key: 'shop', label: 'קניות', icon: 'cart' },
  { key: 'plans', label: 'יעדים', icon: 'plans' },
  { key: 'assets', label: 'נכסים', icon: 'assets' }
];
// Off the menu but still reachable from old links and notifications
// (a shared decision's conversation).
export const HIDDEN_TABS = [{ key: 'together', label: 'ביחד', icon: 'together' }];
const ALL = [...TABS, ...HIDDEN_TABS];

export const DEFAULT_TAB = 'home';

export function parseRoute(hash) {
  const key = String(hash || '').replace(/^#\/?/, '').split(/[/?]/)[0];
  return ALL.some((t) => t.key === key) ? key : DEFAULT_TAB;
}

export function hrefFor(tab) {
  return '#/' + tab;
}

// "#/money/cats" -> "cats": a view inside a tab, for links from other screens.
export function routeView(hash) {
  return String(hash || '').replace(/^#\/?/, '').split(/[/?]/)[1] || '';
}

export function tabLabel(key) {
  return (ALL.find((t) => t.key === key) || TABS[0]).label;
}
