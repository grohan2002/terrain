"use client";

// ---------------------------------------------------------------------------
// Zustand store for the Bicep-to-Terraform UI.
//
// Holds all client-side state: editor content, conversion status, streaming
// text, tool activity, validation results, conversation history, etc.
//
// History is persisted to localStorage manually (not via zustand/persist
// middleware which conflicts with React 19 concurrent rendering).
// ---------------------------------------------------------------------------

import { create } from "zustand";
import type {
  BicepFiles,
  ConversionStatus,
  TerraformFiles,
  ValidationResult,
  ConversationMessage,
  ToolCallInfo,
  ConversionProgress,
  ConversionHistoryEntry,
  DeploymentStatus,
  DeploymentProgress,
  DeployPhase,
  TestResult,
  DeploySummary,
  CostInfo,
} from "./types";

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export interface ConversionState {
  // Bicep input
  bicepContent: string;
  bicepFilename: string;

  // Multi-file input
  bicepFiles: BicepFiles;
  isMultiFile: boolean;
  entryPoint: string;

  // Terraform output
  terraformFiles: TerraformFiles;

  // Lifecycle
  status: ConversionStatus;
  progress: ConversionProgress | null;

  // Streaming
  streamingText: string;
  activeToolName: string | null;

  // Validation
  validationResult: ValidationResult | null;

  // Agent conversation
  messages: ConversationMessage[];
  toolCalls: ToolCallInfo[];

  // History
  history: ConversionHistoryEntry[];

  // Cost tracking
  costInfo: CostInfo | null;
  deployCostInfo: CostInfo | null;

  // ---- Deployment state ----
  deploymentStatus: DeploymentStatus;
  deploymentProgress: DeploymentProgress | null;
  deployPhase: DeployPhase | null;
  deployStreamingText: string;
  deployActiveToolName: string | null;
  deployMessages: ConversationMessage[];
  deployToolCalls: ToolCallInfo[];
  testResults: TestResult[];
  deployOutputs: Record<string, string>;
  deploySummary: DeploySummary | null;
  deployWorkingDir: string | null;
  deployResourceGroup: string | null;

  // Actions — conversion
  setBicepContent: (content: string, filename?: string) => void;
  setBicepFiles: (files: BicepFiles, entryPoint?: string) => void;
  clearBicepFiles: () => void;
  setTerraformFiles: (files: TerraformFiles) => void;
  setStatus: (status: ConversionStatus) => void;
  setProgress: (progress: ConversionProgress | null) => void;
  appendStreamingText: (text: string) => void;
  resetStreamingText: () => void;
  setActiveToolName: (name: string | null) => void;
  setValidationResult: (result: ValidationResult | null) => void;
  addMessage: (message: ConversationMessage) => void;
  addToolCall: (toolCall: ToolCallInfo) => void;
  addHistoryEntry: (entry: ConversionHistoryEntry) => void;
  setHistory: (history: ConversionHistoryEntry[]) => void;
  setCostInfo: (info: CostInfo | null) => void;
  setDeployCostInfo: (info: CostInfo | null) => void;
  reset: () => void;
  resetConversion: () => void;

  // Actions — deployment
  setDeploymentStatus: (status: DeploymentStatus) => void;
  setDeploymentProgress: (progress: DeploymentProgress | null) => void;
  setDeployPhase: (phase: DeployPhase | null) => void;
  appendDeployStreamingText: (text: string) => void;
  setDeployActiveToolName: (name: string | null) => void;
  addDeployMessage: (message: ConversationMessage) => void;
  addDeployToolCall: (toolCall: ToolCallInfo) => void;
  addTestResult: (result: TestResult) => void;
  setDeployOutputs: (outputs: Record<string, string>) => void;
  setDeploySummary: (summary: DeploySummary | null) => void;
  setDeployWorkingDir: (dir: string | null) => void;
  setDeployResourceGroup: (name: string | null) => void;
  resetDeployment: () => void;
}

// ---------------------------------------------------------------------------
// Initial values for the conversion-related subset (reused by reset actions)
// ---------------------------------------------------------------------------

const initialConversionState = {
  terraformFiles: {} as TerraformFiles,
  status: "idle" as ConversionStatus,
  progress: null as ConversionProgress | null,
  streamingText: "",
  activeToolName: null as string | null,
  validationResult: null as ValidationResult | null,
  messages: [] as ConversationMessage[],
  toolCalls: [] as ToolCallInfo[],
  costInfo: null as CostInfo | null,
};

