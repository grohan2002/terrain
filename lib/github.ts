// ---------------------------------------------------------------------------
// GitHub API utility — discover and fetch Bicep files from a GitHub repo.
// Uses native fetch() with no external dependencies.
// ---------------------------------------------------------------------------

import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_API = "https://api.github.com";
const GITHUB_RAW = "https://raw.githubusercontent.com";
const MAX_FILE_COUNT = 50;
const MAX_TOTAL_SIZE = 10 * 1024 * 1024; // 10 MB
const FETCH_BATCH_SIZE = 10; // concurrent raw fetches

const BICEP_EXTENSIONS = [".bicep", ".bicepparam"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GitHubScanResult {
  files: Record<string, string>; // BicepFiles format: path → content
  stats: {
    totalFilesInRepo: number;
    bicepFilesFound: number;
    totalBytesLoaded: number;
    branch: string;
    subdirectory: string | null;
  };
}

interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: string; // "blob" | "tree"
  sha: string;
  size?: number;
  url: string;
}

interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: GitHubTreeEntry[];
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

const GITHUB_URL_RE =
  /^(?:https?:\/\/github\.com\/)?([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?\/?$/;

/**
 * Parse a GitHub repo reference into owner + repo.
 * Accepts:
 *  - https://github.com/owner/repo
 *  - https://github.com/owner/repo.git
 *  - owner/repo
 */
export function parseGitHubUrl(input: string): { owner: string; repo: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Repository URL is required.");
  }

  const match = trimmed.match(GITHUB_URL_RE);
  if (!match) {
    throw new Error(
      `Invalid GitHub URL: "${trimmed}". Use https://github.com/owner/repo or owner/repo format.`,
    );
  }

  return { owner: match[1], repo: match[2] };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "bicep-ui",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function githubGet<T>(url: string, token?: string): Promise<T> {
  const res = await fetch(url, { headers: buildHeaders(token) });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`NOT_FOUND`);
    }
    if (res.status === 401) {
      throw new Error(
        "Invalid GitHub token. Check your personal access token.",
      );
    }
    if (res.status === 403) {
      throw new Error(
        "GitHub API rate limit exceeded. Try again later or provide a personal access token for higher limits.",
      );
    }
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

function isBicepFile(path: string): boolean {
  return BICEP_EXTENSIONS.some((ext) => path.endsWith(ext));
}

// ---------------------------------------------------------------------------
// Main: fetch repo tree and file contents
// ---------------------------------------------------------------------------

export interface FetchRepoTreeParams {
  owner: string;
  repo: string;
  branch?: string;
  subdirectory?: string;
  token?: string;
}

export async function fetchRepoTree(
  params: FetchRepoTreeParams,
): Promise<GitHubScanResult> {
  const { owner, repo, subdirectory, token } = params;
  let { branch } = params;

  // Step 1: resolve branch if not specified
  if (!branch) {
    try {
      const repoInfo = await githubGet<{ default_branch: string }>(
        `${GITHUB_API}/repos/${owner}/${repo}`,
        token,
      );
      branch = repoInfo.default_branch;
    } catch (e) {
      if (e instanceof Error && e.message === "NOT_FOUND") {
        throw new Error(
          "Repository not found. Check the URL or provide a token for private repos.",
        );
      }
      throw e;
    }
  }

  // Step 2: fetch full recursive tree
  let tree: GitHubTreeResponse;
  try {
    tree = await githubGet<GitHubTreeResponse>(
      `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      token,
    );
  } catch (e) {
    if (e instanceof Error && e.message === "NOT_FOUND") {
      throw new Error(`Branch '${branch}' not found in ${owner}/${repo}.`);
    }
    throw e;
  }

  const totalFilesInRepo = tree.tree.filter((e) => e.type === "blob").length;

  // Step 3: filter for bicep files, apply subdirectory prefix
  const normalizedSubdir = subdirectory?.replace(/^\/|\/$/g, "");

  const bicepEntries = tree.tree.filter((entry) => {
    if (entry.type !== "blob") return false;
    if (!isBicepFile(entry.path)) return false;
    if (normalizedSubdir && !entry.path.startsWith(normalizedSubdir + "/")) {
      return false;
    }
    return true;
  });

  if (bicepEntries.length === 0) {
    const suffix = normalizedSubdir
      ? ` at path '${normalizedSubdir}'`
      : "";
    throw new Error(
      `No .bicep or .bicepparam files found in ${owner}/${repo}${suffix}.`,
    );
  }

  if (bicepEntries.length > MAX_FILE_COUNT) {
    throw new Error(
      `Too many Bicep files (${bicepEntries.length}). Maximum is ${MAX_FILE_COUNT}. ` +
      `Use the subdirectory option to narrow the scope.`,
    );
  }

  // Step 4: fetch raw content in batches
  const files: Record<string, string> = {};
  let totalBytesLoaded = 0;

  for (let i = 0; i < bicepEntries.length; i += FETCH_BATCH_SIZE) {
    const batch = bicepEntries.slice(i, i + FETCH_BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        const url = `${GITHUB_RAW}/${owner}/${repo}/${branch}/${entry.path}`;
        const res = await fetch(url, {
          headers: {
            "User-Agent": "bicep-ui",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });
        if (!res.ok) {
          throw new Error(`Failed to fetch ${entry.path}: ${res.status}`);
        }
        const content = await res.text();
        return { path: entry.path, content };
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        const { path, content } = result.value;
        totalBytesLoaded += content.length;

        if (totalBytesLoaded > MAX_TOTAL_SIZE) {
          throw new Error(
            `Total content size exceeds ${MAX_TOTAL_SIZE / 1024 / 1024}MB limit. ` +
            `Use the subdirectory option to narrow the scope.`,
          );
        }

        // Strip subdirectory prefix for relative paths
        const relativePath = normalizedSubdir
          ? path.slice(normalizedSubdir.length + 1)
          : path;

        files[relativePath] = content;
      } else {
        logger.warn(
          { error: result.reason },
          "Failed to fetch a Bicep file from GitHub",
        );
      }
    }
  }

  if (Object.keys(files).length === 0) {
    throw new Error(
      "Failed to download any Bicep files. Check your network connection or token permissions.",
    );
  }

  return {
    files,
    stats: {
      totalFilesInRepo,
      bicepFilesFound: Object.keys(files).length,
      totalBytesLoaded,
      branch: branch!,
      subdirectory: normalizedSubdir ?? null,
    },
  };
}
