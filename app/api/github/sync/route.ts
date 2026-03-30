import { NextResponse } from "next/server";
import type { SdsBlock } from "@/lib/sds/types";
import { blocksToMarkdown } from "@/lib/sds/parse";
import {
  getGithubUserLogin,
  markdownPathForSlug,
  normalizeSlug,
  parseGithubOverrideFromUnknown,
  readDocumentFile,
  resolveGithubConnection,
  writeDocumentFile,
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
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Expected JSON object." }, { status: 400 });
  }

  const githubOverride = parseGithubOverrideFromUnknown(
    (body as { github?: unknown }).github,
  );

  try {
    const { octokit, owner, repo, branch } =
      resolveGithubConnection(githubOverride);

    const { slug, blocks, commitMessage, verifyBlockId } = body as {
      slug?: unknown;
      blocks?: unknown;
      commitMessage?: unknown;
      verifyBlockId?: unknown;
      verifyBlockIds?: unknown;
      verifiedOnly?: unknown;
      writeAuditSidecar?: unknown;
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
    const rawVerifyIds = (body as { verifyBlockIds?: unknown }).verifyBlockIds;
    const verifyBlockIds =
      Array.isArray(rawVerifyIds) && rawVerifyIds.every((x) => typeof x === "string")
        ? (rawVerifyIds as string[]).filter(Boolean)
        : [];
    const bodyObj = body as {
      verifiedOnly?: unknown;
      writeAuditSidecar?: unknown;
    };
    const verifiedOnly = Boolean(bodyObj.verifiedOnly);
    const writeAuditSidecar =
      "writeAuditSidecar" in bodyObj
        ? Boolean(bodyObj.writeAuditSidecar)
        : true;

    let nextBlocks: SdsBlock[] = blocks.map((b) => ({ ...b }));
    const path = markdownPathForSlug(slug);

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
    } else if (verifyBlockIds.length > 0) {
      const login = await getGithubUserLogin(octokit);
      const stamp = new Date().toISOString();
      const idSet = new Set(verifyBlockIds);
      nextBlocks = nextBlocks.map((b) => {
        if (!idSet.has(b.id)) return b;
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

    const exportBlocks = verifiedOnly
      ? nextBlocks.filter((b) => b.verified)
      : nextBlocks;
    const markdown = blocksToMarkdown(exportBlocks);

    let sha: string | undefined;
    const existing = await readDocumentFile(octokit, owner, repo, branch, path);
    if (existing) sha = existing.sha;

    const message =
      typeof commitMessage === "string" && commitMessage.trim()
        ? commitMessage.trim()
        : verifyId
          ? `SDS: human verification for block ${verifyId.slice(0, 8)}…`
          : verifyBlockIds.length > 0
            ? `SDS: bulk verify ${verifyBlockIds.length} block(s)`
            : "SDS: sync document";

    const { commitUrl, htmlUrl } = await writeDocumentFile(
      octokit,
      owner,
      repo,
      branch,
      path,
      markdown,
      message,
      sha,
    );

    if (writeAuditSidecar) {
      const auditPath = `${path.replace(/\.md$/i, "")}.meta.json`;
      const auditExisting = await readDocumentFile(
        octokit,
        owner,
        repo,
        branch,
        auditPath,
      );
      const auditSha = auditExisting?.sha;
      const auditPayload = JSON.stringify(
        {
          slug: normalizeSlug(slug),
          branch,
          exportedAt: new Date().toISOString(),
          verifiedOnly,
          exportedBlockIds: exportBlocks.map((b) => b.id),
          blocks: nextBlocks,
        },
        null,
        2,
      );
      await writeDocumentFile(
        octokit,
        owner,
        repo,
        branch,
        auditPath,
        auditPayload,
        `${message} (audit metadata)`,
        auditSha,
      );
    }

    const markdownFileUrl =
      htmlUrl && htmlUrl.length > 0
        ? htmlUrl
        : `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${path
            .split("/")
            .map((seg) => encodeURIComponent(seg))
            .join("/")}`;

    return NextResponse.json({
      success: true,
      commitUrl,
      fileUrl: markdownFileUrl,
      document: {
        slug: normalizeSlug(slug),
        branch,
        markdown,
        blocks: nextBlocks,
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to sync with GitHub.";
    const status = message.includes("not configured") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
