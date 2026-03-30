/**
 * Turn natural language into a URL-safe filename segment (kebab-case).
 */
export function textToKebabSlug(text: string, maxWords = 5): string {
  const words = text
    .trim()
    .replace(/['"`.,:;]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords);
  const segments = words
    .map((w) =>
      w
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "")
        .replace(/^-+|-+$/g, ""),
    )
    .filter(Boolean);
  const joined = segments.join("-").slice(0, 120);
  return joined || "document";
}

/** First markdown heading line (# …) → kebab slug, or null. */
export function firstHeadingToSlug(markdown: string): string | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const m = line.match(/^\s*#{1,6}\s+(.+)$/);
    if (m) {
      const title = m[1].replace(/\s+#+\s*$/, "").trim();
      if (!title) continue;
      const s = textToKebabSlug(title, 8);
      return s || null;
    }
    if (line.trim() !== "") break;
  }
  return null;
}

/** Prefer H1 from draft, else first words of the user's topic. */
export function suggestDocumentFilename(params: {
  markdown: string;
  topic: string;
}): string {
  const fromHeading = firstHeadingToSlug(params.markdown);
  if (fromHeading) return fromHeading;
  return textToKebabSlug(params.topic, 5);
}

/** True when the header should get an auto-name (empty or default placeholder). */
export function isPlaceholderDocumentName(name: string): boolean {
  const t = name.trim().toLowerCase();
  return t.length === 0 || t === "untitled";
}

/**
 * First 40 chars of the prompt → kebab-case filename (special chars stripped).
 */
export function slugFromPromptFirst40(prompt: string): string {
  const slice = prompt.trim().slice(0, 40);
  const seg = slice
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return (seg || "document").slice(0, 120);
}
