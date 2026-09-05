# Ride Analyzer

Ride Analyzer helps drivers log everyday trips and understand fuel economy, speed, traffic wait time, and ride trends.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/ride-analyzer/src/App.tsx` — single-page ride dashboard, calculations, local persistence, and history interactions
- `artifacts/ride-analyzer/src/index.css` — visual theme, responsive layout utilities, and motion
- `artifacts/ride-analyzer/src/main.tsx` — React entry point

## Architecture decisions

- Ride records are stored in browser localStorage so the first version works without account or backend setup.
- Demo rides seed on first visit to make the dashboard useful immediately; the user can reset or clear them.
- Derived values such as moving pace and traffic percentage are calculated from the saved ride inputs.

## Product

Users can record a ride with distance, fuel, duration, traffic wait, speed, price, route, and notes; review calculated economy, cost, moving speed, and traffic share; search history; compare trends; and edit or delete records.

## User preferences

The user wants an app that analyzes rides, including distance traveled, fuel consumption, average speed, top speed, and time waiting in traffic.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
