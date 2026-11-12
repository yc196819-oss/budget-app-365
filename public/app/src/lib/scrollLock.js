// While a sheet or dialog is open, the page behind it stays still: no
// scrolling it by a swipe on the dimmed area, nor by scrolling past the end
// of the sheet. Counted, so a sheet opened from a sheet keeps the lock until
// the last one closes.
let open = 0;
export function lockScroll() {
  open++;
  if (open === 1 && typeof document !== 'undefined') document.documentElement.classList.add('sheet-open');
  let done = false;
  return () => {
    if (done) return;
    done = true;
    open = Math.max(0, open - 1);
    if (!open && typeof document !== 'undefined') document.documentElement.classList.remove('sheet-open');
  };
}
