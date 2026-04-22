import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseGitHubUrl, fetchRepoTree } from "@/lib/github";

// ---------------------------------------------------------------------------
// parseGitHubUrl
// ---------------------------------------------------------------------------

describe("parseGitHubUrl", () => {
  it("parses full HTTPS URL", () => {
    const { owner, repo } = parseGitHubUrl("https://github.com/Azure/bicep");
    expect(owner).toBe("Azure");
    expect(repo).toBe("bicep");
  });

  it("parses URL with .git suffix", () => {
    const { owner, repo } = parseGitHubUrl("https://github.com/Azure/bicep.git");
    expect(owner).toBe("Azure");
    expect(repo).toBe("bicep");
  });

  it("parses URL with trailing slash", () => {
    const { owner, repo } = parseGitHubUrl("https://github.com/Azure/bicep/");
    expect(owner).toBe("Azure");
    expect(repo).toBe("bicep");
  });

  it("parses shorthand owner/repo", () => {
    const { owner, repo } = parseGitHubUrl("Azure/bicep");
    expect(owner).toBe("Azure");
    expect(repo).toBe("bicep");
  });

  it("trims whitespace", () => {
    const { owner, repo } = parseGitHubUrl("  Azure/bicep  ");
    expect(owner).toBe("Azure");
    expect(repo).toBe("bicep");
  });

  it("handles names with dots and hyphens", () => {
    const { owner, repo } = parseGitHubUrl("my-org/my.repo-name");
    expect(owner).toBe("my-org");
    expect(repo).toBe("my.repo-name");
  });

  it("throws on empty string", () => {
    expect(() => parseGitHubUrl("")).toThrow("required");
  });

  it("throws on whitespace-only string", () => {
    expect(() => parseGitHubUrl("   ")).toThrow("required");
  });

  it("throws on single segment", () => {
    expect(() => parseGitHubUrl("just-a-repo")).toThrow("Invalid GitHub URL");
  });

  it("throws on URL with extra path segments", () => {
    expect(() => parseGitHubUrl("https://github.com/owner/repo/tree/main")).toThrow("Invalid GitHub URL");
  });

  it("throws on non-GitHub URL", () => {
    expect(() => parseGitHubUrl("https://gitlab.com/owner/repo")).toThrow("Invalid GitHub URL");
  });
});

// ---------------------------------------------------------------------------
// fetchRepoTree
// ---------------------------------------------------------------------------

