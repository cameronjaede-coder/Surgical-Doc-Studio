import type { SdsBlock, SdsDocument } from "./types";
import { blocksToMarkdown } from "./parse";
import { normalizeSlug } from "@/lib/github-repo";

export function buildSdsDocument(
  slug: string,
  branch: string,
  blocks: SdsBlock[],
): SdsDocument {
  return {
    version: 1,
    slug: normalizeSlug(slug),
    updatedAt: new Date().toISOString(),
    branch,
    blocks,
    markdown: blocksToMarkdown(blocks),
  };
}
