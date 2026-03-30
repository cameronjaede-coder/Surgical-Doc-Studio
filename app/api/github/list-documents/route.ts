import { NextResponse } from "next/server";
import {
  parseGithubOverrideFromHeaders,
  resolveGithubConnection,
} from "@/lib/github-repo";

/** Lists `sds/*.md` basenames (document slugs) on the configured branch. */
export async function GET(request: Request) {
  try {
    const githubOverride = parseGithubOverrideFromHeaders(request);
    const { octokit, owner, repo, branch } =
      resolveGithubConnection(githubOverride);

    let data: unknown;
    try {
      const res = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: "sds",
        ref: branch,
      });
      data = res.data;
    } catch (e: unknown) {
      const status =
        e && typeof e === "object" && "status" in e
          ? Number((e as { status: number }).status)
          : undefined;
      if (status === 404) {
        return NextResponse.json({ slugs: [] as string[] });
      }
      throw e;
    }

    if (!Array.isArray(data)) {
      return NextResponse.json({ slugs: [] as string[] });
    }

    const slugs: string[] = [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { type?: string; name?: string };
      if (rec.type !== "file" || typeof rec.name !== "string") continue;
      if (!rec.name.toLowerCase().endsWith(".md")) continue;
      const base = rec.name.slice(0, -3);
      if (base.trim()) slugs.push(base);
    }
    slugs.sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ slugs });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to list documents.";
    const status = message.includes("not configured") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
