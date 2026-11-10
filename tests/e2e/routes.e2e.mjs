import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './helpers.mjs';

// Every route written in the server answers: none is lost inside another
// route's code (a broken merge once hid all the price routes, so the owner's
// "load the catalog" got "not found").
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'budget-ai-server.js'), 'utf8');
const routes = [...src.matchAll(/^app\.(get|post|put|patch|delete)\('(\/api\/[^']+)'/gm)].map((m) => [m[1].toUpperCase(), m[2].replace(/:[a-zA-Z]+/g, 'abc123')]);
const nested = [...src.matchAll(/^ +app\.(get|post|put|patch|delete)\('\/api\//gm)];

let server;
before(async () => { server = await startServer(); });
after(() => server?.stop());

test('every route is written at the top level, not inside another route', () => {
  assert.ok(routes.length > 50, 'routes found: ' + routes.length);
  assert.equal(nested.length, 0);
});

test('every route answers (not the catch-all "not found")', async () => {
  const lost = [];
  for (const [method, p] of routes) {
    const r = await fetch(server.base + p, { method, headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}', redirect: 'manual' });
    const body = await r.text();
    if (r.status === 404 && body.includes('"not found"')) lost.push(method + ' ' + p);
  }
  // Routes that look a thing up by its id may say "not found" for a made-up id.
  const byId = lost.filter((x) => !/abc123/.test(x));
  assert.deepEqual(byId, []);
  assert.ok(!lost.includes('POST /api/admin/prices/seed'));
});
