# Bicep UI

An AI-powered web application that converts Azure Bicep infrastructure-as-code to Terraform / OpenTofu using Claude as the conversion agent. Built with the R Systems design language.

## Features

- **Single-file conversion** — Paste or upload a `.bicep` file and get Terraform output streamed in real time
- **Multi-file project conversion** — Upload an entire Bicep project with modules and parameter files
- **GitHub repo import** — Point at a GitHub repository and auto-discover all `.bicep` / `.bicepparam` files
- **AI agent conversation** — Watch the Claude agent reason, call tools, and iterate on the conversion
- **Validation** — Runs `tofu validate` against the generated Terraform to catch errors
- **Cost estimation** — Estimates monthly AWS costs for the converted infrastructure
- **Policy & security scanning** — Scans output against OPA policies and Trivy security rules
- **Resource graph** — Interactive visualisation of Bicep-to-Terraform resource mappings
- **Diff viewer** — Side-by-side before/after comparison
- **Deployment** — Deploy converted Terraform directly to Azure with a chat-driven agent
- **Conversion history** — Browse and restore previous conversions
- **Role-based access control** — Four-tier RBAC (Viewer → Converter → Deployer → Admin)
- **Audit logging** — Full audit trail of all actions

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16, React 19 |
| State | Zustand 5 (manual localStorage persistence) |
| Styling | Tailwind CSS 4, shadcn/ui (custom, no Radix) |
| Editor | Monaco Editor |
| AI | Anthropic Claude SDK (SSE streaming) |
| Auth | NextAuth v5 (GitHub OAuth + Credentials) |
| Database | PostgreSQL 16 via Prisma |
| Cache | Redis 7 (optional Upstash) |
| Testing | Vitest + jsdom |
| Container | Docker (multi-stage) + Docker Compose |

## Prerequisites

