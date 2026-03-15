// ---------------------------------------------------------------------------
// Model routing — selects the most cost-effective model for a given task.
// ---------------------------------------------------------------------------

const SONNET = "claude-sonnet-4-20250514";
const HAIKU = "claude-haiku-4-5-20251001";

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
