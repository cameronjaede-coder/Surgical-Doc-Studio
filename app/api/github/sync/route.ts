import { NextResponse } from "next/server";
import type { SdsBlock } from "@/lib/sds/types";
import { buildSdsDocument } from "@/lib/sds/document";
import {
  getGithubUserLogin,
  jsonPathForSlug,
  normalizeSlug,
  readDocumentJson,
  requireRepoConfig,
  writeDocumentJson,
} from "@/lib/github-repo";

function isBlock(x: unknown): x is SdsBlock {
  if (!x || typeof x !== "object") return false;
  const b = x as Record<string, unknown>;
  if (
    typeof b.id !== "string" ||
    typeof b.text !== "string" ||
    typeof b.verified !== "boolean"
  ) {
    return false;
  }
  if (b.kind !== "header" && b.kind !== "paragraph" && b.kind !== "list") {
    return false;
  }
  if (b.verifiedAt !== undefined && typeof b.verifiedAt !== "string") {
    return false;
  }
  if (b.verifiedBy !== undefined && typeof b.verifiedBy !== "string") {
    return false;
  }
  return true;
}

export async function POST(request: Request) {
  try {
    const { octokit, owner, repo, branch } = requireRepoConfig();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Expected JSON object." }, { status: 400 });
    }

    const { slug, blocks, commitMessage, verifyBlockId } = body as {
      slug?: unknown;
      blocks?: unknown;
      commitMessage?: unknown;
      verifyBlockId?: unknown;
    };

    if (typeof slug !== "string" || !normalizeSlug(slug)) {
      return NextResponse.json({ error: '"slug" must be a non-empty string.' }, { status: 400 });
    }

    if (!Array.isArray(blocks) || !blocks.every(isBlock)) {
      return NextResponse.json(
        { error: '"blocks" must be an array of valid SDS blocks.' },
        { status: 400 },
      );
    }

    const verifyId =
      typeof verifyBlockId === "string" && verifyBlockId ? verifyBlockId : "";

    let nextBlocks: SdsBlock[] = blocks.map((b) => ({ ...b }));
    const path = jsonPathForSlug(slug);

    if (verifyId) {
      const login = await getGithubUserLogin(octokit);
      const stamp = new Date().toISOString();
      nextBlocks = nextBlocks.map((b) => {
        if (b.id !== verifyId) return b;
        if (b.verified) {
          return {
            ...b,
            verifiedAt: stamp,
            verifiedBy: login,
          };
        }
        return {
          id: b.id,
          kind: b.kind,
          text: b.text,
          verified: false,
        };
      });
    }

    const doc = buildSdsDocument(slug, branch, nextBlocks);

    let sha: string | undefined;
    const existing = await readDocumentJson(octokit, owner, repo, branch, path);
    if (existing) sha = existing.sha;

    const message =
      typeof commitMessage === "string" && commitMessage.trim()
        ? commitMessage.trim()
        : verifyId
          ? `SDS: human verification for block ${verifyId.slice(0, 8)}…`
          : "SDS: sync document";

    const { commitUrl, htmlUrl } = await writeDocumentJson(
      octokit,
      owner,
      repo,
      branch,
      path,
      doc,
      message,
      sha,
    );

    return NextResponse.json({
      success: true,
      commitUrl,
      fileUrl: htmlUrl,
      document: doc,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to sync with GitHub.";
    const status = message.includes("not configured") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
