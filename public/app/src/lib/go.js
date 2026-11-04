// "Take me there", from anywhere (the advisor's instant answers): a tab
// with its view ("money/manage"), or a sheet over any screen ("import",
// "profile/data"). The shell listens and goes.
export const OVERLAYS = ['add', 'import', 'learn', 'profile'];

export function go(target) {
  if (!target) return;
  window.dispatchEvent(new CustomEvent('app:go', { detail: String(target) }));
}

// "profile/data" -> { overlay: 'profile', view: 'data' }; "money/cats" -> { hash: '#/money/cats' }
export function parseGo(target) {
  const [head, view = ''] = String(target || '').split('/');
  if (OVERLAYS.includes(head)) return { overlay: head, view };
  return { hash: '#/' + head + (view ? '/' + view : '') };
}
