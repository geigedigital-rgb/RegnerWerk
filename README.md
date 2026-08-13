# RegnerWerk — Konfigurator

Sofort planner / Fertigpaket-Konfigurator (second domain).

| Role | Repo |
|------|------|
| Marketing site | [RegnerWerk-WebSite](https://github.com/geigedigital-rgb/RegnerWerk-WebSite) — port **3000** |
| **This app** | [RegnerWerk](https://github.com/geigedigital-rgb/RegnerWerk) — port **3002** |
| Admin | [RegnerWerk-Backend](https://github.com/geigedigital-rgb/RegnerWerk-Backend) — port **3001** |

```bash
cp .env.example .env.local   # set Mapbox + API
npm install
npm run dev                  # http://localhost:3002/konfigurator
```

## Railway

New service → GitHub `RegnerWerk` → branch **`main`**.

Variables (build + runtime; `NEXT_PUBLIC_*` must be set before build):

| Variable | Notes |
|----------|--------|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox public token |
| `NEXT_PUBLIC_API_URL` | Admin/API base (projects submit) |
| `NEXT_PUBLIC_SITE_URL` | Marketing site URL (Beratung CTAs) |
| `NEXT_PUBLIC_PROJECTS_SUBMIT_TOKEN` | Optional, if backend requires it |

Entry: `/konfigurator` · healthcheck: `/konfigurator`

Design: [DESIGN.md](./DESIGN.md) · Planner notes: [KONFIGURATOR.md](./KONFIGURATOR.md)
