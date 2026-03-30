/**
 * Strip model IDs and SDK noise from user-visible copy; log details separately.
 */

const TECH_HINTS =
  /\b(claude[-_/][\w.-]+|gemini[-.]?[\w.-]+|gpt[-_]?[\w.-]+|models\/|@ai-sdk|anthropic|openai\.com|generativelanguage|AI_\w+|sk-[a-z0-9_-]{8,})\b/i;

export function isTechnicalAiErrorMessage(msg: string): boolean {
  const s = msg.trim();
  if (s.length === 0) return true;
  if (TECH_HINTS.test(s)) return true;
  if (/^\d{3}\s+(\w+\s*)+$/.test(s) && s.length < 80) return false;
  if (s.length > 400 && /[{}[\]]/.test(s)) return true;
  return false;
}

export function sanitizeOneLineUserMessage(msg: string, maxLen = 240): string {
  return msg.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/** Message safe to show in the red banner, or null to hide the bar. */
export function toUserFacingBannerMessage(raw: unknown): string | null {
  if (raw == null) return null;
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  // SDK/Anthropic often returns bare `model: claude-…` when a model id is invalid or retired.
  if (/^model:\s*\S/im.test(s)) {
    return "That AI model isn’t available for your key or was retired. Open Settings and choose another model.";
  }
  if (isTechnicalAiErrorMessage(s)) return null;
  return sanitizeOneLineUserMessage(s);
}
