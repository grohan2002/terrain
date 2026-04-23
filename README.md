# Terrain

> Chart your infrastructure across every cloud.

Terrain is an AI-powered infrastructure modernization platform that converts Azure Bicep **and** AWS CloudFormation templates to Terraform/OpenTofu — using Claude as the conversion agent, the HashiCorp Terraform MCP server for authoritative provider schemas, and the Azure MCP server for live pre-flight validation.

## Features

- **Multi-source conversion** — Toggle between Bicep and CloudFormation in the UI. Each language has its own dedicated pipeline, system prompt, and resource mapping table.
  - **Bicep** → Azure Terraform (`azurerm_*`). Single-file or multi-file Bicep projects with modules and `.bicepparam`.
  - **CloudFormation** → AWS Terraform (`aws_*`). YAML or JSON. Intrinsic short-forms (`!Ref`, `!GetAtt`, `!Sub`, `!If`, `!FindInMap`, `!GetAZs`, …) are normalised before conversion.
- **GitHub repo import** — Point at a GitHub repository and auto-discover Bicep files
- **AI agent conversation** — Watch the Claude agent reason, call tools, and iterate on the conversion
- **Validation** — Runs `tofu validate` against the generated Terraform to catch errors
- **Cost estimation** — Real-time Azure/AWS pricing via Infracost (falls back to a built-in estimator)
- **Policy & security scanning** — OPA-powered policy evaluation and Trivy misconfiguration scans
- **Resource graph** — Interactive visualisation of IaC resource mappings
- **Diff viewer** — Side-by-side before/after comparison
- **Deployment** — Deploy converted Terraform to Azure with a chat-driven agent (AWS deploy coming soon)
- **Token usage dashboard** — Per-conversion and cumulative token/cost tracking
- **Conversion history** — Browse and restore previous conversions with cost data; source-format badge per entry
- **Role-based access control** — Four-tier RBAC (Viewer → Converter → Deployer → Admin)
- **Audit logging** — Full audit trail of all actions
- **Expert Mode** — ⚡ toggle in the top bar that routes the next conversion to **Claude Opus 4.7** for the gnarliest templates. Higher accuracy, ~5× the cost. Standard (default) keeps the cost-optimal Haiku/Sonnet routing. The model ID is overridable via the `OPUS_MODEL_ID` env var (see `.env.example`).
- **Coverage badge** — Every conversion emits a deterministic resource-coverage report (source resources vs generated TF blocks). Green `✓ N/N coverage` when nothing was dropped, amber `⚠ M/N` with a tooltip listing the missing ones otherwise.

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
| IaC CLIs | OpenTofu, Azure CLI, Trivy (bundled in Docker) |

## Prerequisites

