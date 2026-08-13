<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:design -->
# Design system

Follow **[DESIGN.md](./DESIGN.md)** for all UI: brand, tokens, home sections, configurator, and product decisions. Cursor rule `.cursor/rules/design-system.mdc` always applies.
<!-- END:design -->

<!-- BEGIN:rtk -->
# RTK (Rust Token Killer)

Shell commands are auto-rewritten by the Cursor preToolUse hook (`rtk hook cursor`). Prefer shell for noisy ops so RTK can compress output. Meta: `rtk gain`, `rtk discover`, `rtk proxy <cmd>`. Built-in Read/Grep/Glob bypass the hook — use `rtk read` / `rtk grep` / `rtk find` when you want compact output.
<!-- END:rtk -->

<!-- BEGIN:repos-domains -->
# Repos & domains (ironclad)

Three separate products — never mix folders, remotes, or domains:

1. **Marketing site** — `RegnerWerk-Web-site/RegnerWerk-WebSite` → [RegnerWerk-WebSite](https://github.com/geigedigital-rgb/RegnerWerk-WebSite) (site domain)
2. **Configurator (this repo)** — `RegnerWerk` → [RegnerWerk](https://github.com/geigedigital-rgb/RegnerWerk) (configurator domain)
3. **Admin backend** — `RegnerWerk-Backend/RegnerWerk-Backend` → [RegnerWerk-Backend](https://github.com/geigedigital-rgb/RegnerWerk-Backend) (admin domain)

Cursor rule `.cursor/rules/repos-domains.mdc` always applies.
<!-- END:repos-domains -->
