import { NextResponse } from "next/server";
import {
  parseGithubOverrideFromUnknown,
  tryResolveGithubOverride,
} from "@/lib/github-repo";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const override = parseGithubOverrideFromUnknown(body);
  const resolved = tryResolveGithubOverride(override);
  if (!resolved) {
    return NextResponse.json(
      { error: 'Send JSON { "repo": "owner/name", "branch": "main", "token": "ghp_…" }.' },
      { status: 400 },
    );
  }

  const { octokit, owner, repo, branch } = resolved;

  try {
    await octokit.rest.users.getAuthenticated();
  } catch (e: unknown) {
    const status =
      e && typeof e === "object" && "status" in e
        ? Number((e as { status: number }).status)
        : 0;
    if (status === 401) {
      return NextResponse.json(
        {
          error:
            "GitHub rejected this token (wrong, expired, or revoked). Generate a new personal access token.",
        },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { error: "Could not verify the token with GitHub. Try again in a moment." },
      { status: 502 },
    );
  }

  try {
    await octokit.rest.repos.get({ owner, repo });
  } catch (e: unknown) {
    const status =
      e && typeof e === "object" && "status" in e
        ? Number((e as { status: number }).status)
        : 0;
    if (status === 403) {
      return NextResponse.json(
        {
          error:
            "GitHub blocked access to this repository. For a private repo: classic token needs the “repo” scope; a fine-grained token must include this repository with Contents (read) at minimum.",
        },
        { status: 403 },
      );
    }
    if (status === 404) {
      return NextResponse.json(
        {
          error:
            `GitHub returned “not found” for ${owner}/${repo}. That usually means the name is wrong, the repo was renamed, or your token cannot see it (private repos need access — same as above). Open the repo in the browser and copy owner/repo from the URL.`,
        },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: "Could not reach GitHub for that repository." },
      { status: 502 },
    );
  }

  try {
    await octokit.rest.repos.getBranch({ owner, repo, branch });
  } catch {
    return NextResponse.json(
      { error: `Branch "${branch}" was not found on ${owner}/${repo}.` },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    repo: `${owner}/${repo}`,
    branch,
  });
}
