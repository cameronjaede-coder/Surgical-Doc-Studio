import { Octokit } from "octokit";
import { parseRepo } from "@/lib/github/parse-repo";

export { parseRepo } from "@/lib/github/parse-repo";

export function normalizeSlug(slug: string): string {
  let normalized = slug
    .trim()
    .replace(/\\/g, "/");

  normalized = normalized.replace(/^\/+|\/+$/g, "");

  // Allow users to paste full stored paths like "sds/my-doc.md".
  if (normalized.startsWith("sds/")) {
    normalized = normalized.slice(4);
  }

  // Accept either slug or markdown filename in the same input.
  if (normalized.toLowerCase().endsWith(".md")) {
    normalized = normalized.slice(0, -3);
  }

  return normalized.replace(/^\/+|\/+$/g, "");
}

export function markdownPathForSlug(slug: string): string {
  return `sds/${normalizeSlug(slug)}.md`;
}

export function getOctokit(): Octokit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is not configured.");
  }
  return new Octokit({ auth: token });
}

export function requireRepoConfig(): {
  octokit: Octokit;
  owner: string;
  repo: string;
  branch: string;
} {
  const repoEnv = process.env.GITHUB_REPO;
  if (!repoEnv) {
    throw new Error("GITHUB_REPO is not configured.");
  }
  const parsed = parseRepo(repoEnv);
  if (!parsed) {
    throw new Error(
      'GITHUB_REPO must be "owner/repo" (e.g. org/Surgical-Doc-Studio).',
    );
  }
  const branch = (process.env.GITHUB_BRANCH || "main").trim() || "main";
  return {
    octokit: getOctokit(),
    owner: parsed.owner,
    repo: parsed.repo,
    branch,
  };
}

export type GithubConnectionOverride = {
  repo: string;
  branch: string;
  token: string;
};

export function parseGithubOverrideFromUnknown(
  raw: unknown,
): GithubConnectionOverride | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.repo !== "string" || typeof o.token !== "string") return null;
  const repo = o.repo.trim();
  const token = o.token.trim();
  if (!repo || !token) return null;
  const branchRaw = typeof o.branch === "string" ? o.branch.trim() : "";
  const branch = branchRaw || "main";
  return { repo, branch, token };
}

export function parseGithubOverrideFromHeaders(
  request: Request,
): GithubConnectionOverride | null {
  const repo = request.headers.get("x-sds-github-repo")?.trim() ?? "";
  const token = request.headers.get("x-sds-github-token")?.trim() ?? "";
  if (!repo || !token) return null;
  const branchHdr = request.headers.get("x-sds-github-branch")?.trim() ?? "";
  const branch = branchHdr || "main";
  return { repo, branch, token };
}

export function tryResolveGithubOverride(
  override: GithubConnectionOverride | null,
): { octokit: Octokit; owner: string; repo: string; branch: string } | null {
  if (!override) return null;
  const parsed = parseRepo(override.repo);
  if (!parsed || !override.token.trim()) return null;
  const branch = (override.branch || "main").trim() || "main";
  return {
    octokit: new Octokit({ auth: override.token.trim() }),
    owner: parsed.owner,
    repo: parsed.repo,
    branch,
  };
}

/** Use browser-provided repo/branch/token when valid; otherwise server env. */
export function resolveGithubConnection(
  override: GithubConnectionOverride | null,
): { octokit: Octokit; owner: string; repo: string; branch: string } {
  const resolved = tryResolveGithubOverride(override);
  if (resolved) return resolved;
  return requireRepoConfig();
}

export async function getGithubUserLogin(octokit: Octokit): Promise<string> {
  try {
    const { data } = await octokit.rest.users.getAuthenticated();
    return data.login;
  } catch {
    return "unknown";
  }
}

export async function readDocumentFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  path: string,
): Promise<{ raw: string; sha: string } | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });
    if (Array.isArray(data) || data.type !== "file") {
      return null;
    }
    if (data.encoding !== "base64" || typeof data.content !== "string") {
      throw new Error("Unexpected GitHub file encoding.");
    }
    const raw = Buffer.from(data.content, "base64").toString("utf8");
    return { raw, sha: data.sha };
  } catch (e: unknown) {
    const status =
      e && typeof e === "object" && "status" in e
        ? Number((e as { status: number }).status)
        : undefined;
    if (status === 404) return null;
    throw e;
  }
}

export async function writeDocumentFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  path: string,
  contentRaw: string,
  message: string,
  sha?: string,
): Promise<{ commitUrl: string; htmlUrl: string | null }> {
  const content = Buffer.from(contentRaw, "utf8").toString("base64");
  const { data } = await octokit.rest.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    branch,
    message,
    content,
    sha,
  });

  const commitUrl = data.commit.html_url ?? "";
  const htmlUrl =
    data.content && typeof data.content === "object" && "html_url" in data.content
      ? String((data.content as { html_url?: string }).html_url ?? "")
      : null;

  return { commitUrl, htmlUrl };
}
