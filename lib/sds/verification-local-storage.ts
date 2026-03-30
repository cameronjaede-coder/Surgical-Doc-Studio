import { normalizeSlug } from "@/lib/github-repo";
import type { SdsBlock } from "./types";

function normalizeText(t: string): string {
  return t.replace(/\r\n/g, "\n").trimEnd();
}

function contentHash(markdown: string): string {
  const n = markdown.replace(/\r\n/g, "\n");
  let h = 5381;
  for (let i = 0; i < n.length; i++) {
    h = (h * 33) ^ n.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
}

export function verificationLocalStorageKey(
  slug: string,
  markdown: string,
): string {
  const slugPart = normalizeSlug(slug.trim()) || "_draft";
  return `SDS_VERIFY_v1:${slugPart}:${contentHash(markdown)}`;
}

type Stored = {
  v: 1;
  items: Array<{
    kind: SdsBlock["kind"];
    text: string;
    verified: boolean;
    verifiedAt?: string;
    verifiedBy?: string;
  }>;
};

/** Overlay saved verification for this slug + markdown snapshot (browser only). */
export function mergeVerificationFromLocalStorage(
  slug: string,
  markdown: string,
  blocks: SdsBlock[],
): SdsBlock[] {
  if (typeof window === "undefined") return blocks;
  const key = verificationLocalStorageKey(slug, markdown);
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return blocks;
  }
  if (!raw) return blocks;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return blocks;
  }
  const o = parsed as Stored;
  if (!o || o.v !== 1 || !Array.isArray(o.items)) return blocks;

  return blocks.map((b) => {
    const hit = o.items.find(
      (i) =>
        i.kind === b.kind && normalizeText(i.text) === normalizeText(b.text),
    );
    if (!hit) return b;
    return {
      ...b,
      verified: hit.verified,
      verifiedAt: hit.verifiedAt,
      verifiedBy: hit.verifiedBy,
    };
  });
}

export function persistVerificationToLocalStorage(
  slug: string,
  markdown: string,
  blocks: SdsBlock[],
): void {
  if (typeof window === "undefined") return;
  const key = verificationLocalStorageKey(slug, markdown);
  const items = blocks.map((b) => ({
    kind: b.kind,
    text: normalizeText(b.text),
    verified: b.verified,
    verifiedAt: b.verifiedAt,
    verifiedBy: b.verifiedBy,
  }));
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ v: 1, items } satisfies Stored),
    );
  } catch {
    /* quota / private mode */
  }
}
