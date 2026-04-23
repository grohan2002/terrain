// ---------------------------------------------------------------------------
// Model routing — selects the most cost-effective model for a given task.
//
// Default behaviour is cost-optimal: Haiku for single trivial Bicep files,
// Sonnet for everything else (and all multi-file projects). Expert Mode is
// an explicit opt-in that upgrades every run to Opus 4.7 — higher accuracy
// on gnarly templates at roughly 5× the cost.
// ---------------------------------------------------------------------------

const SONNET = "claude-sonnet-4-20250514";
const HAIKU = "claude-haiku-4-5-20251001";
/**
 * Opus model ID is read from `OPUS_MODEL_ID` so we can swap the exact
 * snapshot (e.g. "claude-opus-4-7" vs "claude-opus-4-7-20260115") without
 * a code change. Defaults to the stable alias.
 */
export function opusModelId(): string {
  return process.env.OPUS_MODEL_ID || "claude-opus-4-7";
}

export interface ModelSelectionOpts {
  expertMode?: boolean;
}

/**
 * Select the appropriate model based on Bicep content complexity.
 * Uses Haiku (~10x cheaper) for simple single-resource files.
 */
export function selectModel(bicepContent: string): string {
  const lines = bicepContent.split("\n");
  const lineCount = lines.length;

  // Count resource declarations
  const resourceCount = lines.filter((l) =>
    l.trim().startsWith("resource "),
  ).length;

  // Check for complex features
  const hasModules = lines.some((l) => l.trim().startsWith("module "));
  const hasLoops = lines.some((l) => /\bfor\b/.test(l));
  const hasConditions = lines.some((l) => /\bif\b/.test(l) && !l.trim().startsWith("//"));

  // Simple: 1 resource, < 50 lines, no modules/loops/conditions
  if (
    resourceCount <= 1 &&
    lineCount < 50 &&
    !hasModules &&
    !hasLoops &&
    !hasConditions
  ) {
    return HAIKU;
  }

  return SONNET;
}

/**
 * Multi-file projects always use Sonnet — the higher reasoning capacity
 * is needed for cross-module dependency analysis and module structure mapping.
 */
export function selectModelMultiFile(): string {
  return SONNET;
}

/**
 * Expert-mode-aware single-file selector. When expertMode is true we always
 * return Opus 4.7 regardless of template simplicity — the user has explicitly
 * opted into paying for the top-tier model. Otherwise we defer to the normal
 * cost-optimal heuristic.
 */
export function selectModelWithExpertMode(
  content: string,
  opts: ModelSelectionOpts = {},
): string {
  if (opts.expertMode) return opusModelId();
  return selectModel(content);
}

/**
 * Expert-mode-aware multi-file selector. Default stays Sonnet; Expert upgrades
 * to Opus.
 */
export function selectModelMultiFileWithExpertMode(
  opts: ModelSelectionOpts = {},
): string {
  if (opts.expertMode) return opusModelId();
  return selectModelMultiFile();
}
