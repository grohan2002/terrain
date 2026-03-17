// ---------------------------------------------------------------------------
// Tool handler implementations for the Bicep-to-Terraform conversion agent.
// Ported from bicep_converter/tools.py handler functions.
//
// Uses Node.js APIs (fs, path, child_process) — server-side only.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

import {
  RESOURCE_TYPE_MAP,
  PROPERTY_DECOMPOSITIONS,
  PROPERTY_NAME_OVERRIDES,
  extractStorageTier,
  extractStorageReplication,
} from "../mappings";
import { ok, err, type ToolResult } from "../tool-result";

// ---------------------------------------------------------------------------
// Path safety helpers
// ---------------------------------------------------------------------------

/** Verify that a resolved path stays within the expected base directory. */
function isPathWithin(base: string, target: string): boolean {
  const resolvedBase = path.resolve(base) + path.sep;
  const resolvedTarget = path.resolve(target);
  return resolvedTarget.startsWith(resolvedBase) || resolvedTarget === path.resolve(base);
}

/** Restrict file reads to .bicep files in the cwd or temp directories. */
function isSafeReadPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const cwd = process.cwd();
  const tmp = os.tmpdir();
  return isPathWithin(cwd, resolved) || isPathWithin(tmp, resolved);
}

// ---------------------------------------------------------------------------
// Strip ANSI escape codes from CLI output
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*m/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

// ---------------------------------------------------------------------------
// Terraform validate -json output parser
// ---------------------------------------------------------------------------

interface ValidateDiagnostic {
  severity: "error" | "warning";
  summary: string;
  detail?: string;
  range?: {
    filename?: string;
    start?: { line?: number; column?: number };
    end?: { line?: number; column?: number };
  };
}

interface ValidateJsonOutput {
  valid: boolean;
  error_count: number;
  warning_count: number;
  diagnostics: ValidateDiagnostic[];
}