const initialDeploymentState = {
  deploymentStatus: "idle" as DeploymentStatus,
  deploymentProgress: null as DeploymentProgress | null,
  deployPhase: null as DeployPhase | null,
  deployStreamingText: "",
  deployActiveToolName: null as string | null,
  deployMessages: [] as ConversationMessage[],
  deployToolCalls: [] as ToolCallInfo[],
  testResults: [] as TestResult[],
  deployOutputs: {} as Record<string, string>,
  deploySummary: null as DeploySummary | null,
  deployWorkingDir: null as string | null,
  deployResourceGroup: null as string | null,
  deployCostInfo: null as CostInfo | null,
};

// ---------------------------------------------------------------------------
// localStorage persistence helpers (history only)
// ---------------------------------------------------------------------------

const STORAGE_KEY = "bicep-converter-history";

function loadHistory(): ConversionHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: ConversionHistoryEntry[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // localStorage full or unavailable – silently ignore
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useConversionStore = create<ConversionState>()((set) => ({
  bicepContent: "",
  bicepFilename: "",
  bicepFiles: {} as BicepFiles,
  isMultiFile: false,
  entryPoint: "",
  ...initialConversionState,
  ...initialDeploymentState,
  history: [],

  setBicepContent: (content, filename) =>
    set({
      bicepContent: content,
      ...(filename !== undefined ? { bicepFilename: filename } : {}),
      isMultiFile: false,
    }),

  setBicepFiles: (files, ep) => {
    const entryPoint = ep ?? Object.keys(files)[0] ?? "";
    set({
      bicepFiles: files,
      isMultiFile: true,
      entryPoint,
      bicepContent: files[entryPoint] ?? "",
      bicepFilename: entryPoint,
    });
  },

  clearBicepFiles: () =>
    set({
      bicepFiles: {} as BicepFiles,
      isMultiFile: false,
      entryPoint: "",
    }),

  setTerraformFiles: (files) => set({ terraformFiles: files }),

  setStatus: (status) => set({ status }),

  setProgress: (progress) => set({ progress }),

  appendStreamingText: (text) =>
    set((state) => ({ streamingText: state.streamingText + text })),

  resetStreamingText: () => set({ streamingText: "" }),

  setActiveToolName: (name) => set({ activeToolName: name }),

  setValidationResult: (result) => set({ validationResult: result }),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  addToolCall: (toolCall) =>
    set((state) => ({ toolCalls: [...state.toolCalls, toolCall] })),

  addHistoryEntry: (entry) =>
    set((state) => {
      const history = [entry, ...state.history];
      saveHistory(history);
      return { history };
    }),

  setHistory: (history) => {
    saveHistory(history);
    set({ history });
  },

  setCostInfo: (info) => set({ costInfo: info }),
  setDeployCostInfo: (info) => set({ deployCostInfo: info }),

  reset: () =>
    set({
      bicepContent: "",
      bicepFilename: "",
      bicepFiles: {} as BicepFiles,
      isMultiFile: false,
      entryPoint: "",
      ...initialConversionState,
      ...initialDeploymentState,
    }),

  resetConversion: () => set(initialConversionState),

  // ---- Deployment actions ----
  setDeploymentStatus: (status) => set({ deploymentStatus: status }),

  setDeploymentProgress: (progress) => set({ deploymentProgress: progress }),

  setDeployPhase: (phase) => set({ deployPhase: phase }),

  appendDeployStreamingText: (text) =>
    set((state) => ({ deployStreamingText: state.deployStreamingText + text })),

  setDeployActiveToolName: (name) => set({ deployActiveToolName: name }),

  addDeployMessage: (message) =>
    set((state) => ({ deployMessages: [...state.deployMessages, message] })),

  addDeployToolCall: (toolCall) =>
    set((state) => ({ deployToolCalls: [...state.deployToolCalls, toolCall] })),

  addTestResult: (result) =>
    set((state) => ({ testResults: [...state.testResults, result] })),

  setDeployOutputs: (outputs) => set({ deployOutputs: outputs }),

  setDeploySummary: (summary) => set({ deploySummary: summary }),

  setDeployWorkingDir: (dir) => set({ deployWorkingDir: dir }),

  setDeployResourceGroup: (name) => set({ deployResourceGroup: name }),

  resetDeployment: () => set(initialDeploymentState),
}));

// Dev-only: expose store on window for manual/E2E testing
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__store = useConversionStore;
}

// ---------------------------------------------------------------------------
// Computed selectors
// ---------------------------------------------------------------------------

export const selectIsConverting = (state: ConversionState) =>
  state.status === "converting";

export const selectHasOutput = (state: ConversionState) =>
  Object.keys(state.terraformFiles).length > 0;

export const selectFileNames = (state: ConversionState) =>
  Object.keys(state.terraformFiles);
