import { NextResponse } from "next/server";
import type { SdsBlock, SdsDocument } from "@/lib/sds/types";
import { blocksToMarkdown } from "@/lib/sds/parse";
import {
  jsonPathForSlug,
  normalizeSlug,
  readDocumentJson,
  requireRepoConfig,
} from "@/lib/github-repo";

/**
 * Pipeline endpoint: human-verified blocks only (specifications you can trust downstream).
 */
export async function GET(request: Request) {
  try {
    const { octokit, owner, repo, branch } = requireRepoConfig();
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get("slug");

    if (!slug || !normalizeSlug(slug)) {
      return NextResponse.json(
        { error: 'Query "slug" is required.' },
        { status: 400 },
      );
    }

    const path = jsonPathForSlug(slug);
    const existing = await readDocumentJson(octokit, owner, repo, branch, path);
    if (!existing) {
      return NextResponse.json(
        { error: `No SDS document at ${path}.` },
        { status: 404 },
      );
    }

    let doc: SdsDocument;
    try {
      doc = JSON.parse(existing.raw) as SdsDocument;
    } catch {
      return NextResponse.json(
        { error: "Stored document is not valid JSON." },
        { status: 502 },
      );
    }

    const verifiedBlocks: SdsBlock[] = doc.blocks.filter((b) => b.verified);
    const exportedAt = new Date().toISOString();

    return NextResponse.json({
      specification: {
        slug: doc.slug,
        branch,
        exportedAt,
        blockCount: verifiedBlocks.length,
        blocks: verifiedBlocks,
        markdownVerifiedOnly: blocksToMarkdown(verifiedBlocks),
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to export clean JSON.";
    const status = message.includes("not configured") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
