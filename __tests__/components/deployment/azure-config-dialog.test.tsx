import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { AzureConfigDialog } from "@/components/deployment/azure-config-dialog";
import type { AzureConfig } from "@/lib/types";

// ---------------------------------------------------------------------------
// Mock sessionStorage
// ---------------------------------------------------------------------------

const mockStorage: Record<string, string> = {};
const mockSessionStorage = {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockStorage[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockStorage[key];
  }),
  clear: vi.fn(() => {
    for (const key of Object.keys(mockStorage)) {
      delete mockStorage[key];
    }
  }),
  length: 0,
  key: vi.fn(),
};

Object.defineProperty(window, "sessionStorage", {
  value: mockSessionStorage,
  writable: true,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = "azure-deploy-config";

function renderDialog(overrides: Partial<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (config: AzureConfig) => void;
}> = {}) {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  return {
    ...render(<AzureConfigDialog {...defaultProps} />),
    ...defaultProps,
  };
}

/** Get an input by its associated label text via the 'for' attribute. */
function getInput(labelText: string): HTMLInputElement {
  const label = screen.getByText(labelText);
  const inputId = label.getAttribute("for");
  if (!inputId) throw new Error(`No 'for' attribute on label: ${labelText}`);
  return document.getElementById(inputId) as HTMLInputElement;
}

/** Fill all four credential fields with provided or default values. */
function fillForm(values: {
  subscriptionId?: string;
  tenantId?: string;
  clientId?: string;
  clientSecret?: string;
} = {}) {
  const defaults = {
    subscriptionId: "sub-1234-5678",
    tenantId: "tenant-1234-5678",
    clientId: "client-1234-5678",
    clientSecret: "my-secret",
    ...values,
  };

  fireEvent.change(getInput("Subscription ID"), {
    target: { value: defaults.subscriptionId },
  });
  fireEvent.change(getInput("Tenant ID"), {
    target: { value: defaults.tenantId },
  });
  fireEvent.change(getInput("Client ID (App ID)"), {
    target: { value: defaults.clientId },
  });
  fireEvent.change(getInput("Client Secret"), {
    target: { value: defaults.clientSecret },
  });

  return defaults;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(mockStorage)) {
    delete mockStorage[key];
  }
});

