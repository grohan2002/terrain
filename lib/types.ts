// ---------------------------------------------------------------------------
// Bicep-to-Terraform UI — shared TypeScript types
// ---------------------------------------------------------------------------

/** Token usage and cost info for a conversion/deployment run. */
export interface CostInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCostUsd: number;
  model: string;
}

/** Discriminated union for server-sent stream events. */
export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; toolName: string; toolInput: Record<string, unknown> }
  | { type: "tool_result"; toolName: string; isError: boolean }
  | { type: "terraform_output"; files: TerraformFiles }
  | { type: "validation"; passed: boolean; output: string }
  | { type: "progress"; step: number; total: number; label: string }
  | { type: "coverage_report"; report: CoverageReportWire }
  | { type: "done"; fullReply: string; toolCalls: ToolCallInfo[]; costInfo?: CostInfo; model?: string }
  | { type: "error"; message: string };

/**
 * Wire-format coverage report sent after a conversion completes. Mirrors
 * `lib/coverage.ts` → `CoverageReport` but drops the opaque regex-matched
 * SourceResource / GeneratedResource shapes in favour of plain data so the
 * UI can render without the lib runtime.
 */
export interface CoverageReportWire {
  /** Source resources we expected to see mapped into the output. */
  expected: Array<{
    sourceType: string;
    logicalName: string;
    /** `null` = no TF equivalent; `undefined` = not in built-in map. */
    expectedTfType: string | null | undefined;
  }>;
  /** TF `resource "type" "name"` headers actually generated. */
  generated: Array<{ tfType: string; tfName: string; file: string }>;
  /** Source resources matched to a generated TF block of the expected type. */
  matched: Array<{ sourceType: string; logicalName: string }>;
  /** Expected source resources whose TF type did not appear in the output. */
  missing: Array<{ sourceType: string; logicalName: string }>;
  /** Source types we had no mapping for — excluded from the coverage score. */
  unmappedSourceTypes: string[];
  /** Score in [0, 1]. */
  coverage: number;
}

/** Overall conversion lifecycle status. */
export type ConversionStatus =
  | "idle"
  | "converting"
  | "validating"
  | "done"
  | "error";

/** Map of filename -> HCL content for generated Terraform files. */
export type TerraformFiles = Record<string, string>;

/** Result of running `tofu validate` / `terraform validate`. */
export interface ValidationResult {
  passed: boolean;
  output: string;
  errors?: ValidationError[];
}

/** A single validation diagnostic. */
export interface ValidationError {
  line?: number;
  message: string;
  severity: "error" | "warning";
}

/** Source IaC format for a conversion. */
export type SourceFormat = "bicep" | "cloudformation";

/** One entry in the conversion history sidebar. */
export interface ConversionHistoryEntry {
  id: string;
  timestamp: string;
  bicepFile: string;
  bicepContent: string;
  terraformFiles: TerraformFiles;
  validationPassed: boolean;
  agentConversation: ConversationMessage[];
  resourcesConverted: number;
  /** Multi-file project fields */
  isMultiFile?: boolean;
  bicepFiles?: BicepFiles;
  entryPoint?: string;
  /** Number of Bicep files in the project (for display) */
  bicepFileCount?: number;
  /** Token usage and cost info (added post-launch; absent on legacy entries) */
  costInfo?: CostInfo;
  /**
   * Which source IaC language the input was. Absent on legacy entries from
   * before CloudFormation support — treat those as "bicep".
   */
  sourceFormat?: SourceFormat;
}

/** A single message in the agent conversation log. */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallInfo[];
  timestamp: string;
}

/** Metadata about a single tool invocation. */
export interface ToolCallInfo {
  tool: string;
  input: Record<string, unknown>;
}

/** Progress indicator for multi-step conversion. */
export interface ConversionProgress {
  step: number;
  total: number;
  label: string;
}

// ---------------------------------------------------------------------------
// Azure Deployment Configuration
// ---------------------------------------------------------------------------

/** Azure Service Principal credentials for deployment. */
export interface AzureConfig {
  subscriptionId: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

// ---------------------------------------------------------------------------
// Deployment Agent Types
// ---------------------------------------------------------------------------

/** Discriminated union for deployment SSE events. */
export type DeployStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; toolName: string; toolInput: Record<string, unknown> }
  | { type: "tool_result"; toolName: string; isError: boolean }
  | { type: "deploy_progress"; phase: DeployPhase; detail: string }
  | { type: "test_result"; testName: string; passed: boolean; detail: string }
  | { type: "outputs"; outputs: Record<string, string> }
  | { type: "progress"; step: number; total: number; label: string }
  | { type: "done"; fullReply: string; toolCalls: ToolCallInfo[]; summary: DeploySummary; costInfo?: CostInfo }
  | { type: "error"; message: string };

/** Deployment lifecycle phases. */
export type DeployPhase =
  | "planning"
  | "applying"
  | "testing"
  | "awaiting_destroy_decision"
  | "destroying"
  | "complete";

