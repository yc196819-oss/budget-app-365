// Category color: stable per category id, same palette and hash as the current app.
const PALETTE = ['#E8894A', '#5B9BC8', '#D4A93A', '#3FA898', '#E0705E', '#4FAF78', '#C98A52', '#CF7FA8', '#7E93D1', '#A98BC9'];

export function catColor(id) {
  if (!id) return '#8d93ac';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
