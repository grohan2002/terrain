// ---------------------------------------------------------------------------
// Tool handler implementations for the deployment testing agent.
// Uses Node.js APIs (child_process, fs) — server-side only.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { ok, err, type ToolResult } from "../tool-result";

// ---------------------------------------------------------------------------
// Callbacks for side-effects the stream layer cares about
// ---------------------------------------------------------------------------

export interface DeployToolCallbacks {
  onDeployProgress?: (phase: string, detail: string) => void;
  onTestResult?: (testName: string, passed: boolean, detail: string) => void;
  onOutputs?: (outputs: Record<string, string>) => void;
}

// ---------------------------------------------------------------------------
// CLI detection helper (shared across handlers)
// ---------------------------------------------------------------------------

function findCli(): string | null {
  try {
    execSync("which tofu", { stdio: "pipe" });
    return "tofu";
  } catch {
    try {
      execSync("which terraform", { stdio: "pipe" });
      return "terraform";
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory — returns a name -> handler map
// ---------------------------------------------------------------------------

export function createDeployToolHandlers(
  callbacks?: DeployToolCallbacks,
): Record<string, (input: Record<string, unknown>) => Promise<ToolResult>> {

  // ------------------------------------------------------------------
  // Tool 1: terraform_plan
  // ------------------------------------------------------------------
  async function terraformPlan(
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const workingDir = path.resolve(String(input.working_dir ?? ""));
    const cli = findCli();

    if (!cli) {
      return err("Neither 'tofu' nor 'terraform' found in PATH.");
    }

    if (!fs.existsSync(workingDir)) {
      return err(`Directory not found: ${workingDir}`);
    }

    callbacks?.onDeployProgress?.("planning", "Running terraform plan...");

    try {
      const output = execSync(
        `${cli} plan -no-color -input=false`,
        {
          cwd: workingDir,
          timeout: 120_000,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      return ok(`${cli} plan output:\n\n${output}`);
    } catch (e: unknown) {
      const execErr = e as { stdout?: string; stderr?: string; status?: number };
      const combined = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n");
      return err(`${cli} plan failed (exit ${execErr.status ?? "unknown"}):\n${combined}`);
    }
  }

  // ------------------------------------------------------------------
  // Tool 2: terraform_apply
  // ------------------------------------------------------------------
  async function terraformApply(
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const workingDir = path.resolve(String(input.working_dir ?? ""));
    const cli = findCli();

    if (!cli) {
      return err("Neither 'tofu' nor 'terraform' found in PATH.");
    }

    callbacks?.onDeployProgress?.("applying", "Running terraform apply...");

    try {
      const output = execSync(
        `${cli} apply -auto-approve -no-color -input=false`,
        {
          cwd: workingDir,
          timeout: 300_000,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      return ok(`${cli} apply output:\n\n${output}`);
    } catch (e: unknown) {
      const execErr = e as { stdout?: string; stderr?: string; status?: number };
      const combined = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n");
      return err(`${cli} apply failed (exit ${execErr.status ?? "unknown"}):\n${combined}`);
    }
  }

  // ------------------------------------------------------------------
  // Tool 3: get_terraform_outputs
  // ------------------------------------------------------------------
  async function getTerraformOutputs(
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const workingDir = path.resolve(String(input.working_dir ?? ""));
    const cli = findCli();

    if (!cli) {
      return err("Neither 'tofu' nor 'terraform' found in PATH.");
    }

    try {
      const output = execSync(`${cli} output -json -no-color`, {
        cwd: workingDir,
        timeout: 30_000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Parse and flatten outputs for the callback
      try {
        const parsed = JSON.parse(output) as Record<string, { value: unknown }>;
        const flat: Record<string, string> = {};
        for (const [key, val] of Object.entries(parsed)) {
          flat[key] = typeof val.value === "string" ? val.value : JSON.stringify(val.value);
        }
        callbacks?.onOutputs?.(flat);
      } catch {
        // Parsing failed — still return raw output
      }

      return ok(`Terraform outputs:\n\n${output}`);
    } catch (e: unknown) {
      const execErr = e as { stdout?: string; stderr?: string; status?: number };
      const combined = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n");
      return err(`${cli} output failed (exit ${execErr.status ?? "unknown"}):\n${combined}`);
    }
  }

  // ------------------------------------------------------------------
  // Tool 4: check_azure_resource
  // ------------------------------------------------------------------
  async function checkAzureResource(
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const resourceId = String(input.resource_id ?? "").trim();
    const resourceGroup = String(input.resource_group ?? "").trim();
    const resourceType = String(input.resource_type ?? "").trim();
    const resourceName = String(input.resource_name ?? "").trim();

    let cmd: string;
    let testName: string;

    if (resourceId) {
      cmd = `az resource show --ids "${resourceId}" -o json`;
      testName = resourceId.split("/").pop() ?? resourceId;
    } else if (resourceGroup && resourceType && resourceName) {
      cmd = `az resource show -g "${resourceGroup}" --resource-type "${resourceType}" -n "${resourceName}" -o json`;
      testName = resourceName;
    } else {
      return err("Provide either resource_id, or resource_group + resource_type + resource_name.");
    }

    callbacks?.onDeployProgress?.("testing", `Checking resource: ${testName}`);

    try {
      const output = execSync(cmd, {
        timeout: 30_000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      const parsed = JSON.parse(output);
      const provisioningState = parsed?.properties?.provisioningState ?? "Unknown";
      const passed = provisioningState === "Succeeded";
      const detail = `Resource exists. Provisioning state: ${provisioningState}`;

      callbacks?.onTestResult?.(`existence:${testName}`, passed, detail);

      return ok(`Resource: ${testName}\nProvisioning state: ${provisioningState}\n\n${output}`);
    } catch (e: unknown) {
      const execErr = e as { stderr?: string; status?: number };
      const detail = `Resource not found or error: ${execErr.stderr ?? "unknown error"}`;

      callbacks?.onTestResult?.(`existence:${testName}`, false, detail);

      return err(detail);
    }
  }

  // ------------------------------------------------------------------
  // Tool 5: run_connectivity_test
  // ------------------------------------------------------------------
  async function runConnectivityTest(
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const testType = String(input.test_type ?? "").trim().toLowerCase();
    const target = String(input.target ?? "").trim();
    const expectedStatus = Number(input.expected_status ?? 200);
    const timeout = Number(input.timeout_seconds ?? 10);

    if (!target) {
      return err("'target' is required.");
    }

    callbacks?.onDeployProgress?.("testing", `Connectivity test (${testType}): ${target}`);

    if (testType === "http") {
      try {
        const statusCode = execSync(
          `curl -s -o /dev/null -w "%{http_code}" --max-time ${timeout} "${target}"`,
          { timeout: (timeout + 5) * 1000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
        ).trim();

        const actual = parseInt(statusCode, 10);
        const passed = actual === expectedStatus;
        const detail = `HTTP ${actual} (expected ${expectedStatus})`;

        callbacks?.onTestResult?.(`connectivity:http:${target}`, passed, detail);

        return passed ? ok(`HTTP test: ${target}\nStatus: ${actual}\nExpected: ${expectedStatus}\nResult: PASS`) : err(`HTTP test: ${target}\nStatus: ${actual}\nExpected: ${expectedStatus}\nResult: FAIL`);
      } catch (e: unknown) {
        const detail = `HTTP request failed: ${(e as Error).message}`;
        callbacks?.onTestResult?.(`connectivity:http:${target}`, false, detail);
        return err(detail);
      }
    }

    if (testType === "dns") {
      try {
        const output = execSync(
          `dig +short "${target}" 2>/dev/null || nslookup "${target}" 2>/dev/null | grep -A1 "Name:" | tail -1`,
          { timeout: timeout * 1000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
        ).trim();

        const passed = output.length > 0;
        const detail = passed ? `Resolved to: ${output}` : "DNS resolution failed — no results";

        callbacks?.onTestResult?.(`connectivity:dns:${target}`, passed, detail);

        return ok(`DNS test: ${target}\nResult: ${passed ? "PASS" : "FAIL"}\n${detail}`);
      } catch (e: unknown) {
        const detail = `DNS lookup failed: ${(e as Error).message}`;
        callbacks?.onTestResult?.(`connectivity:dns:${target}`, false, detail);
        return err(detail);
      }
    }

    if (testType === "tcp") {
      const parts = target.split(":");
      const host = parts[0];
      const port = parts[1] ?? "443";

      try {
        execSync(
          `nc -z -w ${timeout} "${host}" ${port}`,
          { timeout: (timeout + 5) * 1000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
        );

        callbacks?.onTestResult?.(`connectivity:tcp:${target}`, true, `TCP port ${port} is open`);
        return ok(`TCP test: ${host}:${port}\nResult: PASS — port is open`);
      } catch {
        callbacks?.onTestResult?.(`connectivity:tcp:${target}`, false, `TCP port ${port} is closed or unreachable`);
        return err(`TCP test: ${host}:${port}\nResult: FAIL — port closed or unreachable`);
      }
    }

    return err(`Unknown test_type '${testType}'. Use 'http', 'dns', or 'tcp'.`);
  }

  // ------------------------------------------------------------------
  // Tool 6: check_resource_config
  // ------------------------------------------------------------------
  async function checkResourceConfig(
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const resourceId = String(input.resource_id ?? "").trim();
    const expectedPropsStr = String(input.expected_properties ?? "{}");

    if (!resourceId) {
      return err("'resource_id' is required.");
    }

    let expectedProps: Record<string, unknown>;
    try {
      expectedProps = JSON.parse(expectedPropsStr);
    } catch {
      return err("'expected_properties' must be valid JSON.");
    }

    const resourceName = resourceId.split("/").pop() ?? resourceId;
    callbacks?.onDeployProgress?.("testing", `Validating config: ${resourceName}`);

    let resourceJson: Record<string, unknown>;
    try {
      const output = execSync(
        `az resource show --ids "${resourceId}" -o json`,
        { timeout: 30_000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
      );
      resourceJson = JSON.parse(output);
    } catch (e: unknown) {
      const detail = `Failed to retrieve resource: ${(e as Error).message}`;
      callbacks?.onTestResult?.(`config:${resourceName}`, false, detail);
      return err(detail);
    }

    // Walk dot-notation paths and compare
    const results: string[] = [];
    let allPassed = true;

    for (const [propPath, expectedValue] of Object.entries(expectedProps)) {
      const actualValue = getNestedValue(resourceJson, propPath);
      const actualStr = JSON.stringify(actualValue);
      const expectedStr = JSON.stringify(expectedValue);
      const passed = actualStr === expectedStr;

      if (!passed) allPassed = false;

      const detail = passed
        ? `${propPath} = ${actualStr} (matches)`
        : `${propPath}: expected ${expectedStr}, got ${actualStr}`;

      results.push(`  ${passed ? "PASS" : "FAIL"}: ${detail}`);
      callbacks?.onTestResult?.(
        `config:${resourceName}:${propPath}`,
        passed,
        detail,
      );
    }

    const resultStr = `Config validation: ${resourceName}\nOverall: ${allPassed ? "PASS" : "FAIL"}\n${results.join("\n")}`;
    return allPassed ? ok(resultStr) : err(resultStr);
  }

  // ------------------------------------------------------------------
  // Tool 7: terraform_destroy
  // ------------------------------------------------------------------
  async function terraformDestroy(
    input: Record<string, unknown>,
  ): Promise<ToolResult> {
    const workingDir = path.resolve(String(input.working_dir ?? ""));
    const cli = findCli();

    if (!cli) {
      return err("Neither 'tofu' nor 'terraform' found in PATH.");
    }

    callbacks?.onDeployProgress?.("destroying", "Running terraform destroy...");

    try {
      const output = execSync(
        `${cli} destroy -auto-approve -no-color -input=false`,
        {
          cwd: workingDir,
          timeout: 300_000,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      return ok(`${cli} destroy output:\n\n${output}`);
    } catch (e: unknown) {
      const execErr = e as { stdout?: string; stderr?: string; status?: number };
      const combined = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n");
      return err(`${cli} destroy failed (exit ${execErr.status ?? "unknown"}):\n${combined}`);
    }
  }

  // ------------------------------------------------------------------
  // Return the handler map
  // ------------------------------------------------------------------
  return {
    terraform_plan: terraformPlan,
    terraform_apply: terraformApply,
    get_terraform_outputs: getTerraformOutputs,
    check_azure_resource: checkAzureResource,
    run_connectivity_test: runConnectivityTest,
    check_resource_config: checkResourceConfig,
    terraform_destroy: terraformDestroy,
  };
}

// ---------------------------------------------------------------------------
// Utility: walk a dot-notation path on an object
// ---------------------------------------------------------------------------

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}
