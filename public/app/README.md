# The new app

Served at `/app/`. The current app (`public/index.html`) keeps working at `/`
until the new one replaces it.

No build step: native ES modules, Preact + htm for components. The server
serves the three libraries from `node_modules` (`/app/vendor/*`), so the page
needs no CDN and runs under a strict Content-Security-Policy.

```
public/app/
  index.html     shell and import map (the only inline code, allowed by its hash in the CSP)
  styles/        tokens (colors, light/dark), base, layout (mobile + desktop)
  src/
    main.js      entry point
    config.js    public client config (Supabase URL + anon key)
    app/         App root, Shell (layout), hooks: useRoute, useSession
    components/  shared UI: Icon, BottomNav, Sidebar, AdvisorRail, Sheet, SoonCard
    screens/     one folder per screen: auth, home, money, plans, assets, profile
    domain/      pure logic (formatting, routes; later budget and forecast), unit-tested
    data/        household data store (Supabase reads and writes, undo)
    lib/         html (Preact + htm), Supabase client, api (server calls), storage, toast
```

Rules:
- One home per entity, max depth 2 (tab, then one sheet), no sheet on top of a sheet.
- Same tabs in the same order on mobile and desktop.
- Anything that computes numbers goes in `src/domain/` as a pure function, with tests in `tests/`.

Stages: 0 skeleton, 1 money (done), 2 home, 3 plans, 4 assets, 5 advisor and learning, 6 onboarding.

Tests:
- `npm test`: pure logic and the server (no browser).
- `npm run test:e2e`: the app in Chromium against a fake in-memory Supabase (`tests/e2e/helpers.mjs`). Locally, if Playwright's browser is not installed, point `CHROMIUM_PATH` at a Chromium binary.

Both run in GitHub Actions on every pull request and every push to main.