- **Node.js** 20+
- **npm** 10+
- An **Anthropic API key** ([console.anthropic.com](https://console.anthropic.com))
- *(Optional)* Docker & Docker Compose for containerised setup
- *(Optional)* PostgreSQL 16 and Redis 7 for persistence and caching

## Quick Start (Local Development)

### 1. Clone and install

```bash
git clone <repo-url>
cd bicep-ui
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set the required values:

```env
# ── Required ──────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...          # Your Anthropic API key

# ── Authentication ────────────────────────────────────────
AUTH_SECRET=                           # Generate: openssl rand -base64 32

# GitHub OAuth (optional — credentials login works without these)
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=

# ── Optional services ────────────────────────────────────
DATABASE_URL=postgresql://user:pass@localhost:5432/bicepui   # PostgreSQL
REDIS_URL=redis://localhost:6379                              # Redis cache

# Upstash Redis (alternative to self-hosted Redis)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# ── Logging ───────────────────────────────────────────────
LOG_LEVEL=info                         # debug | info | warn | error
```

> **Minimum setup:** Only `ANTHROPIC_API_KEY` and `AUTH_SECRET` are required to run locally. The app falls back to in-memory rate limiting and localStorage persistence when Postgres / Redis are unavailable.

### 3. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Log in

Use the built-in credentials:

- **Email:** `admin@bicep.dev`
- **Password:** `admin`

Or configure GitHub OAuth via `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` for SSO.

## Docker Setup

Spin up the full stack (app + PostgreSQL + Redis) in one command:

```bash
docker compose up --build
```

This starts:

| Service | Port | Description |
|---------|------|-------------|
| **app** | 3000 | Bicep UI (Next.js standalone) |
| **postgres** | 5432 | PostgreSQL 16 with persistent volume |
| **redis** | 6379 | Redis 7 with persistent volume |

The app waits for Postgres to pass its health check before starting.

To stop everything:

```bash
docker compose down
```

To also remove persisted data:

```bash
docker compose down -v
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Production build (standalone output) |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest in watch mode |
| `npm run test:ci` | Run Vitest once (CI mode) |

## Database Setup (Optional)

If using PostgreSQL for persistence:

```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma db push

# Seed data (if applicable)
npx prisma db seed
```

## API Routes

### Core Conversion
| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/convert` | Bicep → Terraform conversion (SSE stream) |
| `POST` | `/api/cost-estimate` | Estimate cloud costs for generated Terraform |
| `POST` | `/api/policy` | OPA policy compliance scan |
| `POST` | `/api/scan` | Trivy security scan |

### GitHub Integration
| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/github/scan` | Scan a GitHub repo for Bicep files |

### Deployment
| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/deploy` | Deploy Terraform to Azure (SSE stream) |
| `POST` | `/api/deploy/setup` | Set up deployment environment |
| `POST` | `/api/deploy/destroy` | Destroy deployed resources |

### History & Admin
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/history` | List conversion history |
| `GET` | `/api/history/:id` | Get a specific conversion |
| `GET` | `/api/admin/audit` | Audit logs (Admin only) |
| `GET` | `/api/check-key` | Validate Anthropic API key |
| `GET` | `/api/docs` | OpenAPI / Swagger spec |

Interactive API docs are available at [http://localhost:3000/api-docs](http://localhost:3000/api-docs).

## Project Structure

```
bicep-ui/
├── app/                          # Next.js app directory
│   ├── api/                      #   API routes
│   ├── convert/                  #   Conversion page
│   ├── batch/                    #   Batch conversion page
│   ├── history/                  #   History browser
│   ├── mappings/                 #   Resource mapping reference
│   ├── login/                    #   Login page
│   └── api-docs/                 #   Swagger UI
│
├── components/
│   ├── ui/                       # shadcn/ui base components
│   ├── conversion/               # Conversion UI (file upload, GitHub import, etc.)
│   ├── deployment/               # Deployment panels
│   ├── editor/                   # Monaco editor & diff viewer
│   ├── chat/                     # Agent conversation UI
│   └── layout/                   # Sidebar, theme toggle
│
├── lib/
│   ├── agent/                    # Bicep conversion agent (Claude SDK)
│   ├── deploy-agent/             # Deployment agent (Claude SDK)
│   ├── store.ts                  # Zustand store
│   ├── auth.ts                   # NextAuth v5 config
│   ├── rbac.ts                   # Role-based access control
│   ├── github.ts                 # GitHub API integration
│   ├── rate-limit.ts             # Rate limiting
│   ├── cache.ts                  # Redis + in-memory cache
│   ├── schemas.ts                # Zod validation schemas
│   └── ...                       # Utilities, logging, etc.
│
├── hooks/                        # Custom React hooks
├── prisma/                       # Database schema
├── samples/                      # Example Bicep files for testing
├── policies/                     # Example OPA policies
├── __tests__/                    # Test suite
│
├── Dockerfile                    # Multi-stage production build
├── docker-compose.yml            # Full stack (app + Postgres + Redis)
└── .env.example                  # Environment variable template
```

## Sample Bicep Files

The `samples/` directory includes example files for testing conversions:

| File | Description |
|------|-------------|
| `01-storage-account.bicep` | Simple Azure Storage account |
| `02-vnet-with-subnets.bicep` | Virtual network with subnets |
| `03-web-app-sql.bicep` | App Service + SQL Database |
| `04-aks-cluster.bicep` | Azure Kubernetes Service cluster |
| `05-microservices-platform.bicep` | Multi-resource microservices platform |
| `06-multi-module/` | Multi-file project (main + modules + params) |
| `07-hub-spoke-network.bicep` | Hub-and-spoke network topology with loops |

## Testing

```bash
# Run all tests
npm run test:ci

# Run tests in watch mode
npm test

# Run a specific test file
npx vitest run __tests__/lib/github.test.ts
```

## RBAC Roles

| Role | Permissions |
|------|------------|
| **Viewer** | Browse history, view mappings |
| **Converter** | All Viewer + run conversions, cost estimates, scans |
| **Deployer** | All Converter + deploy Terraform to Azure |
| **Admin** | All Deployer + view audit logs, manage users |

## Architecture Notes

**Streaming:** Conversions and deployments use Server-Sent Events (SSE). The Claude agent streams its reasoning, tool calls, and outputs in real time via `lib/stream-client.ts`.

**Rate limiting:** An 8-second pacing delay is applied between agent rounds to stay within Anthropic API rate limits. Message history is compressed after round 5 to reduce token usage.

**Zustand + React 19:** Store selectors must never return new object/array references (no `.map()`, `.filter()`, `Object.keys()` in selectors). Use `useMemo` inside components for derived state. The `zustand/persist` middleware is not used — persistence is handled manually with localStorage.
