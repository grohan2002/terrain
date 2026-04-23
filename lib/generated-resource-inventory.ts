// ---------------------------------------------------------------------------
// Extract `resource "<tf_type>" "<tf_name>" {` declarations from generated
// Terraform HCL. Shared between the scorer and the runtime coverage check.
//
// Regex-only (not a full HCL parser) — we only ever need block-level headers
// to compute coverage, not arg trees. Coping with quoted strings that happen
// to look like `resource "..." "..." {` inside a heredoc is an acceptable
// risk; conversions don't produce those in practice.
// ---------------------------------------------------------------------------

/** One `resource "<type>" "<name>"` header found in the generated HCL. */
export interface GeneratedResource {
  tfType: string;
  tfName: string;
  /** Filename the block was found in, e.g. "main.tf". */
  file: string;
}

export function extractGeneratedResources(
  files: Record<string, string>,
): GeneratedResource[] {
  const out: GeneratedResource[] = [];
  const re = /^resource\s+"([a-z0-9_]+)"\s+"([A-Za-z0-9_\-]+)"\s*\{/gm;
  for (const [file, content] of Object.entries(files)) {
    // Skip .tfvars / .tfvars.example / .tfstate — those have no `resource` blocks.
    if (!file.endsWith(".tf")) continue;
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags); // fresh lastIndex per file
    while ((m = r.exec(content)) !== null) {
      out.push({ tfType: m[1], tfName: m[2], file });
    }
  }
  return out;
}

/** De-duplicated set of `tfType`s that appear in the output. */
export function generatedTfTypes(files: Record<string, string>): string[] {
  const set = new Set<string>();
  for (const r of extractGeneratedResources(files)) set.add(r.tfType);
  return Array.from(set).sort();
}
