// Files shared to the app from the phone, kept by the service worker on this
// device until they are uploaded (or dropped). Read here; never sent anywhere
// by themselves.
const SHARED = 'shared-files';
const MAX_AGE = 24 * 3600 * 1000;

export async function sharedFiles() {
  if (!(globalThis.caches && caches.open)) return [];
  try {
    const cache = await caches.open(SHARED);
    const out = [];
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (!res) continue;
      // A day old: forgotten, not left on the device.
      if (Date.now() - Number(res.headers.get('x-at') || 0) > MAX_AGE) { await cache.delete(req); continue; }
      const blob = await res.blob();
      const name = decodeURIComponent(res.headers.get('x-name') || 'file');
      out.push(new File([blob], name, { type: res.headers.get('content-type') || blob.type }));
    }
    return out;
  } catch (_e) { return []; }
}

export async function dropShared() {
  try { if (globalThis.caches) await caches.delete(SHARED); } catch (_e) { /* nothing kept */ }
}