describe("AzureConfigDialog", () => {
  describe("rendering", () => {
    it("renders dialog when open=true", () => {
      renderDialog();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("does not render dialog when open=false", () => {
      renderDialog({ open: false });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("renders title with Azure Deployment Configuration", () => {
      renderDialog();
      expect(screen.getByText("Azure Deployment Configuration")).toBeInTheDocument();
    });

    it("renders all four credential input labels", () => {
      renderDialog();
      expect(screen.getByText("Subscription ID")).toBeInTheDocument();
      expect(screen.getByText("Tenant ID")).toBeInTheDocument();
      expect(screen.getByText("Client ID (App ID)")).toBeInTheDocument();
      expect(screen.getByText("Client Secret")).toBeInTheDocument();
    });

    it("renders Deploy & Test submit button", () => {
      renderDialog();
      expect(screen.getByText("Deploy & Test")).toBeInTheDocument();
    });

    it("renders Cancel button", () => {
      renderDialog();
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });

    it("renders Remember for this session checkbox", () => {
      renderDialog();
      expect(screen.getByText("Remember for this session")).toBeInTheDocument();
    });

    it("has the remember checkbox checked by default", () => {
      renderDialog();
      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).toBeChecked();
    });
  });

  describe("validation", () => {
    it("disables submit button when all fields are empty", () => {
      renderDialog();
      const submitButton = screen.getByText("Deploy & Test").closest("button");
      expect(submitButton).toBeDisabled();
    });

    it("disables submit button when only some fields are filled", () => {
      renderDialog();
      fireEvent.change(getInput("Subscription ID"), { target: { value: "sub-id" } });
      fireEvent.change(getInput("Tenant ID"), { target: { value: "tenant-id" } });
      // clientId and clientSecret are still empty
      const submitButton = screen.getByText("Deploy & Test").closest("button");
      expect(submitButton).toBeDisabled();
    });

    it("enables submit button when all fields are filled", () => {
      renderDialog();
      fillForm();
      const submitButton = screen.getByText("Deploy & Test").closest("button");
      expect(submitButton).not.toBeDisabled();
    });

    it("disables submit button when a field has only whitespace", () => {
      renderDialog();
      fillForm();
      // Now clear subscription to whitespace
      fireEvent.change(getInput("Subscription ID"), { target: { value: "   " } });
      const submitButton = screen.getByText("Deploy & Test").closest("button");
      expect(submitButton).toBeDisabled();
    });
  });

  describe("submission", () => {
    it("calls onSubmit with trimmed values on form submit", () => {
      const { onSubmit } = renderDialog();
      fillForm({
        subscriptionId: "  sub-1234  ",
        tenantId: "  tenant-5678  ",
        clientId: "  client-abcd  ",
        clientSecret: "  my-secret  ",
      });

      const submitButton = screen.getByText("Deploy & Test").closest("button")!;
      fireEvent.click(submitButton);

      expect(onSubmit).toHaveBeenCalledWith({
        subscriptionId: "sub-1234",
        tenantId: "tenant-5678",
        clientId: "client-abcd",
        clientSecret: "my-secret",
      });
    });

    it("calls onOpenChange(false) on submit", () => {
      const { onOpenChange } = renderDialog();
      fillForm();
      const submitButton = screen.getByText("Deploy & Test").closest("button")!;
      fireEvent.click(submitButton);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("stores config in sessionStorage when remember checkbox is checked", () => {
      renderDialog();
      fillForm();
      const submitButton = screen.getByText("Deploy & Test").closest("button")!;
      fireEvent.click(submitButton);

      expect(mockSessionStorage.setItem).toHaveBeenCalledWith(
        STORAGE_KEY,
        expect.any(String),
      );

      // Verify the stored value is valid JSON with the right shape
      const storedValue = mockSessionStorage.setItem.mock.calls[0][1];
      const parsed = JSON.parse(storedValue);
      expect(parsed.subscriptionId).toBe("sub-1234-5678");
      expect(parsed.tenantId).toBe("tenant-1234-5678");
      expect(parsed.clientId).toBe("client-1234-5678");
      expect(parsed.clientSecret).toBe("my-secret");
    });

    it("does not store config when remember checkbox is unchecked", () => {
      renderDialog();

      // Uncheck the remember checkbox
      const checkbox = screen.getByRole("checkbox");
      fireEvent.click(checkbox);

      fillForm();
      const submitButton = screen.getByText("Deploy & Test").closest("button")!;
      fireEvent.click(submitButton);

      expect(mockSessionStorage.setItem).not.toHaveBeenCalled();
    });

    it("submits via form submit event (Enter key)", () => {
      const { onSubmit } = renderDialog();
      fillForm();

      const form = screen.getByRole("dialog").querySelector("form")!;
      fireEvent.submit(form);

      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe("cancel", () => {
    it("calls onOpenChange(false) when Cancel is clicked", () => {
      const { onOpenChange } = renderDialog();
      fireEvent.click(screen.getByText("Cancel"));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("does not call onSubmit when Cancel is clicked", () => {
      const { onSubmit } = renderDialog();
      fireEvent.click(screen.getByText("Cancel"));
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });

  describe("session storage pre-population", () => {
    it("pre-populates fields from sessionStorage when dialog opens", () => {
      const cached: AzureConfig = {
        subscriptionId: "cached-sub",
        tenantId: "cached-tenant",
        clientId: "cached-client",
        clientSecret: "cached-secret",
      };
      mockStorage[STORAGE_KEY] = JSON.stringify(cached);

      renderDialog();

      expect(getInput("Subscription ID")).toHaveValue("cached-sub");
      expect(getInput("Tenant ID")).toHaveValue("cached-tenant");
      expect(getInput("Client ID (App ID)")).toHaveValue("cached-client");
      expect(getInput("Client Secret")).toHaveValue("cached-secret");
    });

    it("handles invalid JSON in sessionStorage gracefully", () => {
      mockStorage[STORAGE_KEY] = "not-valid-json";

      // Should not throw
      expect(() => renderDialog()).not.toThrow();
    });

    it("handles empty sessionStorage gracefully", () => {
      // No cached config
      renderDialog();

      expect(getInput("Subscription ID")).toHaveValue("");
      expect(getInput("Tenant ID")).toHaveValue("");
      expect(getInput("Client ID (App ID)")).toHaveValue("");
      expect(getInput("Client Secret")).toHaveValue("");
    });
  });

  describe("input types", () => {
    it("renders Client Secret as password input", () => {
      renderDialog();
      expect(getInput("Client Secret")).toHaveAttribute("type", "password");
    });

    it("renders Subscription ID as text input", () => {
      renderDialog();
      expect(getInput("Subscription ID")).toHaveAttribute("type", "text");
    });

    it("all credential inputs have autocomplete=off", () => {
      renderDialog();
      expect(getInput("Subscription ID")).toHaveAttribute("autocomplete", "off");
      expect(getInput("Tenant ID")).toHaveAttribute("autocomplete", "off");
      expect(getInput("Client ID (App ID)")).toHaveAttribute("autocomplete", "off");
      expect(getInput("Client Secret")).toHaveAttribute("autocomplete", "off");
    });
  });
});