/** Parse `terraform validate -json` output. Returns null if not valid JSON. */
function parseValidateJson(raw: string): ValidateJsonOutput | null {
  try {
    const data = JSON.parse(raw.trim());
    if (typeof data.valid !== "boolean") return null;
    return {
      valid: data.valid,
      error_count: data.error_count ?? 0,
      warning_count: data.warning_count ?? 0,
      diagnostics: Array.isArray(data.diagnostics) ? data.diagnostics : [],
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Callbacks for side-effects the stream layer cares about
// ---------------------------------------------------------------------------

export interface ToolHandlerCallbacks {
  onTerraformOutput?: (files: Record<string, string>) => void;
  onValidation?: (passed: boolean, output: string) => void;
}

/** Extended options that include the optional multi-file context. */
export interface ToolHandlerOptions extends ToolHandlerCallbacks {
  /** In-memory Bicep file map for multi-file projects (path → content). */
  bicepFilesContext?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Factory — returns a name -> handler map
// ---------------------------------------------------------------------------

export function createToolHandlers(
  callbacksOrOptions?: ToolHandlerCallbacks | ToolHandlerOptions,
): Record<string, (input: Record<string, unknown>) => Promise<ToolResult>> {
  const callbacks = callbacksOrOptions;
  const bicepFilesContext = (callbacksOrOptions as ToolHandlerOptions | undefined)?.bicepFilesContext;
  // ------------------------------------------------------------------
  // Tool 1: read_bicep_file
  // ------------------------------------------------------------------
  async function readBicepFile(
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const filePath = String(input.file_path ?? "");
    const resolved = path.resolve(filePath);

    // Path traversal protection: restrict reads to cwd or temp directories
    if (!isSafeReadPath(resolved)) {
      return err(`Access denied: file path is outside allowed directories`);
    }

    if (!fs.existsSync(resolved)) {
      return err(`File not found: ${resolved}`);
    }

    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      return err(`Not a file: ${resolved}`);
    }

    try {
      const content = fs.readFileSync(resolved, "utf-8");
      const lineCount = content.split("\n").length;
      const size = stat.size;
      let header = `File: ${resolved}\nSize: ${size} bytes | Lines: ${lineCount}\n`;

      if (path.extname(resolved) !== ".bicep") {
        header += `Warning: file extension is '${path.extname(resolved)}', not '.bicep'\n`;
      }

      return ok(`${header}\n${content}`);
    } catch (e) {
      return err(`Failed to read ${resolved}: ${String(e)}`);
    }
  }

  // ------------------------------------------------------------------
  // Tool 2: parse_bicep
  // ------------------------------------------------------------------
  async function parseBicep(
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const content = String(input.content ?? "");

    if (!content.trim()) {
      return err("Empty content provided to parse_bicep.");
    }

    // No pycep equivalent in TypeScript — return the raw content with
    // section markers so the LLM can perform its own structured parsing.
    const lines = content.split("\n");
    const sections: string[] = [];
    let currentSection = "";

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed.startsWith("param ")) {
        if (currentSection !== "PARAMETERS") {
          currentSection = "PARAMETERS";
          sections.push("\n--- PARAMETERS ---");
        }
      } else if (trimmed.startsWith("var ")) {
        if (currentSection !== "VARIABLES") {
          currentSection = "VARIABLES";
          sections.push("\n--- VARIABLES ---");
        }
      } else if (trimmed.startsWith("resource ")) {
        if (currentSection !== "RESOURCES") {
          currentSection = "RESOURCES";
          sections.push("\n--- RESOURCES ---");
        }
      } else if (trimmed.startsWith("module ")) {
        if (currentSection !== "MODULES") {
          currentSection = "MODULES";
          sections.push("\n--- MODULES ---");
        }
      } else if (trimmed.startsWith("output ")) {
        if (currentSection !== "OUTPUTS") {
          currentSection = "OUTPUTS";
          sections.push("\n--- OUTPUTS ---");
        }
      }

      sections.push(line);
    }

    return ok([
      "Parsing mode: LLM-native (raw Bicep with section markers)",
      "",
      ...sections,
    ].join("\n"));
  }

  // ------------------------------------------------------------------
  // Tool 3: lookup_resource_mapping
  // ------------------------------------------------------------------
  async function lookupResourceMapping(
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const rawType = String(input.bicep_resource_type ?? "").trim();

    // Strip API version suffix
    const bicepType = rawType.includes("@")
      ? rawType.split("@")[0]
      : rawType;

    const tfType = RESOURCE_TYPE_MAP[bicepType];

    // Explicit null entry — merged into parent
    if (tfType === null && bicepType in RESOURCE_TYPE_MAP) {
      return ok(
        `Bicep type: ${bicepType}\n` +
        `Terraform equivalent: NONE (this resource is typically merged into ` +
        `its parent resource or has no direct Terraform equivalent).`
      );
    }

    // Not in the map at all
    if (tfType === undefined) {
      return ok(
        `Bicep type: ${bicepType}\n` +
        `No mapping found in the lookup table.\n` +
        `Use your knowledge of the AzureRM Terraform provider to determine ` +
        `the equivalent resource type. The general pattern is:\n` +
        `  Microsoft.<Provider>/<resourceType> -> azurerm_<snake_case_type>`
      );
    }

    const lines: string[] = [
      `Bicep type: ${bicepType}`,
      `Terraform type: ${tfType}`,
    ];

    // Add OS-type routing notes for compute resources
    if (bicepType === "Microsoft.Compute/virtualMachines") {
      lines.push("");
      lines.push("IMPORTANT: Check the VM's osProfile to determine OS type:");
      lines.push("  - If osProfile.linuxConfiguration exists → azurerm_linux_virtual_machine");
      lines.push("  - If osProfile.windowsConfiguration exists → azurerm_windows_virtual_machine");
      lines.push("  Default mapping shown above is for Linux. Adjust based on actual OS.");
    }
    if (bicepType === "Microsoft.Compute/virtualMachineScaleSets") {
      lines.push("");
      lines.push("IMPORTANT: Check the VMSS osProfile to determine OS type:");
      lines.push("  - Linux → azurerm_linux_virtual_machine_scale_set");
      lines.push("  - Windows → azurerm_windows_virtual_machine_scale_set");
    }

    // Check for property decompositions
    const decompositionEntries = Object.entries(PROPERTY_DECOMPOSITIONS).filter(
      ([key]) => key.startsWith(`${bicepType}::`)
    );
    if (decompositionEntries.length > 0) {
      lines.push("");
      lines.push("Property decompositions:");
      for (const [key, transforms] of decompositionEntries) {
        const propPath = key.split("::")[1];
        const tfAttrs = transforms
          .map(([attr, func]) => `${attr} (via ${func})`)
          .join(", ");
        lines.push(`  ${propPath} -> ${tfAttrs}`);
      }
    }

    // Include common property name overrides
    const overrideEntries = Object.entries(PROPERTY_NAME_OVERRIDES);
    if (overrideEntries.length > 0) {
      lines.push("");
      lines.push("Common property name overrides (camelCase -> snake_case):");
      for (const [bicepProp, tfProp] of overrideEntries.slice(0, 10)) {
        lines.push(`  ${bicepProp} -> ${tfProp}`);
      }
    }

    return ok(lines.join("\n"));
  }

  // ------------------------------------------------------------------
  // Tool 4: generate_terraform
  // ------------------------------------------------------------------
  async function generateTerraform(
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const blockType = String(input.block_type ?? "").trim().toLowerCase();
    const blockName = String(input.block_name ?? "").trim();
    const hclBody = String(input.hcl_body ?? "").trim();

    const validTypes = new Set([
      "resource",
      "variable",
      "locals",
      "output",
      "provider",
      "module",
      "data",
      "terraform",
      "moved",
      "import",
      "check",
      "removed",
    ]);

    if (!validTypes.has(blockType)) {
      return err(`Invalid block_type '${blockType}'. Must be one of: ${[...validTypes].sort().join(", ")}`);
    }

    // Indent the body
    const indentedBody = hclBody
      .split("\n")
      .map((line) => (line.trim() ? `  ${line}` : ""))
      .join("\n");

    let hcl: string;

    if (blockType === "resource" || blockType === "data") {
      const parts = blockName.split(".", 2);
      if (parts.length === 2) {
        hcl = `${blockType} "${parts[0]}" "${parts[1]}" {\n${indentedBody}\n}`;
      } else {
        hcl = `${blockType} "${blockName}" {\n${indentedBody}\n}`;
      }
    } else if (
      blockType === "variable" ||
      blockType === "output" ||
      blockType === "module" ||
      blockType === "provider"
    ) {
      hcl = `${blockType} "${blockName}" {\n${indentedBody}\n}`;
    } else if (blockType === "locals") {
      hcl = `locals {\n${indentedBody}\n}`;
    } else if (blockType === "terraform") {
      hcl = `terraform {\n${indentedBody}\n}`;
    } else {
      hcl = `${blockType} "${blockName}" {\n${indentedBody}\n}`;
    }

    return ok(hcl);
  }

  // ------------------------------------------------------------------
  // Tool 5: write_terraform_files
  // ------------------------------------------------------------------
  async function writeTerraformFiles(
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const outputDir = path.resolve(String(input.output_dir ?? ""));

    let files: Record<string, string>;
    try {
      files = JSON.parse(String(input.files ?? "{}"));
    } catch (e) {
      return err(`Invalid JSON in 'files' parameter: ${String(e)}`);
    }

    if (typeof files !== "object" || files === null || Array.isArray(files)) {
      return err("'files' must be a JSON object mapping filename -> content");
    }

    // Fire callback immediately so the UI receives terraform output even if
    // the subsequent disk write fails (e.g. read-only filesystem in Docker).
    callbacks?.onTerraformOutput?.(files);

    try {
      fs.mkdirSync(outputDir, { recursive: true });
    } catch (e) {
      return err(`Failed to create output directory: ${String(e)}`);
    }

    const written: string[] = [];
    const validExtensions = [".tf", ".tfvars", ".tfvars.json", ".hcl"];
    for (const [filename, content] of Object.entries(files)) {
      if (!validExtensions.some((ext) => filename.endsWith(ext))) {
        written.push(`  Warning: ${filename} has an unexpected extension`);
      }

      const filePath = path.join(outputDir, filename);

      // Path traversal protection: ensure resolved path stays within outputDir
      if (!isPathWithin(outputDir, filePath)) {
        return err(`Path traversal detected: '${filename}' resolves outside output directory`);
      }
      try {
        // Ensure parent directories exist (for nested module paths like modules/storage/main.tf)
        const parentDir = path.dirname(filePath);
        if (!fs.existsSync(parentDir)) {
          fs.mkdirSync(parentDir, { recursive: true });
        }
        fs.writeFileSync(filePath, content, "utf-8");
        const size = fs.statSync(filePath).size;
        written.push(`  ${filename} (${size} bytes)`);
      } catch (e) {
        return err(`Failed to write ${filename}: ${String(e)}`);
      }
    }

    return ok([
      `Output directory: ${outputDir}`,
      `Files written (${Object.keys(files).length}):`,
      ...written,
    ].join("\n"));
  }

  // ------------------------------------------------------------------
  // Tool 6: validate_terraform
  // ------------------------------------------------------------------
  async function validateTerraform(
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const workingDir = path.resolve(String(input.working_dir ?? ""));

    if (!fs.existsSync(workingDir) || !fs.statSync(workingDir).isDirectory()) {
      return err(`Directory not found: ${workingDir}`);
    }

    // Find the CLI binary — prefer tofu, fall back to terraform
    let cli: string | null = null;
    try {
      execSync("which tofu", { stdio: "pipe" });
      cli = "tofu";
    } catch {
      try {
        execSync("which terraform", { stdio: "pipe" });
        cli = "terraform";
      } catch {
        // Neither found
      }
    }

    if (!cli) {
      return err(
        "Neither 'tofu' nor 'terraform' found in PATH. " +
        "Install OpenTofu (https://opentofu.org) or Terraform to enable validation."
      );
    }

    const results: string[] = [`Using: ${cli}`];
    let validationPassed = false;

    // Run init
    try {
      const initOutput = execSync(`${cli} init -backend=false -no-color`, {
        cwd: workingDir,
        timeout: 60_000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      results.push(`\n--- ${cli} init ---`);
      if (initOutput) results.push(stripAnsi(initOutput));
    } catch (e: unknown) {
      results.push(`\n--- ${cli} init ---`);
      const execErr = e as { stdout?: string; stderr?: string; status?: number };
      if (execErr.stdout) results.push(stripAnsi(execErr.stdout));
      if (execErr.stderr) results.push(stripAnsi(execErr.stderr));
      results.push(`\n${cli} init failed (exit code ${execErr.status ?? "unknown"})`);

      const output = results.join("\n");
      callbacks?.onValidation?.(false, output);
      return err(output);
    }

    // Run validate with -json for structured output
    try {
      const validateOutput = execSync(`${cli} validate -json -no-color`, {
        cwd: workingDir,
        timeout: 60_000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      results.push(`\n--- ${cli} validate ---`);
      const parsed = parseValidateJson(validateOutput);
      if (parsed) {
        validationPassed = parsed.valid;
        if (parsed.diagnostics.length > 0) {
          for (const d of parsed.diagnostics) {
            const loc = d.range?.filename
              ? ` (${d.range.filename}:${d.range.start?.line ?? "?"})`
              : "";
            results.push(`  [${d.severity}]${loc} ${d.summary}: ${d.detail ?? ""}`);
          }
        }
        results.push(validationPassed ? "\nValidation PASSED" : "\nValidation FAILED");
      } else {
        // Fallback: couldn't parse JSON — show raw output
        if (validateOutput) results.push(stripAnsi(validateOutput));
        results.push("\nValidation PASSED");
        validationPassed = true;
      }
    } catch (e: unknown) {
      results.push(`\n--- ${cli} validate ---`);
      const execErr = e as { stdout?: string; stderr?: string; status?: number };
      // Try parsing structured JSON from stdout even on non-zero exit
      const parsed = parseValidateJson(execErr.stdout ?? "");
      if (parsed) {
        for (const d of parsed.diagnostics) {
          const loc = d.range?.filename
            ? ` (${d.range.filename}:${d.range.start?.line ?? "?"})`
            : "";
          results.push(`  [${d.severity}]${loc} ${d.summary}: ${d.detail ?? ""}`);
        }
      } else {
        if (execErr.stdout) results.push(stripAnsi(execErr.stdout));
        if (execErr.stderr) results.push(stripAnsi(execErr.stderr));
      }
      results.push(`\nValidation FAILED (exit code ${execErr.status ?? "unknown"})`);
      validationPassed = false;
    }

    const output = results.join("\n");
    callbacks?.onValidation?.(validationPassed, output);
    return validationPassed ? ok(output) : err(output);
  }

  // ------------------------------------------------------------------
  // Tool 7: list_bicep_files
  // ------------------------------------------------------------------
  async function listBicepFiles(
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const directory = path.resolve(String(input.directory ?? ""));
    const recursive =
      String(input.recursive ?? "false").trim().toLowerCase() === "true";

    if (
      !fs.existsSync(directory) ||
      !fs.statSync(directory).isDirectory()
    ) {
      return err(`Directory not found: ${directory}`);
    }

    const bicepFiles: { rel: string; size: number }[] = [];

    function scanDir(dir: string): void {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && recursive) {
          scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".bicep")) {
          const size = fs.statSync(fullPath).size;
          const rel = path.relative(directory, fullPath);
          bicepFiles.push({ rel, size });
        }
      }
    }

    scanDir(directory);
    bicepFiles.sort((a, b) => a.rel.localeCompare(b.rel));

    if (bicepFiles.length === 0) {
      return ok(`No .bicep files found in ${directory}`);
    }

    const lines = [
      `Directory: ${directory}`,
      `Recursive: ${recursive}`,
      "",
    ];
    for (const f of bicepFiles) {
      lines.push(`  ${f.rel} (${f.size} bytes)`);
    }
    lines.push(`\nTotal: ${bicepFiles.length} .bicep file(s)`);

    return ok(lines.join("\n"));
  }

  // ------------------------------------------------------------------
  // Tool 8: format_terraform
  // ------------------------------------------------------------------
  async function formatTerraform(
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const workingDir = path.resolve(String(input.working_dir ?? ""));

    if (!fs.existsSync(workingDir) || !fs.statSync(workingDir).isDirectory()) {
      return err(`Directory not found: ${workingDir}`);
    }

    // Find the CLI binary — prefer tofu, fall back to terraform
    let cli: string | null = null;
    try {
      execSync("which tofu", { stdio: "pipe" });
      cli = "tofu";
    } catch {
      try {
        execSync("which terraform", { stdio: "pipe" });
        cli = "terraform";
      } catch {
        // Neither found
      }
    }

    if (!cli) {
      return err(
        "Neither 'tofu' nor 'terraform' found in PATH. " +
        "Install OpenTofu (https://opentofu.org) or Terraform to enable formatting."
      );
    }

    try {
      const output = execSync(`${cli} fmt -recursive`, {
        cwd: workingDir,
        timeout: 30_000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      const modifiedFiles = output.trim().split("\n").filter(Boolean);

      // Re-read all .tf files in the directory and re-emit to UI so the
      // formatted content is reflected in the output panel.
      const updatedFiles: Record<string, string> = {};
      function collectTfFiles(dir: string, base: string): void {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = base ? `${base}/${entry.name}` : entry.name;
          if (entry.isDirectory()) {
            collectTfFiles(fullPath, relPath);
          } else if (entry.isFile() && (entry.name.endsWith(".tf") || entry.name.endsWith(".tfvars"))) {
            updatedFiles[relPath] = fs.readFileSync(fullPath, "utf-8");
          }
        }
      }
      collectTfFiles(workingDir, "");

      if (Object.keys(updatedFiles).length > 0) {
        callbacks?.onTerraformOutput?.(updatedFiles);
      }

      if (modifiedFiles.length === 0) {
        return ok(`${cli} fmt: All files already formatted correctly.`);
      }

      return ok(
        `${cli} fmt: Formatted ${modifiedFiles.length} file(s):\n` +
        modifiedFiles.map((f) => `  ${f}`).join("\n"),
      );
    } catch (e: unknown) {
      const execErr = e as { stdout?: string; stderr?: string; status?: number };
      const detail = execErr.stderr || execErr.stdout || String(e);
      return err(`${cli} fmt failed: ${detail}`);
    }
  }

  // ------------------------------------------------------------------
  // Tool 9: read_bicep_file_content (multi-file mode)
  // Reads a Bicep file from the in-memory bicepFilesContext map.
  // ------------------------------------------------------------------
  async function readBicepFileContent(
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const filePath = String(input.file_path ?? "").trim();

    if (!bicepFilesContext) {
      return err("read_bicep_file_content is only available in multi-file mode.");
    }

    const content = bicepFilesContext[filePath];
    if (content === undefined) {
      const available = Object.keys(bicepFilesContext).sort().join(", ");
      return err(
        `File not found in project: ${filePath}\nAvailable files: ${available}`,
      );
    }

    const lineCount = content.split("\n").length;
    return ok(
      `File: ${filePath}\nLines: ${lineCount}\n\n${content}`,
    );
  }

  // ------------------------------------------------------------------
  // Return the handler map
  // ------------------------------------------------------------------
  const handlerMap: Record<string, (input: Record<string, unknown>) => Promise<ToolResult>> = {
    read_bicep_file: readBicepFile,
    parse_bicep: parseBicep,
    lookup_resource_mapping: lookupResourceMapping,
    generate_terraform: generateTerraform,
    write_terraform_files: writeTerraformFiles,
    validate_terraform: validateTerraform,
    format_terraform: formatTerraform,
    list_bicep_files: listBicepFiles,
  };

  // Add read_bicep_file_content when multi-file context is provided
  if (bicepFilesContext) {
    handlerMap.read_bicep_file_content = readBicepFileContent;
  }

  return handlerMap;
}
