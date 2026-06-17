# Prelude.ai

Prelude.ai is a focused pre-interview product for SMBs, small mid-market companies, and scale-ups. It helps recruiters turn a job posting into a short guided candidate pre-interview, then review a clear candidate brief before deciding who to call.

This repository is a pnpm/Turborepo monorepo with two Next.js App Router apps and shared packages for UI, design tokens, contracts, data access, and domain logic.

## Apps

- `apps/console`: recruiter console, desktop-first and responsive.
- `apps/candidate`: public candidate micro-app, mobile-first.

## Packages

- `@prelude/ui`: reusable UI components and shells.
- `@prelude/design-system`: design tokens and shared Tailwind preset.
- `@prelude/types`: pure TypeScript business types.
- `@prelude/contracts`: Zod schemas and DTO contracts.
- `@prelude/db`: Prisma schema and client singleton.
- `@prelude/core`: testable business logic and policies.
- `@prelude/config`: shared TypeScript and ESLint config.
- `@prelude/testing`: shared test helpers.

## Local Setup

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm dev
```

The console app runs on `http://localhost:3000`.
The candidate app runs on `http://localhost:3001`.

## Scripts

```bash
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```

## Database

`packages/db` owns Prisma. Set `DATABASE_URL` in `.env` before running Prisma commands or adding migrations.
