import { NextResponse } from "next/server";
import { parseDocumentToBlocks } from "@/lib/sds/parse";
import { mergeVerificationFromAuditSidecar } from "@/lib/sds/merge-meta-verification";
import {
  markdownPathForSlug,
  normalizeSlug,
  parseGithubOverrideFromHeaders,
  readDocumentFile,
  resolveGithubConnection,
} from "@/lib/github-repo";

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
        { error: `No SDS document at ${path} on ${branch}.` },
        { status: 404 },
      );
    }

    const markdown = existing.raw;
    const fresh = parseDocumentToBlocks(markdown).map((b) => ({
      ...b,
      verified: false as boolean,
    }));

    const auditPath = `${path.replace(/\.md$/i, "")}.meta.json`;
    const auditFile = await readDocumentFile(
      octokit,
      owner,
      repo,
      branch,
      auditPath,
    );
    let auditJson: unknown = null;
    if (auditFile?.raw) {
      try {
        auditJson = JSON.parse(auditFile.raw) as unknown;
      } catch {
        auditJson = null;
      }
    }
    const blocks = mergeVerificationFromAuditSidecar(fresh, auditJson);

    return NextResponse.json({
      document: {
        slug: normalizeSlug(slug),
        branch,
        markdown,
        blocks,
      },
      sha: existing.sha,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load document.";
    const status = message.includes("not configured") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
