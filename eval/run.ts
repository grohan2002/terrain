// ---------------------------------------------------------------------------
// Eval harness CLI.
//
//   npm run eval                    # score every fixture against its reference
//   npm run eval:update-refs        # overwrite references with current output
//   npm run eval -- bicep/01-*      # glob filter on fixture name
//   EVAL_BASE_URL=https://...       # override the target server
//   EVAL_CONCURRENCY=2              # how many fixtures to run in parallel
//
// Requires the app running (default http://localhost:3001) with the
// credentials provider seeded (admin@bicep.dev / admin).
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixtures, writeReference, type Fixture } from "./fixtures";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  scoreFixture,
  type FixtureScore,
  type RunSummary,
} from "./score";
import { login } from "./auth";
import type { StreamEvent } from "@/lib/types";

const DEFAULT_BASE_URL = process.env.EVAL_BASE_URL ?? "http://localhost:3001";
const DEFAULT_CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? "1") || 1;
const REPORTS_ROOT = path.resolve(__dirname, "reports");

interface CliOptions {
  updateReferences: boolean;
  filter: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { updateReferences: false, filter: null };
  for (const arg of argv.slice(2)) {
    if (arg === "--update-references" || arg === "--update-refs") {
      opts.updateReferences = true;
    } else if (!arg.startsWith("--") && opts.filter === null) {
      opts.filter = arg;
    }
  }
  return opts;
}

function matchesFilter(name: string, filter: string | null): boolean {
  if (!filter) return true;
  // Very simple glob — `*` → `.*`, anchored.
  const re = new RegExp("^" + filter.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
  return re.test(name);
}

// ---------------------------------------------------------------------------
// SSE stream parsing
// ---------------------------------------------------------------------------

async function streamConversion(args: {
  baseUrl: string;
  cookie: string;
  fixture: Fixture;
}): Promise<StreamEvent[]> {
  const { baseUrl, cookie, fixture } = args;
  const body = {
    bicepContent: fixture.input,
    sourceFormat: fixture.meta.sourceFormat,
  };
  const res = await fetch(`${baseUrl}/api/convert`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      Accept: "text/event-stream",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `[${fixture.meta.name}] /api/convert returned ${res.status}: ${text.slice(0, 300)}`,
    );
  }
  if (!res.body) throw new Error("No response body");

  const events: StreamEvent[] = [];
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // SSE frames are separated by blank lines.
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        try {
          events.push(JSON.parse(data) as StreamEvent);
        } catch {
          // Ignore malformed frames — SSE comments, keepalives, etc.
        }
      }
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function verdictEmoji(score: FixtureScore): string {
  if (score.summary.errored) return "💥";
  if (score.passed) return "✅";
  return "❌";
}

function fmtCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function renderMarkdown(args: {
  startedAt: Date;
  baseUrl: string;
  scores: FixtureScore[];
  durationMs: number;
}): string {
  const { startedAt, baseUrl, scores, durationMs } = args;
  const passed = scores.filter((s) => s.passed).length;
  const errored = scores.filter((s) => s.summary.errored).length;
  const totalCost = scores.reduce(
    (sum, s) => sum + (s.summary.costInfo?.totalCostUsd ?? 0),
    0,
  );
  const lines: string[] = [];
  lines.push(`# Eval run — ${startedAt.toISOString()}`);
  lines.push("");
  lines.push(`**Target:** ${baseUrl}`);
  lines.push(
    `**Result:** ${passed}/${scores.length} passed · ${errored} errored · ${fmtCost(totalCost)} total cost · ${(durationMs / 1000).toFixed(1)}s elapsed`,
  );
  lines.push("");
  lines.push(
    "| Fixture | Coverage | Validation | Struct | Cost | Rounds | Model | Verdict |",
  );
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const s of scores) {
    const validationCell =
      s.summary.validationPassed === null
        ? "—"
        : s.summary.validationPassed
          ? "✓"
          : "✗";
    const structCell =
      s.structuralMatch === null ? "—" : s.structuralMatch.toFixed(2);
    lines.push(
      `| ${s.fixture} | ${fmtPct(s.coverage.coverage)} | ${validationCell} | ${structCell} | ${fmtCost(
        s.summary.costInfo?.totalCostUsd ?? 0,
      )} | ${s.summary.totalRounds} | ${s.summary.model ?? "—"} | ${verdictEmoji(s)} |`,
    );
  }
  lines.push("");
  // Per-fixture breakdowns for non-passing runs
  for (const s of scores) {
    if (s.passed && !s.summary.errored) continue;
    lines.push(`## ${verdictEmoji(s)} ${s.fixture}`);
    lines.push("");
    if (s.failReasons.length > 0) {
      lines.push("**Fail reasons:**");
      for (const r of s.failReasons) lines.push(`- ${r}`);
      lines.push("");
    }
    if (s.coverage.unmappedSourceTypes.length > 0) {
      lines.push(
        `Unmapped source types (excluded from coverage): ${s.coverage.unmappedSourceTypes.join(", ")}`,
      );
      lines.push("");
    }
    if (Object.keys(s.summary.toolCallCounts).length > 0) {
      lines.push("**Tool calls:**");
      for (const [name, n] of Object.entries(s.summary.toolCallCounts).sort(
        (a, b) => b[1] - a[1],
      )) {
        lines.push(`- ${name}: ${n}`);
      }
      lines.push("");
    }
    if (s.summary.errorMessage) {
      lines.push("**Error:**");
      lines.push("```");
      lines.push(s.summary.errorMessage);
      lines.push("```");
      lines.push("");
    }
  }
  return lines.join("\n");
}

