import { normalizeSlug } from "@/lib/github-repo";

const KEY = "SDS_EDITOR_TUTORIAL_SEEN_SLUGS_V1";

function readList(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return [];
    return j.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/** Stable key per document (matches how files are addressed in sds/). */
export function tutorialKeyForSlug(slug: string): string {
  const n = normalizeSlug(slug);
  if (!n) return "__untitled__";
  return n.toLowerCase();
}

export function hasSeenEditorTutorialForSlug(slug: string): boolean {
  const key = tutorialKeyForSlug(slug);
  return readList().includes(key);
}

export function markEditorTutorialSeenForSlug(slug: string): void {
  const key = tutorialKeyForSlug(slug);
  try {
    const next = new Set(readList());
    next.add(key);
    localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    /* ignore */
  }
}