- **Node.js** 20+
- **npm** 10+
- An **Anthropic API key** ([console.anthropic.com](https://console.anthropic.com))
- **Docker & Docker Compose** (required for full stack)
- *(Optional for local dev without Docker)* PostgreSQL 16 and Redis 7

---

## Full Setup on a New Laptop

Follow these steps in order to get the app running with all historical data intact.

### Step 1: Clone the repository

```bash
git clone https://github.com/grohan2002/terrain.git
cd terrain
```

### Step 2: Install Node.js dependencies

```bash
npm install
```

### Step 3: Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in the required values:

```env
# ── Required ──────────────────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...          # Your Anthropic API key

# ── Authentication ────────────────────────────────────────
# Generate with: openssl rand -base64 32
AUTH_SECRET=<paste-generated-secret>
AUTH_TRUST_HOST=true
AUTH_URL=http://localhost:3001

# GitHub OAuth (optional — credentials login works without these)
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=

# ── Database (matches docker-compose.yml defaults) ────────
DATABASE_URL=postgresql://terrain:terrain@postgres:5432/terrain

# ── Redis ─────────────────────────────────────────────────
REDIS_URL=redis://redis:6379

# Upstash Redis (alternative to self-hosted Redis)
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# ── Azure Deployment (optional, for Deploy & Test) ────────
ARM_SUBSCRIPTION_ID=
ARM_TENANT_ID=
ARM_CLIENT_ID=
ARM_CLIENT_SECRET=

# ── Logging ───────────────────────────────────────────────
LOG_LEVEL=info
NODE_ENV=production
```

> **Minimum setup:** Only `ANTHROPIC_API_KEY` and `AUTH_SECRET` are required. The app falls back to in-memory rate limiting and localStorage persistence when Postgres / Redis are unavailable.

### Step 4: Start the Docker stack

```bash
docker compose up --build -d
```

This starts three services:

| Service | Host → Container | Description |
|---------|------------------|-------------|
| **app** | 3001 → 3000 | Terrain (Next.js + OpenTofu + Azure CLI + Infracost + OPA + Trivy + @azure/mcp) |
| **terraform-mcp** | _(internal)_ → 8080 | HashiCorp Terraform MCP server (streamable-HTTP) |
| **postgres** | 5432 → 5432 | PostgreSQL 16 with persistent volume |
| **redis** | 6380 → 6379 | Redis 7 with persistent volume |

> The app is mapped to host port **3001** (and redis to **6380**) to avoid collisions with other local Next.js projects that typically use 3000/6379. Internally, containers still talk to each other on their standard ports via the Docker network.

Wait for all containers to be healthy:

```bash
docker compose ps
```

### Step 5: Create the database schema

The Prisma schema needs to be applied to the empty PostgreSQL database:

```bash
# Option A: Using Prisma from outside the container
DATABASE_URL="postgresql://terrain:terrain@localhost:5432/terrain" npx prisma db push

# Option B: Using the included SQL dump file
docker cp terrain-dump.sql terrain-postgres-1:/tmp/terrain-dump.sql
docker exec -i terrain-postgres-1 psql -U terrain -d terrain -f /tmp/terrain-dump.sql
```

### Step 6: Restore historical data (optional)

If you have a database dump from another machine with conversion/deployment history:

```bash
# Copy the dump file into the postgres container and restore
docker cp terrain-dump.sql terrain-postgres-1:/tmp/terrain-dump.sql
docker exec -i terrain-postgres-1 psql -U terrain -d terrain -f /tmp/terrain-dump.sql
```

The included `terrain-dump.sql` contains the full schema (tables, indexes, foreign keys, enums). If you have a dump with data rows, it will also restore all historical conversions, deployments, and audit logs.

### Step 7: Generate the Prisma client

```bash
npx prisma generate
```

### Step 8: Verify everything is running

```bash
# Check containers are healthy
docker compose ps

# Check database tables exist
docker exec terrain-postgres-1 psql -U terrain -d terrain -c "\dt"
```

Expected output:

```
 Schema |    Name     | Type  |  Owner
--------+-------------+-------+---------
 public | audit_logs  | table | terrain
 public | conversions | table | terrain
 public | deployments | table | terrain
 public | users       | table | terrain
```

### Step 9: Open the app

Open [http://localhost:3001](http://localhost:3001) in your browser.

**Default login credentials:**
- **Email:** `admin@bicep.dev`
- **Password:** `admin`

Or configure GitHub OAuth via `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` for SSO.

---

## Creating a Database Dump (for Migration)

To export the current database for transfer to another machine:

```bash
docker exec terrain-postgres-1 pg_dump -U terrain -d terrain --clean --if-exists > terrain-dump.sql
```

This creates a portable SQL file with:
- Schema (tables, indexes, foreign keys, `Role` enum)
- All data rows (conversions, deployments, users, audit logs)
- `--clean --if-exists` flags so it can be safely re-imported on a fresh database

---

## Local Development (without Docker)

If you prefer running without Docker:

```bash
# 1. Install dependencies
npm install

# 2. Configure .env (set DATABASE_URL to localhost if using local Postgres)
cp .env.example .env

# 3. Push schema to your local Postgres
DATABASE_URL="postgresql://user:pass@localhost:5432/terrain" npx prisma db push

# 4. Generate Prisma client
npx prisma generate

# 5. Start dev server
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

> **Note:** Local dev mode requires OpenTofu or Terraform to be installed for validation. The Docker image bundles these automatically. Install with: `brew install opentofu`

---

## Docker Management

```bash
# Start all services
docker compose up --build -d

# View logs
docker compose logs -f app

# Restart just the app (after code changes)
docker compose up --build -d app

# Stop everything (keep data)
docker compose down

# Stop and delete all data (fresh start)
docker compose down -v
```

### Rebuilding after code changes

```bash
# Clear Next.js cache and rebuild
rm -rf .next
docker compose up --build -d
```

---

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Production build (standalone output) |
| `npm start` | Start production server |
| `npm run lint` | Run ESLint |
| `npm test` | Run Vitest in watch mode |
| `npm run test:ci` | Run Vitest once (CI mode) |

---

## API Routes

### Core Conversion
| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/convert` | Bicep to Terraform conversion (SSE stream) |
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

Interactive API docs are available at [http://localhost:3001/api-docs](http://localhost:3001/api-docs).

---

## Project Structure

```
terrain/
├── app/                          # Next.js app directory
│   ├── api/                      #   API routes
│   ├── convert/                  #   Conversion page
│   ├── batch/                    #   Batch conversion page
│   ├── history/                  #   History browser (with usage stats)
│   ├── mappings/                 #   Resource mapping reference
│   ├── login/                    #   Login page
│   └── api-docs/                 #   Swagger UI
│
├── components/
│   ├── ui/                       # shadcn/ui base components
│   ├── conversion/               # Conversion UI (file upload, GitHub import, etc.)
│   ├── deployment/               # Deployment panels (Azure config dialog)
│   ├── editor/                   # Monaco editor & diff viewer
│   ├── chat/                     # Agent conversation UI
│   └── layout/                   # Sidebar, theme toggle
│
├── lib/
│   ├── agent/                    # Bicep conversion agent (Claude SDK)
│   │   ├── stream.ts             #   Agentic loop with SSE streaming
│   │   ├── system-prompt.ts      #   Conversion rules & prompt
│   │   ├── tools.ts              #   Tool definitions (9 tools)
│   │   └── tool-handlers.ts      #   Tool implementations
│   ├── deploy-agent/             # Deployment agent (Claude SDK)
│   │   ├── stream.ts             #   Deploy agentic loop
│   │   ├── system-prompt.ts      #   9-step deploy workflow
│   │   ├── tools.ts              #   Tool definitions (7 tools)
│   │   └── tool-handlers.ts      #   Tool implementations
│   ├── store.ts                  # Zustand store
│   ├── cost.ts                   # Token cost calculation & formatting
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
├── __tests__/                    # Test suite (387 tests)
│
├── Dockerfile                    # Multi-stage build (Node + OpenTofu + Azure CLI + Trivy)
├── docker-compose.yml            # Full stack (app + Postgres + Redis)
├── terrain-dump.sql              # PostgreSQL dump for data migration
├── Terrain-Agent-Architecture.pptx  # Architecture overview deck
└── .env.example                  # Environment variable template
```

---

## Agent Architecture

The app uses two Claude-powered agents that work in sequence:

### Conversion Agent (9 tools)

| Tool | Purpose |
|------|---------|
| `parse_bicep` | Parse Bicep into structured AST |
| `lookup_resource_mapping` | Find Terraform equivalent for a Bicep resource type |
| `generate_terraform` | Generate formatted HCL blocks |
| `write_terraform_files` | Write .tf files to disk |
| `validate_terraform` | Run `tofu init` + `tofu validate` |
| `format_terraform` | Run `tofu fmt` for canonical HCL style |
| `read_bicep_file` | Read a .bicep file from disk |
| `list_bicep_files` | List .bicep files in a directory |
| `read_bicep_file_content` | Read from in-memory project context (multi-file) |

- **Models:** Claude Sonnet 4 (complex files) / Claude Haiku 4.5 (simple files)
- **Max rounds:** 30 (single-file) / 40 (multi-file)

### Deployment Agent (7 tools)

| Tool | Purpose |
|------|---------|
| `terraform_plan` | Preview changes (120s timeout) |
| `terraform_apply` | Deploy with auto-approve (300s timeout) |
| `get_terraform_outputs` | Extract resource IDs and endpoints |
| `check_azure_resource` | Verify resource exists in Azure |
| `run_connectivity_test` | HTTP, DNS, or TCP connectivity tests |
| `check_resource_config` | Validate deployed config vs Bicep intent |
| `terraform_destroy` | Tear down resources (user-gated) |

- **Model:** Claude Sonnet 4 (always)
- **Max rounds:** 40
- **Workflow:** Plan → Pre-flight Checks → Apply → Outputs → Test (Existence + Connectivity + Config) → Report

See `Terrain-Agent-Architecture.pptx` for visual diagrams.

---

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

---

## Testing

```bash
# Run all tests (387 tests)
npm run test:ci

# Run tests in watch mode
npm test

# Run a specific test file
npx vitest run __tests__/lib/github.test.ts
```

---

## RBAC Roles

| Role | Permissions |
|------|------------|
| **Viewer** | Browse history, view mappings |
| **Converter** | All Viewer + run conversions, cost estimates, scans |
| **Deployer** | All Converter + deploy Terraform to Azure |
| **Admin** | All Deployer + view audit logs, manage users |

---

## Architecture Notes

**Streaming:** Conversions and deployments use Server-Sent Events (SSE). The Claude agent streams its reasoning, tool calls, and outputs in real time via `lib/stream-client.ts`.

**Rate limiting:** An 8-second pacing delay is applied between agent rounds to stay within Anthropic API rate limits. Message history is compressed after round 5 to reduce token usage.

**Terraform output accumulation:** When the agent calls `write_terraform_files` multiple times (e.g., .tf files first, then .tfvars.example), outputs are merged — not replaced — so no files are lost.

**Azure deployment readiness:** The conversion agent generates globally unique names (random_string suffix) for Key Vault, Storage Account, Container Registry, etc. AKS Kubernetes versions use data sources instead of hardcoded values.

**Zustand + React 19:** Store selectors must never return new object/array references (no `.map()`, `.filter()`, `Object.keys()` in selectors). Use `useMemo` inside components for derived state. The `zustand/persist` middleware is not used — persistence is handled manually with localStorage.

**Token tracking:** Each conversion tracks input/output/cache tokens and computes USD cost. The history page shows per-entry cost and cumulative usage stats (Total Conversions, Total Tokens, Total Spent).

---

## Analysis Panels (Cost, Policy, Security)

The three analysis tabs under a completed conversion use the following tools, all bundled in the Docker image:

| Panel | Tool | Fallback when tool is unavailable |
|-------|------|-----------------------------------|
| **Cost Estimate** | [Infracost](https://www.infracost.io) | Resource-type lookup map with rough monthly estimates |
| **Policies** | [Open Policy Agent (OPA)](https://www.openpolicyagent.org) | Built-in regex checks on encryption, tagging, public access |
| **Security Scan** | [Trivy](https://aquasecurity.github.io/trivy) | Regex scan for TLS, HTTPS, open NSG rules, etc. |

Each panel header shows a badge indicating whether the real tool ran (green) or the fallback (amber). If you see **"Fallback estimate"**, **"Fallback checks"**, or **"Fallback scan"** badges, the real binary isn't on `PATH` inside the container.

### Unlocking real-time Azure pricing (recommended)

The CLI requires an API key to reach Infracost's pricing service. The simplest way to wire it into the container:

1. Grab a free key from [https://dashboard.infracost.io](https://dashboard.infracost.io) (Settings → API Key).
2. Add it to your `.env` file:
   ```env
   INFRACOST_API_KEY=ico-...
   ```
3. Restart the app container so the env var is picked up:
   ```bash
   docker compose up -d --force-recreate app
   ```
4. Re-run the cost estimate — the panel header should flip from the amber **"Fallback estimate"** badge to the green **"Infracost"** badge.

Alternatively, `docker exec -it terrain-app-1 infracost auth login` walks you through an interactive browser flow and writes credentials to `/home/nextjs/.config/infracost/credentials.yml` inside the container (lost on rebuild unless you mount the directory as a volume).

---

## MCP Servers (Model Context Protocol)

To reduce hallucination, the agents have access to two official MCP servers that provide authoritative data at runtime:

| MCP server | Runs as | Tools exposed (allowlisted) | Used by |
|-----------|---------|-----------------------------|---------|
| **HashiCorp Terraform MCP** ([`hashicorp/terraform-mcp-server`](https://github.com/hashicorp/terraform-mcp-server)) | Sidecar container on `http://terraform-mcp:8080/mcp` | `search_providers`, `get_provider_details`, `get_latest_provider_version`, `search_modules`, `get_module_details` | Conversion & deploy agents (for AzureRM schema lookups) |
| **Microsoft Azure MCP** ([`@azure/mcp`](https://github.com/microsoft/mcp/tree/main/servers/Azure.Mcp.Server)) | Child process inside the app container (stdio, `azmcp server start`) | `azmcp-aks-get-versions`, `azmcp-resource-check-name`, `azmcp-group-list`, `azmcp-subscription-list`, `azmcp-resource-show`, `azmcp-location-list` | Deploy agent only (live pre-flight checks) |

**Why these are valuable**

- Terraform MCP prevents Claude from inventing `azurerm_*` properties — it calls `get_provider_details` to fetch the real schema before writing HCL.
- Azure MCP prevents common deployment failures: AKS unsupported-version errors (queries `azmcp-aks-get-versions` live) and Key Vault / Storage name-conflict errors (checks `azmcp-resource-check-name` before apply).

**Kill switches** — in `.env`, set either flag to `false` to disable:
```env
ENABLE_TERRAFORM_MCP=true
ENABLE_AZURE_MCP=true
TERRAFORM_MCP_URL=http://terraform-mcp:8080/mcp   # only needed if sidecar moves
```

With either server disabled, the agents degrade gracefully — they'll fall back to their built-in `lookup_resource_mapping` tool and Claude's internal knowledge.

**Azure MCP auth**: reuses the same `ARM_SUBSCRIPTION_ID` / `ARM_TENANT_ID` / `ARM_CLIENT_ID` / `ARM_CLIENT_SECRET` env vars as Terraform (the app maps `ARM_*` to `AZURE_*` before spawning the child process). Dialog-provided Azure creds reach `tofu apply` but not the Azure MCP pre-flight tools yet — see the `.env` file for the setting to bake in long-lived creds.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Cannot connect to Docker daemon` | Start Docker Desktop first |
| `prisma db push` fails with `P1001` | Use `localhost` instead of `postgres` in DATABASE_URL when running outside Docker |
| Stale Next.js cache causing runtime errors | Run `rm -rf .next` then rebuild |
| Zustand infinite rerender loop | Check store selectors — never return new refs (use `useMemo` inside component) |
| `tofu` / `terraform` not found (local dev) | Install OpenTofu: `brew install opentofu` or use Docker which bundles it |
| Conversion shows only `.tfvars.example` | Fixed — terraform outputs are now accumulated across `write_terraform_files` calls |
| Cost panel shows `$0` or "Fallback estimate" | Rebuild the Docker image so Infracost is installed, or run `which infracost` inside the container |
| Policy panel shows "Fallback checks" | Rebuild the Docker image so OPA is installed, or run `which opa` inside the container |
| Security panel shows "Fallback scan" | Rebuild the Docker image so Trivy is installed, or run `which trivy` inside the container |
| Conversion hallucinates Terraform attributes | Confirm `terraform-mcp` container is healthy: `docker compose logs terraform-mcp`. Check the app logs for "Terraform MCP tools loaded" on startup. Set `ENABLE_TERRAFORM_MCP=false` as a kill switch. |
| Azure MCP fails to spawn | Confirm `which azmcp` resolves inside the app container. Check Azure MCP logs via `docker compose logs app | grep azmcp`. If the `ARM_*` creds are missing or invalid, Azure MCP still starts but tool calls fail — set `ENABLE_AZURE_MCP=false` to silence. |
