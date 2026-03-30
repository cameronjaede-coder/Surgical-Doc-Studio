import { NextResponse } from "next/server";
import type { SdsDocument } from "@/lib/sds/types";
import { blocksToMarkdown } from "@/lib/sds/parse";
import {
  jsonPathForSlug,
  normalizeSlug,
  readDocumentJson,
  requireRepoConfig,
} from "@/lib/github-repo";

export async function POST(request: Request) {
  try {
    const token = process.env.CODA_API_TOKEN;
    const docId = process.env.CODA_DOC_ID;
    const parentPageId = process.env.CODA_PARENT_PAGE_ID;

    if (!token || !docId) {
      return NextResponse.json(
        {
          error:
            "Coda export requires CODA_API_TOKEN and CODA_DOC_ID to be configured.",
        },
        { status: 500 },
      );
    }

    const { octokit, owner, repo, branch } = requireRepoConfig();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const slug =
      body &&
      typeof body === "object" &&
      typeof (body as { slug?: unknown }).slug === "string"
        ? (body as { slug: string }).slug
        : "";

    if (!slug || !normalizeSlug(slug)) {
      return NextResponse.json(
        { error: '"slug" must be a non-empty string.' },
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

    const verified = doc.blocks.filter((b) => b.verified);
    if (verified.length === 0) {
      return NextResponse.json(
        { error: "No verified blocks to export. Verify blocks in SDS first." },
        { status: 400 },
      );
    }

    const markdown = blocksToMarkdown(verified);
    const pageName = `SDS — ${doc.slug} — ${new Date().toISOString().slice(0, 19)}Z`;

    const payload: Record<string, unknown> = {
      name: pageName,
      pageContent: {
        type: "canvas",
        canvasContent: {
          format: "markdown",
          content: markdown,
        },
      },
    };

    if (parentPageId?.trim()) {
      payload.parentPageId = parentPageId.trim();
    }

    const res = await fetch(`https://coda.io/apis/v1/docs/${docId}/pages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg =
        typeof data === "object" &&
        data &&
        "message" in data &&
        typeof (data as { message: unknown }).message === "string"
          ? (data as { message: string }).message
          : `Coda API error (${res.status})`;
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const pageId =
      data && typeof data === "object" && "id" in data
        ? String((data as { id: unknown }).id)
        : null;
    const requestId =
      data && typeof data === "object" && "requestId" in data
        ? String((data as { requestId: unknown }).requestId)
        : null;

    return NextResponse.json({
      success: true,
      pageId,
      requestId,
      message:
        res.status === 202
          ? "Coda queued page creation; it may take a few seconds to appear."
          : "Page created in Coda.",
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Coda export failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
