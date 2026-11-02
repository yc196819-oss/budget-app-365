// A way out when the app stays on "loading": plain script, separate from the
// app's modules, so it works even when they fail to load. If the loading
// screen is still showing after a while, it offers to reload a clean copy of
// the app, or to sign in again. Nothing here touches the household's data.
(function () {
  var WAIT_MS = 12000;
  var box = null;
  function stuck() { return !!document.querySelector('#root .boot'); }
  function cleanReload(signOut) {
    var jobs = [];
    try {
      if (signOut) Object.keys(localStorage).forEach(function (k) { if (/^sb-.*-auth-token/.test(k)) localStorage.removeItem(k); });
    } catch (_e) { /* storage blocked */ }
    try { if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })); } catch (_e) { /* no worker */ }
    try { if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); })); } catch (_e) { /* no caches */ }
    var go = function () { location.replace('/app/'); };
    Promise.all(jobs).then(go, go);
    setTimeout(go, 3000);
  }
  function button(text, primary, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = primary ? 'btn' : 'btn-text';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }
  function show() {
    if (box || !stuck()) return;
    box = document.createElement('div');
    box.className = 'rescue card';
    box.setAttribute('role', 'alert');
    var title = document.createElement('b');
    title.textContent = 'הטעינה לוקחת יותר מדי זמן';
    var text = document.createElement('span');
    text.textContent = 'אפשר לטעון את האפליקציה מחדש. הנתונים שלכם שמורים ולא יימחקו.';
    box.appendChild(title);
    box.appendChild(text);
    box.appendChild(button('לטעון מחדש', true, function () { cleanReload(false); }));
    box.appendChild(button('להתחבר מחדש', false, function () { cleanReload(true); }));
    document.body.appendChild(box);
  }
  setTimeout(show, WAIT_MS);
  // Once the app moves on by itself, the offer goes away.
  setInterval(function () { if (box && !stuck()) { box.remove(); box = null; } }, 1000);
}());
