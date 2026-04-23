import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the MCP client module before importing schema-prefetch.
vi.mock("@/lib/mcp/clients", () => ({
  callMcpTool: vi.fn(),
}));

import { callMcpTool } from "@/lib/mcp/clients";
import {
  parseProviderDocIndex,
  prefetchSchemasForTypes,
  prefetchSchemasForSource,
} from "@/lib/schema-prefetch";

const mockedCall = vi.mocked(callMcpTool);

beforeEach(() => {
  mockedCall.mockReset();
});

// ---------------------------------------------------------------------------
// parseProviderDocIndex
// ---------------------------------------------------------------------------

describe("parseProviderDocIndex", () => {
  it("parses a JSON-ish shape with title + providerDocID", () => {
    const text = `
[
  { "title": "azurerm_storage_account", "providerDocID": "ABC123" },
  { "title": "azurerm_virtual_network", "providerDocID": "DEF456" }
]
    `;
    expect(parseProviderDocIndex(text)).toEqual({
      azurerm_storage_account: "ABC123",
      azurerm_virtual_network: "DEF456",
    });
  });

  it("parses the reverse order (docID before title)", () => {
    const text = `
{ "providerDocID": "XYZ", "title": "aws_s3_bucket" }
    `;
    expect(parseProviderDocIndex(text)).toEqual({ aws_s3_bucket: "XYZ" });
  });

  it("parses plain-text line form `- type (id: X)`", () => {
    const text = `
- azurerm_storage_account (id: A1)
- azurerm_virtual_network (id: V2)
    `;
    expect(parseProviderDocIndex(text)).toEqual({
      azurerm_storage_account: "A1",
      azurerm_virtual_network: "V2",
    });
  });

  it("returns an empty map for unparseable input", () => {
    expect(parseProviderDocIndex("")).toEqual({});
    expect(parseProviderDocIndex("not json at all")).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// prefetchSchemasForTypes
// ---------------------------------------------------------------------------

describe("prefetchSchemasForTypes", () => {
  it("returns empty when tfTypes is empty (no MCP calls)", async () => {
    const res = await prefetchSchemasForTypes({ tfTypes: [] });
    expect(res.hasContent).toBe(false);
    expect(res.promptBlock).toBe("");
    expect(mockedCall).not.toHaveBeenCalled();
  });

  it("calls search_providers once per provider, then get_provider_details per type", async () => {
    mockedCall.mockImplementation(async (name, input) => {
      if (name === "search_providers") {
        const provider = (input as { providerName: string }).providerName;
        if (provider === "azurerm") {
          return {
            ok: true,
            data: '[{"title": "azurerm_storage_account", "providerDocID": "SA1"}]',
          };
        }
        if (provider === "aws") {
          return {
            ok: true,
            data: '[{"title": "aws_s3_bucket", "providerDocID": "S3B"}]',
          };
        }
      }
      if (name === "get_provider_details") {
        const id = (input as { providerDocID: string }).providerDocID;
        return { ok: true, data: `schema body for ${id}` };
      }
      return { ok: false, error: "unexpected call" };
    });

    const res = await prefetchSchemasForTypes({
      tfTypes: ["azurerm_storage_account", "aws_s3_bucket"],
    });

    expect(res.hasContent).toBe(true);
    expect(res.fetched).toEqual(["azurerm_storage_account", "aws_s3_bucket"]);
    expect(res.skipped).toEqual([]);
    expect(res.promptBlock).toContain("## Pre-fetched provider schemas");
    expect(res.promptBlock).toContain("azurerm_storage_account");
    expect(res.promptBlock).toContain("schema body for SA1");
    expect(res.promptBlock).toContain("schema body for S3B");

    // One search per provider, one details call per type.
    const searches = mockedCall.mock.calls.filter(
      (c) => c[0] === "search_providers",
    );
    const details = mockedCall.mock.calls.filter(
      (c) => c[0] === "get_provider_details",
    );
    expect(searches).toHaveLength(2);
    expect(details).toHaveLength(2);
  });

  it("skips types whose docID is not in the index", async () => {
    mockedCall.mockImplementation(async (name) => {
      if (name === "search_providers") {
        return {
          ok: true,
          data: '[{"title": "azurerm_storage_account", "providerDocID": "SA1"}]',
        };
      }
      return { ok: true, data: "body" };
    });

    const res = await prefetchSchemasForTypes({
      tfTypes: ["azurerm_storage_account", "azurerm_mystery_resource"],
    });
    expect(res.fetched).toEqual(["azurerm_storage_account"]);
    expect(res.skipped).toEqual(["azurerm_mystery_resource"]);
  });

  it("degrades to empty result when search_providers fails", async () => {
    mockedCall.mockResolvedValue({ ok: false, error: "MCP down" });
    const res = await prefetchSchemasForTypes({
      tfTypes: ["azurerm_storage_account"],
    });
    expect(res.hasContent).toBe(false);
    expect(res.fetched).toEqual([]);
  });

  it("drops oversized schemas (> MAX_PER_SCHEMA_TOKENS)", async () => {
    const huge = "x".repeat(1_500 * 4 + 10); // >1500 tokens by the 4-char heuristic
    mockedCall.mockImplementation(async (name) => {
      if (name === "search_providers") {
        return {
          ok: true,
          data: '[{"title": "azurerm_big", "providerDocID": "B1"}]',
        };
      }
      return { ok: true, data: huge };
    });
    const res = await prefetchSchemasForTypes({ tfTypes: ["azurerm_big"] });
    expect(res.fetched).toEqual([]);
    expect(res.skipped).toEqual(["azurerm_big"]);
  });
});

// ---------------------------------------------------------------------------
// prefetchSchemasForSource — integration with inventory extractor
// ---------------------------------------------------------------------------

describe("prefetchSchemasForSource", () => {
  it("derives the TF type list from a Bicep template", async () => {
    mockedCall.mockImplementation(async (name) => {
      if (name === "search_providers") {
        return {
          ok: true,
          data:
            '[{"title": "azurerm_storage_account", "providerDocID": "SA1"},' +
            ' {"title": "azurerm_virtual_network", "providerDocID": "VN2"}]',
        };
      }
      return { ok: true, data: "schema" };
    });

    const res = await prefetchSchemasForSource({
      sourceContent: `
resource sa 'Microsoft.Storage/storageAccounts@2023-01-01' = { name: 'sa' }
resource vn 'Microsoft.Network/virtualNetworks@2022-11-01' = { name: 'v' }
      `,
      sourceFormat: "bicep",
    });
    expect(res.fetched.sort()).toEqual([
      "azurerm_storage_account",
      "azurerm_virtual_network",
    ]);
  });

  it("returns empty when the source has no recognised resources", async () => {
    const res = await prefetchSchemasForSource({
      sourceContent: "var unused = 'x'",
      sourceFormat: "bicep",
    });
    expect(res.hasContent).toBe(false);
    expect(mockedCall).not.toHaveBeenCalled();
  });
});