describe("fetchRepoTree", () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    fetchSpy.mockClear();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(responses: Array<{ url: string | RegExp; status: number; body: unknown }>) {
    // Match from most specific to least specific: longer strings first
    const sorted = [...responses].sort((a, b) => {
      const aLen = typeof a.url === "string" ? a.url.length : 0;
      const bLen = typeof b.url === "string" ? b.url.length : 0;
      return bLen - aLen; // longest first
    });

    fetchSpy.mockImplementation(async (url: string) => {
      for (const mock of sorted) {
        const matches = typeof mock.url === "string" ? url.includes(mock.url) : mock.url.test(url);
        if (matches) {
          return {
            ok: mock.status >= 200 && mock.status < 300,
            status: mock.status,
            statusText: mock.status === 200 ? "OK" : "Error",
            json: async () => mock.body,
            text: async () => (typeof mock.body === "string" ? mock.body : JSON.stringify(mock.body)),
          };
        }
      }
      return { ok: false, status: 404, statusText: "Not Found", json: async () => ({}) };
    });
  }

  it("fetches default branch and filters bicep files", async () => {
    mockFetch([
      {
        url: /\/repos\/owner\/repo$/,
        status: 200,
        body: { default_branch: "main" },
      },
      {
        url: /git\/trees\/main\?recursive=1/,
        status: 200,
        body: {
          tree: [
            { path: "README.md", type: "blob", sha: "a", size: 100, url: "", mode: "100644" },
            { path: "main.bicep", type: "blob", sha: "b", size: 200, url: "", mode: "100644" },
            { path: "modules/storage.bicep", type: "blob", sha: "c", size: 150, url: "", mode: "100644" },
            { path: "src", type: "tree", sha: "d", size: 0, url: "", mode: "040000" },
          ],
          truncated: false,
        },
      },
      {
        url: /raw\.githubusercontent\.com/,
        status: 200,
        body: "param location string",
      },
    ]);

    const result = await fetchRepoTree({ owner: "owner", repo: "repo" });

    expect(result.files).toHaveProperty("main.bicep");
    expect(result.files).toHaveProperty("modules/storage.bicep");
    expect(Object.keys(result.files)).toHaveLength(2);
    expect(result.stats.branch).toBe("main");
    expect(result.stats.bicepFilesFound).toBe(2);
    expect(result.stats.totalFilesInRepo).toBe(3); // blobs only
  });

  it("uses provided branch directly", async () => {
    mockFetch([
      {
        url: "git/trees/develop?recursive=1",
        status: 200,
        body: {
          tree: [
            { path: "main.bicep", type: "blob", sha: "a", size: 100, url: "", mode: "100644" },
          ],
          truncated: false,
        },
      },
      {
        url: "raw.githubusercontent.com",
        status: 200,
        body: "resource rg 'Microsoft.Resources/resourceGroups@2023-07-01'",
      },
    ]);

    const result = await fetchRepoTree({ owner: "owner", repo: "repo", branch: "develop" });

    expect(result.stats.branch).toBe("develop");
    // Should NOT have called the repo endpoint to get default branch
    const calls = fetchSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    // The repo info URL ends with /repos/owner/repo (no git/trees suffix)
    const repoInfoCalls = calls.filter(
      (u: string) => /api\.github\.com\/repos\/owner\/repo$/.test(u),
    );
    expect(repoInfoCalls).toHaveLength(0);
  });

  it("applies subdirectory filter and strips prefix", async () => {
    mockFetch([
      {
        url: "git/trees/main?recursive=1",
        status: 200,
        body: {
          tree: [
            { path: "infra/bicep/main.bicep", type: "blob", sha: "a", size: 100, url: "", mode: "100644" },
            { path: "infra/bicep/modules/net.bicep", type: "blob", sha: "b", size: 100, url: "", mode: "100644" },
            { path: "src/app.ts", type: "blob", sha: "c", size: 100, url: "", mode: "100644" },
            { path: "other.bicep", type: "blob", sha: "d", size: 100, url: "", mode: "100644" },
          ],
          truncated: false,
        },
      },
      {
        url: "raw.githubusercontent.com",
        status: 200,
        body: "param location string",
      },
    ]);

    const result = await fetchRepoTree({
      owner: "owner",
      repo: "repo",
      branch: "main",
      subdirectory: "infra/bicep",
    });

    expect(Object.keys(result.files)).toHaveLength(2);
    // Paths should have prefix stripped
    expect(result.files).toHaveProperty("main.bicep");
    expect(result.files).toHaveProperty("modules/net.bicep");
    // other.bicep should be excluded (not in subdirectory)
    expect(result.files).not.toHaveProperty("other.bicep");
    expect(result.stats.subdirectory).toBe("infra/bicep");
  });

  it("throws on 404 repo (not found)", async () => {
    mockFetch([
      {
        url: "api.github.com/repos/owner/repo",
        status: 404,
        body: { message: "Not Found" },
      },
    ]);

    await expect(
      fetchRepoTree({ owner: "owner", repo: "repo" }),
    ).rejects.toThrow("Repository not found");
  });

  it("throws on 404 branch", async () => {
    mockFetch([
      {
        url: "git/trees/nonexistent?recursive=1",
        status: 404,
        body: { message: "Not Found" },
      },
    ]);

    await expect(
      fetchRepoTree({ owner: "owner", repo: "repo", branch: "nonexistent" }),
    ).rejects.toThrow("Branch 'nonexistent' not found");
  });

  it("throws on 403 rate limit", async () => {
    mockFetch([
      {
        url: "api.github.com/repos/owner/repo",
        status: 403,
        body: { message: "rate limit exceeded" },
      },
    ]);

    await expect(
      fetchRepoTree({ owner: "owner", repo: "repo" }),
    ).rejects.toThrow("rate limit");
  });

  it("throws on 401 bad token", async () => {
    mockFetch([
      {
        url: "api.github.com/repos/owner/repo",
        status: 401,
        body: { message: "Bad credentials" },
      },
    ]);

    await expect(
      fetchRepoTree({ owner: "owner", repo: "repo", token: "bad-token" }),
    ).rejects.toThrow("Invalid GitHub token");
  });

  it("throws when no bicep files found", async () => {
    mockFetch([
      {
        url: "git/trees/main?recursive=1",
        status: 200,
        body: {
          tree: [
            { path: "README.md", type: "blob", sha: "a", size: 100, url: "", mode: "100644" },
            { path: "src/app.ts", type: "blob", sha: "b", size: 200, url: "", mode: "100644" },
          ],
          truncated: false,
        },
      },
    ]);

    await expect(
      fetchRepoTree({ owner: "owner", repo: "repo", branch: "main" }),
    ).rejects.toThrow("No .bicep or .bicepparam files found");
  });

  it("throws when too many bicep files", async () => {
    const tree = Array.from({ length: 60 }, (_, i) => ({
      path: `file-${i}.bicep`,
      type: "blob",
      sha: `sha${i}`,
      size: 100,
      url: "",
      mode: "100644",
    }));

    mockFetch([
      {
        url: "git/trees/main?recursive=1",
        status: 200,
        body: { tree, truncated: false },
      },
    ]);

    await expect(
      fetchRepoTree({ owner: "owner", repo: "repo", branch: "main" }),
    ).rejects.toThrow("Too many Bicep files");
  });

  it("includes .bicepparam files", async () => {
    mockFetch([
      {
        url: "git/trees/main?recursive=1",
        status: 200,
        body: {
          tree: [
            { path: "main.bicep", type: "blob", sha: "a", size: 100, url: "", mode: "100644" },
            { path: "dev.bicepparam", type: "blob", sha: "b", size: 50, url: "", mode: "100644" },
          ],
          truncated: false,
        },
      },
      {
        url: "raw.githubusercontent.com",
        status: 200,
        body: "using './main.bicep'",
      },
    ]);

    const result = await fetchRepoTree({ owner: "owner", repo: "repo", branch: "main" });

    expect(result.files).toHaveProperty("main.bicep");
    expect(result.files).toHaveProperty("dev.bicepparam");
    expect(result.stats.bicepFilesFound).toBe(2);
  });

  it("handles individual file fetch failures gracefully", async () => {
    let callCount = 0;
    fetchSpy.mockImplementation(async (url: string) => {
      if (url.includes("git/trees")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tree: [
              { path: "main.bicep", type: "blob", sha: "a", size: 100, url: "", mode: "100644" },
              { path: "broken.bicep", type: "blob", sha: "b", size: 100, url: "", mode: "100644" },
            ],
            truncated: false,
          }),
        };
      }
      if (url.includes("raw.githubusercontent.com")) {
        callCount++;
        if (url.includes("broken.bicep")) {
          return { ok: false, status: 500, statusText: "Server Error" };
        }
        return {
          ok: true,
          status: 200,
          text: async () => "param location string",
        };
      }
      return { ok: false, status: 404, statusText: "Not Found", json: async () => ({}) };
    });

    const result = await fetchRepoTree({ owner: "owner", repo: "repo", branch: "main" });

    // Should still return the successful file
    expect(result.files).toHaveProperty("main.bicep");
    expect(result.files).not.toHaveProperty("broken.bicep");
    expect(result.stats.bicepFilesFound).toBe(1);
  });

  // --------------------------------------------------------------------
  // CloudFormation source format
  // --------------------------------------------------------------------

  describe("sourceFormat: cloudformation", () => {
    function mockTreeWithMixedFiles() {
      mockFetch([
        { url: /\/repos\/owner\/repo$/, status: 200, body: { default_branch: "main" } },
        {
          url: /git\/trees\/main\?recursive=1/,
          status: 200,
          body: {
            tree: [
              { path: "README.md", type: "blob", sha: "a", size: 100, url: "", mode: "100644" },
              { path: "main.bicep", type: "blob", sha: "b", size: 200, url: "", mode: "100644" },
              { path: "templates/network.yaml", type: "blob", sha: "c", size: 300, url: "", mode: "100644" },
              { path: "templates/storage.yml", type: "blob", sha: "d", size: 250, url: "", mode: "100644" },
              { path: "stacks/iam.json", type: "blob", sha: "e", size: 180, url: "", mode: "100644" },
              { path: "package.json", type: "blob", sha: "f", size: 50, url: "", mode: "100644" },
              { path: "old.template", type: "blob", sha: "g", size: 80, url: "", mode: "100644" },
            ],
            truncated: false,
          },
        },
        { url: /raw\.githubusercontent\.com/, status: 200, body: 'Resources:\n  X:\n    Type: "AWS::S3::Bucket"' },
      ]);
    }

    it("filters CloudFormation files when sourceFormat is cloudformation", async () => {
      mockTreeWithMixedFiles();
      const result = await fetchRepoTree({
        owner: "owner",
        repo: "repo",
        sourceFormat: "cloudformation",
      });

      // .yaml/.yml/.json/.template are accepted; .bicep / README.md / package.json are not.
      // package.json is included because the filter is extension-based — that's
      // the documented contract; users rely on the subdirectory option to scope.
      expect(result.files).toHaveProperty("templates/network.yaml");
      expect(result.files).toHaveProperty("templates/storage.yml");
      expect(result.files).toHaveProperty("stacks/iam.json");
      expect(result.files).toHaveProperty("old.template");
      expect(result.files).toHaveProperty("package.json"); // .json caught
      expect(result.files).not.toHaveProperty("main.bicep");
      expect(result.files).not.toHaveProperty("README.md");
      expect(result.stats.sourceFormat).toBe("cloudformation");
      expect(result.stats.sourceFilesFound).toBe(5);
      // back-compat alias
      expect(result.stats.bicepFilesFound).toBe(5);
    });

    it("defaults to bicep filtering when sourceFormat is omitted", async () => {
      mockTreeWithMixedFiles();
      const result = await fetchRepoTree({ owner: "owner", repo: "repo" });

      expect(result.files).toHaveProperty("main.bicep");
      expect(result.files).not.toHaveProperty("templates/network.yaml");
      expect(result.stats.sourceFormat).toBe("bicep");
      expect(result.stats.sourceFilesFound).toBe(1);
    });

    it("error message mentions CloudFormation extensions when none found", async () => {
      mockFetch([
        { url: /\/repos\/owner\/repo$/, status: 200, body: { default_branch: "main" } },
        {
          url: /git\/trees\/main\?recursive=1/,
          status: 200,
          body: {
            tree: [
              { path: "README.md", type: "blob", sha: "a", size: 100, url: "", mode: "100644" },
              { path: "main.bicep", type: "blob", sha: "b", size: 200, url: "", mode: "100644" },
            ],
            truncated: false,
          },
        },
      ]);

      await expect(
        fetchRepoTree({ owner: "owner", repo: "repo", sourceFormat: "cloudformation" }),
      ).rejects.toThrow(/yaml.*yml.*json.*template/);
    });

    it("subdirectory + sourceFormat filter together", async () => {
      mockFetch([
        { url: /\/repos\/owner\/repo$/, status: 200, body: { default_branch: "main" } },
        {
          url: /git\/trees\/main\?recursive=1/,
          status: 200,
          body: {
            tree: [
              { path: "infra/cf/main.yaml", type: "blob", sha: "a", size: 100, url: "", mode: "100644" },
              { path: "infra/bicep/main.bicep", type: "blob", sha: "b", size: 100, url: "", mode: "100644" },
              { path: "src/index.json", type: "blob", sha: "c", size: 100, url: "", mode: "100644" },
            ],
            truncated: false,
          },
        },
        { url: /raw\.githubusercontent\.com/, status: 200, body: 'Resources: {}' },
      ]);

      const result = await fetchRepoTree({
        owner: "owner",
        repo: "repo",
        subdirectory: "infra/cf",
        sourceFormat: "cloudformation",
      });

      // Subdirectory prefix is stripped from returned keys
      expect(result.files).toHaveProperty("main.yaml");
      expect(Object.keys(result.files)).toHaveLength(1);
      expect(result.stats.subdirectory).toBe("infra/cf");
    });
  });
});
