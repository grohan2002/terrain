import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Mock sessionStorage
// ---------------------------------------------------------------------------
const mockStorage: Record<string, string> = {};
const mockSessionStorage = {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockStorage[key] = value;
  }),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

vi.stubGlobal("sessionStorage", mockSessionStorage);

// ---------------------------------------------------------------------------
// Mock deploy-stream-client
// ---------------------------------------------------------------------------
const { mockSendDeployStream } = vi.hoisted(() => ({
  mockSendDeployStream: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/deploy-stream-client", () => ({
  sendDeployStream: mockSendDeployStream,
}));

// ---------------------------------------------------------------------------
// Mock toast
// ---------------------------------------------------------------------------
const { mockToast, mockToastError, mockToastSuccess } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

vi.mock("@/components/ui/sonner", () => ({
  toast: Object.assign(mockToast, {
    error: mockToastError,
    success: mockToastSuccess,
  }),
}));

// ---------------------------------------------------------------------------
// Mock Zustand store
// ---------------------------------------------------------------------------
const storeMethods = {
  terraformFiles: { "main.tf": 'resource "azurerm_resource_group" "rg" {}' },
  bicepContent: "resource storageAccount ...",
  deployWorkingDir: "/tmp/test-deploy",
  deployResourceGroup: "test-rg",
  deploySummary: null as null | { resourceGroupName: string; resourcesDeployed: number; testsPassed: number; testsFailed: number; destroyed: boolean },
  resetDeployment: vi.fn(),
  setDeploymentStatus: vi.fn(),
  addDeployMessage: vi.fn(),
  setDeployWorkingDir: vi.fn(),
  setDeployResourceGroup: vi.fn(),
  appendDeployStreamingText: vi.fn(),
  setDeployActiveToolName: vi.fn(),
  addDeployToolCall: vi.fn(),
  setDeployPhase: vi.fn(),
  addTestResult: vi.fn(),
  setDeployOutputs: vi.fn(),
  setDeploymentProgress: vi.fn(),
  setDeploySummary: vi.fn(),
  setDeployCostInfo: vi.fn(),
};

vi.mock("@/lib/store", () => ({
  useConversionStore: {
    getState: () => storeMethods,
  },
}));

// ---------------------------------------------------------------------------
// Import hook under test AFTER mocks are registered
// ---------------------------------------------------------------------------
import { useDeployment } from "@/hooks/use-deployment";

// We can't use renderHook since use-deployment is "use client" but uses
// useCallback. Instead, test the hook behavior via direct calls since
// it internally just creates stable callbacks.

// Since renderHook may cause issues in this env, we'll call the hook
// at the module level and test the returned functions.
// The hook uses useCallback which requires React context. Let's use renderHook.
import { renderHook, act } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const AZURE_CONFIG_STORAGE_KEY = "azure-deploy-config";

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mockStorage)) {
    delete mockStorage[key];
  }
  storeMethods.terraformFiles = { "main.tf": 'resource "azurerm_resource_group" "rg" {}' };
  storeMethods.bicepContent = "resource storageAccount ...";
  storeMethods.deployWorkingDir = "/tmp/test-deploy";
  storeMethods.deployResourceGroup = "test-rg";
  storeMethods.deploySummary = null;
});