type JsonScore = Omit<FixtureScore, "summary"> & {
  summary: Omit<RunSummary, "terraformFiles"> & { terraformFileCount: number };
};

interface JsonReport {
  startedAt: string;
  baseUrl: string;
  durationMs: number;
  totals: {
    fixtures: number;
    passed: number;
    errored: number;
    totalCostUsd: number;
  };
  scores: JsonScore[];
}

function scoreToJson(s: FixtureScore): JsonScore {
  const { terraformFiles, ...rest } = s.summary;
  return {
    ...s,
    summary: { ...rest, terraformFileCount: Object.keys(terraformFiles).length },
  };
}

// ---------------------------------------------------------------------------
// Concurrency runner
// ---------------------------------------------------------------------------

async function runPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  const startedAt = new Date();
  const baseUrl = DEFAULT_BASE_URL;

  const allFixtures = loadFixtures();
  const fixtures = allFixtures.filter((f) =>
    matchesFilter(f.meta.name, opts.filter),
  );
  if (fixtures.length === 0) {
    console.error(
      `No fixtures matched ${opts.filter ?? "(no filter)"}. Available:\n` +
        allFixtures.map((f) => `  - ${f.meta.name}`).join("\n"),
    );
    process.exit(1);
  }

  console.error(
    `▶ Target: ${baseUrl}  ·  ${fixtures.length} fixture(s)  ·  concurrency=${DEFAULT_CONCURRENCY}${opts.updateReferences ? "  ·  UPDATING references" : ""}`,
  );

  const { cookie } = await login({ baseUrl });
  console.error(`▶ Logged in as admin@bicep.dev`);

  const t0 = Date.now();
  const scores = await runPool<Fixture, FixtureScore>(
    fixtures,
    DEFAULT_CONCURRENCY,
    async (fixture, i) => {
      const tStart = Date.now();
      console.error(
        `[${i + 1}/${fixtures.length}] ${fixture.meta.name}  ...`,
      );
      let events: StreamEvent[];
      try {
        events = await streamConversion({ baseUrl, cookie, fixture });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`   ✗ ${message}`);
        events = [{ type: "error", message }];
      }
      const score = scoreFixture({
        meta: fixture.meta,
        sourceContent: fixture.input,
        events,
        reference: fixture.reference,
      });
      if (opts.updateReferences && !score.summary.errored) {
        writeReference(fixture, score.summary.terraformFiles);
        console.error(
          `   ↑ wrote ${Object.keys(score.summary.terraformFiles).length} reference file(s)`,
        );
      }
      const dt = ((Date.now() - tStart) / 1000).toFixed(1);
      const emoji = verdictEmoji(score);
      console.error(
        `   ${emoji} coverage=${fmtPct(score.coverage.coverage)} rounds=${score.summary.totalRounds} cost=${fmtCost(score.summary.costInfo?.totalCostUsd ?? 0)} (${dt}s)`,
      );
      return score;
    },
  );
  const durationMs = Date.now() - t0;

  // Write report
  const stamp = startedAt
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("Z", "Z");
  const reportDir = path.join(REPORTS_ROOT, stamp);
  fs.mkdirSync(reportDir, { recursive: true });
  const md = renderMarkdown({ startedAt, baseUrl, scores, durationMs });
  fs.writeFileSync(path.join(reportDir, "report.md"), md);
  const totalCost = scores.reduce(
    (sum, s) => sum + (s.summary.costInfo?.totalCostUsd ?? 0),
    0,
  );
  const json: JsonReport = {
    startedAt: startedAt.toISOString(),
    baseUrl,
    durationMs,
    totals: {
      fixtures: scores.length,
      passed: scores.filter((s) => s.passed).length,
      errored: scores.filter((s) => s.summary.errored).length,
      totalCostUsd: totalCost,
    },
    scores: scores.map(scoreToJson),
  };
  fs.writeFileSync(
    path.join(reportDir, "report.json"),
    JSON.stringify(json, null, 2),
  );
  console.error(`\n▶ Report: ${path.relative(process.cwd(), reportDir)}/report.md`);
  console.error(
    `▶ Summary: ${json.totals.passed}/${json.totals.fixtures} passed · ${fmtCost(totalCost)} · ${(durationMs / 1000).toFixed(1)}s`,
  );

  process.exit(json.totals.passed === json.totals.fixtures ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
