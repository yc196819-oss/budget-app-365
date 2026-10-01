# The new app (stage 0: skeleton)

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
    lib/         html (Preact + htm), Supabase client, api (server calls), storage
```

Rules:
- One home per entity, max depth 2 (tab, then one sheet), no sheet on top of a sheet.
- Same tabs in the same order on mobile and desktop.
- Anything that computes numbers goes in `src/domain/` as a pure function, with tests in `tests/`.

Stages: 0 skeleton (this), 1 money, 2 home, 3 plans, 4 assets, 5 advisor and learning, 6 onboarding.

Run the tests with `npm test`.