describe("useDeployment", () => {
  describe("startDeployment", () => {
    it("shows error toast when no terraform files exist", async () => {
      storeMethods.terraformFiles = {};
      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.startDeployment();
      });

      expect(mockToastError).toHaveBeenCalledWith("No Terraform files to deploy");
    });

    it("calls resetDeployment and sets status to deploying", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ workingDir: "/tmp/deploy-123", resourceGroupName: "rg-test" }),
      });

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.startDeployment("api-key", {
          subscriptionId: "sub",
          tenantId: "tenant",
          clientId: "client",
          clientSecret: "secret",
        });
      });

      expect(storeMethods.resetDeployment).toHaveBeenCalled();
      expect(storeMethods.setDeploymentStatus).toHaveBeenCalledWith("deploying");
    });

    it("sends azureConfig in setup fetch body", async () => {
      const azureConfig = {
        subscriptionId: "sub-123",
        tenantId: "tenant-456",
        clientId: "client-789",
        clientSecret: "secret-abc",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ workingDir: "/tmp/deploy", resourceGroupName: "rg" }),
      });

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.startDeployment("api-key", azureConfig);
      });

      // Check the setup fetch call
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/deploy/setup",
        expect.objectContaining({
          method: "POST",
          body: expect.any(String),
        }),
      );

      const setupCall = mockFetch.mock.calls[0];
      const body = JSON.parse(setupCall[1].body);
      expect(body.azureConfig).toEqual(azureConfig);
    });

    it("passes azureConfig to sendDeployStream", async () => {
      const azureConfig = {
        subscriptionId: "sub-123",
        tenantId: "tenant-456",
        clientId: "client-789",
        clientSecret: "secret-abc",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ workingDir: "/tmp/deploy", resourceGroupName: "rg" }),
      });

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.startDeployment("api-key", azureConfig);
      });

      // sendDeployStream should be called with azureConfig as last arg
      expect(mockSendDeployStream).toHaveBeenCalledWith(
        expect.any(Object), // terraformFiles
        "/tmp/deploy",       // workingDir
        "rg",                // resourceGroupName
        expect.any(String),  // bicepContent
        expect.any(Object),  // callbacks
        expect.anything(),   // signal
        "api-key",           // apiKey
        azureConfig,         // azureConfig
      );
    });

    it("does not include azureConfig in body when not provided", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ workingDir: "/tmp/deploy", resourceGroupName: "rg" }),
      });

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.startDeployment("api-key");
      });

      const setupCall = mockFetch.mock.calls[0];
      const body = JSON.parse(setupCall[1].body);
      expect(body.azureConfig).toBeUndefined();
    });

    it("handles setup failure gracefully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: "Azure auth failed" }),
      });

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.startDeployment("api-key");
      });

      expect(storeMethods.setDeploymentStatus).toHaveBeenCalledWith("error");
      expect(mockToastError).toHaveBeenCalledWith(
        "Deployment setup failed",
        expect.objectContaining({ description: "Azure auth failed" }),
      );
    });
  });

  describe("destroyResources", () => {
    it("reads azureConfig from sessionStorage for destroy", async () => {
      const azureConfig = {
        subscriptionId: "sub-destroy",
        tenantId: "tenant-destroy",
        clientId: "client-destroy",
        clientSecret: "secret-destroy",
      };
      mockStorage[AZURE_CONFIG_STORAGE_KEY] = JSON.stringify(azureConfig);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, output: "Destroy complete" }),
      });

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.destroyResources();
      });

      const destroyCall = mockFetch.mock.calls[0];
      const body = JSON.parse(destroyCall[1].body);
      expect(body.azureConfig).toEqual(azureConfig);
    });

    it("does not include azureConfig in destroy when not in sessionStorage", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, output: "Destroy complete" }),
      });

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.destroyResources();
      });

      const destroyCall = mockFetch.mock.calls[0];
      const body = JSON.parse(destroyCall[1].body);
      expect(body.azureConfig).toBeUndefined();
    });

    it("sets deployment status to destroying", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, output: "done" }),
      });

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.destroyResources();
      });

      expect(storeMethods.setDeploymentStatus).toHaveBeenCalledWith("destroying");
    });

    it("sets deployment status to done on success", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, output: "Destroy complete" }),
      });

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.destroyResources();
      });

      expect(storeMethods.setDeploymentStatus).toHaveBeenCalledWith("done");
      expect(mockToastSuccess).toHaveBeenCalledWith(
        "Resources destroyed",
        expect.any(Object),
      );
    });

    it("shows error toast when no deployment to destroy", async () => {
      storeMethods.deployWorkingDir = "";
      storeMethods.deployResourceGroup = "";

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.destroyResources();
      });

      expect(mockToastError).toHaveBeenCalledWith("No deployment to destroy");
    });

    it("handles destroy failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: "Destroy failed: timeout" }),
      });

      const { result } = renderHook(() => useDeployment());

      await act(async () => {
        await result.current.destroyResources();
      });

      expect(storeMethods.setDeploymentStatus).toHaveBeenCalledWith("error");
      expect(mockToastError).toHaveBeenCalledWith(
        "Destroy failed",
        expect.objectContaining({ description: expect.any(String) }),
      );
    });
  });

  describe("keepResources", () => {
    it("sets deployment status to done", () => {
      const { result } = renderHook(() => useDeployment());

      act(() => {
        result.current.keepResources();
      });

      expect(storeMethods.setDeploymentStatus).toHaveBeenCalledWith("done");
    });

    it("adds a message about resources being kept", () => {
      const { result } = renderHook(() => useDeployment());

      act(() => {
        result.current.keepResources();
      });

      expect(storeMethods.addDeployMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          role: "assistant",
          content: expect.stringContaining("Resources kept"),
        }),
      );
    });
  });

  describe("cancelDeployment", () => {
    it("sets deployment status to idle", () => {
      const { result } = renderHook(() => useDeployment());

      act(() => {
        result.current.cancelDeployment();
      });

      expect(storeMethods.setDeploymentStatus).toHaveBeenCalledWith("idle");
    });

    it("clears active tool name", () => {
      const { result } = renderHook(() => useDeployment());

      act(() => {
        result.current.cancelDeployment();
      });

      expect(storeMethods.setDeployActiveToolName).toHaveBeenCalledWith(null);
    });

    it("clears deployment progress", () => {
      const { result } = renderHook(() => useDeployment());

      act(() => {
        result.current.cancelDeployment();
      });

      expect(storeMethods.setDeploymentProgress).toHaveBeenCalledWith(null);
    });
  });
});
