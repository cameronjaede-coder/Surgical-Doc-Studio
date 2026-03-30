import { Octokit } from "octokit";

export function parseRepo(repoEnv: string): { owner: string; repo: string } | null {
  const parts = repoEnv.trim().split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

export function normalizeSlug(slug: string): string {
  return slug
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\\/g, "/");
}

export function jsonPathForSlug(slug: string): string {
  return `sds/${normalizeSlug(slug)}.json`;
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

export async function getGithubUserLogin(octokit: Octokit): Promise<string> {
  try {
    const { data } = await octokit.rest.users.getAuthenticated();
    return data.login;
  } catch {
    return "unknown";
  }
}

export async function readDocumentJson(
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

export async function writeDocumentJson(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  path: string,
  contentObj: object,
  message: string,
  sha?: string,
): Promise<{ commitUrl: string; htmlUrl: string | null }> {
  const content = Buffer.from(JSON.stringify(contentObj, null, 2), "utf8").toString(
    "base64",
  );
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
