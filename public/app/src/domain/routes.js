// The four tabs, in the same order on mobile and desktop. Hash routing
// (#/money) so the server only ever serves one HTML file.

export const TABS = [
  { key: 'home', label: 'בית', icon: 'home' },
  { key: 'money', label: 'כסף', icon: 'money' },
  { key: 'plans', label: 'תוכניות', icon: 'plans' },
  { key: 'assets', label: 'נכסים', icon: 'assets' }
];

export const DEFAULT_TAB = 'home';

export function parseRoute(hash) {
  const key = String(hash || '').replace(/^#\/?/, '').split(/[/?]/)[0];
  return TABS.some((t) => t.key === key) ? key : DEFAULT_TAB;
}

export function hrefFor(tab) {
  return '#/' + tab;
}

// "#/money/cats" -> "cats": a view inside a tab, for links from other screens.
export function routeView(hash) {
  return String(hash || '').replace(/^#\/?/, '').split(/[/?]/)[1] || '';
}