/** Overall deployment lifecycle status. */
export type DeploymentStatus =
  | "idle"
  | "deploying"
  | "testing"
  | "awaiting_destroy"
  | "destroying"
  | "done"
  | "error";

/** A single smoke test result. */
export interface TestResult {
  testName: string;
  passed: boolean;
  detail: string;
  category: "existence" | "connectivity" | "config_validation";
}

/** Summary emitted with the deployment "done" event. */
export interface DeploySummary {
  resourceGroupName: string;
  resourcesDeployed: number;
  testsPassed: number;
  testsFailed: number;
  destroyed: boolean;
}

/** Progress indicator for deployment steps. */
export interface DeploymentProgress {
  step: number;
  total: number;
  label: string;
}

// ---------------------------------------------------------------------------
// Security Scanning Types
// ---------------------------------------------------------------------------

/** A single finding from Trivy or similar scanner. */
export interface ScanFinding {
  ruleId: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  title: string;
  description: string;
  resource: string;
  file: string;
  lines?: { start: number; end: number };
  resolution?: string;
}

/** Result of a security scan. */
export interface ScanResult {
  passed: boolean;
  findings: ScanFinding[];
  scannedAt: string;
  scanner: string;
  /** Whether the real Trivy binary ran (true) or the built-in regex fallback was used (false). */
  trivyUsed?: boolean;
}

// ---------------------------------------------------------------------------
// OPA Policy Types
// ---------------------------------------------------------------------------

/** A single policy violation. */
export interface PolicyViolation {
  policy: string;
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  resource?: string;
}

/** Result of OPA policy evaluation. */
export interface PolicyResult {
  passed: boolean;
  violations: PolicyViolation[];
  evaluatedAt: string;
  /** Whether the real OPA binary ran (true) or the built-in regex fallback was used (false). */
  opaUsed?: boolean;
}

// ---------------------------------------------------------------------------
// Infracost Types
// ---------------------------------------------------------------------------

/** Cost breakdown for a single resource. */
export interface ResourceCostEstimate {
  name: string;
  resourceType: string;
  monthlyCost: number;
  hourlyCost: number;
  costComponents: { name: string; monthlyCost: number; unit: string; quantity: number }[];
}

/** Full cost estimate result. */
export interface CostEstimateResult {
  totalMonthlyCost: number;
  totalHourlyCost: number;
  resources: ResourceCostEstimate[];
  currency: string;
  estimatedAt: string;
  /** Whether Infracost ran (true) or the built-in fallback map was used (false). */
  infracostUsed?: boolean;
}

// ---------------------------------------------------------------------------
// Multi-File Module Support Types
// ---------------------------------------------------------------------------

/** Map of relative file path → Bicep content for multi-file input. */
export type BicepFiles = Record<string, string>;

/** Metadata about a Bicep module reference found during parsing. */
export interface BicepModuleRef {
  /** Symbolic name of the module declaration */
  name: string;
  /** Relative path from the declaring file, e.g. './modules/storage.bicep' */
  source: string;
  /** The file that contains this module declaration */
  declaredIn: string;
  /** Resolved path key into BicepFiles, e.g. 'modules/storage.bicep' */
  resolvedPath: string | null;
}

/** Dependency graph for multi-file Bicep projects. */
export interface BicepDependencyGraph {
  /** All files in the project, keyed by relative path */
  files: string[];
  /** Module references between files */
  modules: BicepModuleRef[];
  /** Topological order for processing (leaves first) */
  processingOrder: string[];
  /** Files that could not be resolved */
  unresolvedModules: BicepModuleRef[];
}

/** Summary of input context for the agent, used for large-codebase strategies. */
export interface InputContextSummary {
  totalFiles: number;
  totalLines: number;
  totalBytes: number;
  entryPoint: string;
  /** Whether the combined content exceeds the token budget */
  exceedsTokenBudget: boolean;
}

// ---------------------------------------------------------------------------
// CloudFormation multi-file (nested-stack) support
// ---------------------------------------------------------------------------

/** Map of relative file path → CloudFormation template content (YAML or JSON). */
export type CloudFormationFiles = Record<string, string>;

/**
 * A nested-stack reference found inside a CloudFormation template — i.e. an
 * `AWS::CloudFormation::Stack` resource whose `Properties.TemplateURL` points
 * at another template.
 */
export interface CloudFormationModuleRef {
  /** Logical resource ID of the AWS::CloudFormation::Stack resource. */
  name: string;
  /** Original `TemplateURL` value as written, e.g. './templates/storage.yaml' or 'https://s3.amazonaws.com/...'. */
  source: string;
  /** The file that contains this nested-stack declaration. */
  declaredIn: string;
  /**
   * Resolved key into CloudFormationFiles for relative paths. `null` for
   * external `TemplateURL`s (HTTPS / S3 — cannot be resolved offline).
   */
  resolvedPath: string | null;
}

/** Dependency graph for multi-file CloudFormation projects (nested stacks). */
export interface CloudFormationDependencyGraph {
  files: string[];
  modules: CloudFormationModuleRef[];
  processingOrder: string[];
  unresolvedModules: CloudFormationModuleRef[];
}
