import { NextResponse } from "next/server";
import { parseDocumentToBlocks } from "@/lib/sds/parse";
import {
  markdownPathForSlug,
  normalizeSlug,
  parseGithubOverrideFromHeaders,
  readDocumentFile,
  resolveGithubConnection,
} from "@/lib/github-repo";

/**
 * Pipeline endpoint from canonical markdown in GitHub.
 */
export async function GET(request: Request) {
  try {
    const githubOverride = parseGithubOverrideFromHeaders(request);
    const { octokit, owner, repo, branch } =
      resolveGithubConnection(githubOverride);
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get("slug");

    if (!slug || !normalizeSlug(slug)) {
      return NextResponse.json(
        { error: 'Query "slug" is required.' },
        { status: 400 },
      );
    }

    const path = markdownPathForSlug(slug);
    const existing = await readDocumentFile(octokit, owner, repo, branch, path);
    if (!existing) {
      return NextResponse.json(
        { error: `No SDS document at ${path}.` },
        { status: 404 },
      );
    }

    const markdown = existing.raw;
    const blocks = parseDocumentToBlocks(markdown);
    const exportedAt = new Date().toISOString();

    return NextResponse.json({
      specification: {
        slug: normalizeSlug(slug),
        branch,
        exportedAt,
        blockCount: blocks.length,
        blocks,
        markdown,
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to export clean JSON.";
    const status = message.includes("not configured") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
