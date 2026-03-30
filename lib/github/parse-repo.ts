/** Pure helper — safe to import from client components (no Octokit). */

/**
 * Parse owner/repo from shorthand (`owner/repo`), full GitHub URLs, or `git@github.com:…` SSH remotes.
 * Extra path segments (`/tree/main`) are ignored.
 */
export function parseRepo(repoEnv: string): { owner: string; repo: string } | null {
  let s = repoEnv.trim();
  if (!s) return null;

  const ssh = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/i.exec(s);
  if (ssh) {
    const owner = ssh[1];
    const repo = ssh[2].replace(/\.git$/i, "").split("/")[0] ?? "";
    if (owner && repo) return { owner, repo };
  }

  const https =
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/|$)/i.exec(
      s,
    );
  if (https) {
    const owner = https[1];
    const repo = https[2].replace(/\.git$/i, "");
    if (owner && repo) return { owner, repo };
  }

  s = s.replace(/^\/+|\/+$/g, "");
  const parts = s.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!owner || !repo) return null;
  return { owner, repo };
}
