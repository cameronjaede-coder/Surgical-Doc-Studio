import type { SdsBlock } from "./types";

function normalizeText(t: string): string {
  return t.replace(/\r\n/g, "\n").trimEnd();
}

function isMetaBlock(
  x: unknown,
): x is Pick<SdsBlock, "kind" | "text" | "verified" | "verifiedAt" | "verifiedBy"> {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (typeof o.text !== "string" || typeof o.kind !== "string") return false;
  if (o.kind !== "header" && o.kind !== "paragraph" && o.kind !== "list") {
    return false;
  }
  return typeof o.verified === "boolean";
}

/**
 * Apply verification (and stamps) from repo audit sidecar (`*.meta.json`) onto
 * freshly parsed markdown blocks (new IDs).
 */
export function mergeVerificationFromAuditSidecar(
  freshBlocks: SdsBlock[],
  auditJson: unknown,
): SdsBlock[] {
  if (!auditJson || typeof auditJson !== "object") return freshBlocks;
  const raw = (auditJson as { blocks?: unknown }).blocks;
  if (!Array.isArray(raw)) return freshBlocks;
  const metaBlocks = raw.filter(isMetaBlock);
  if (metaBlocks.length === 0) return freshBlocks;

  if (metaBlocks.length === freshBlocks.length) {
    return freshBlocks.map((b, i) => {
      const m = metaBlocks[i];
      if (
        !m ||
        m.kind !== b.kind ||
        normalizeText(m.text) !== normalizeText(b.text)
      ) {
        return b;
      }
      return {
        ...b,
        verified: m.verified,
        verifiedAt:
          typeof m.verifiedAt === "string" ? m.verifiedAt : undefined,
        verifiedBy:
          typeof m.verifiedBy === "string" ? m.verifiedBy : undefined,
      };
    });
  }

  const byKey = new Map<
    string,
    Pick<SdsBlock, "verified" | "verifiedAt" | "verifiedBy">
  >();
  for (const m of metaBlocks) {
    byKey.set(`${m.kind}\n${normalizeText(m.text)}`, {
      verified: m.verified,
      verifiedAt:
        typeof m.verifiedAt === "string" ? m.verifiedAt : undefined,
      verifiedBy:
        typeof m.verifiedBy === "string" ? m.verifiedBy : undefined,
    });
  }

  return freshBlocks.map((b) => {
    const hit = byKey.get(`${b.kind}\n${normalizeText(b.text)}`);
    if (!hit) return b;
    return {
      ...b,
      verified: hit.verified,
      verifiedAt: hit.verifiedAt,
      verifiedBy: hit.verifiedBy,
    };
  });
}
