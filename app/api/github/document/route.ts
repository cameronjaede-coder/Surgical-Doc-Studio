import { NextResponse } from "next/server";
import type { SdsDocument } from "@/lib/sds/types";
import {
  jsonPathForSlug,
  normalizeSlug,
  readDocumentJson,
  requireRepoConfig,
} from "@/lib/github-repo";

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
        { error: `No SDS document at ${path} on ${branch}.` },
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

    if (doc.version !== 1 || !Array.isArray(doc.blocks)) {
      return NextResponse.json(
        { error: "Unrecognized SDS document shape." },
        { status: 502 },
      );
    }

    return NextResponse.json({ document: doc, sha: existing.sha });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load document.";
    const status = message.includes("not configured") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
