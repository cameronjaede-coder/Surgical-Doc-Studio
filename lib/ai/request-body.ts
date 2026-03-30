import { isAiProvider, type AiProvider } from "./providers";

export type AiInlineRequest = {
  provider: AiProvider;
  modelId: string;
  apiKey: string;
};

/**
 * Parse optional `ai` object from JSON body.
 * Returns null if missing or invalid (caller may fall back to env Anthropic).
 */
export function parseAiInlineRequest(body: unknown): AiInlineRequest | null {
  if (!body || typeof body !== "object") return null;
  const ai = (body as { ai?: unknown }).ai;
  if (!ai || typeof ai !== "object") return null;
  const o = ai as Record<string, unknown>;
  if (!isAiProvider(o.provider)) return null;
  if (typeof o.modelId !== "string" || !o.modelId.trim()) return null;
  if (typeof o.apiKey !== "string") return null;
  return {
    provider: o.provider,
    modelId: o.modelId.trim(),
    apiKey: o.apiKey.trim(),
  };
}

/** Legacy default when no BYOK and using Anthropic env. */
export const LEGACY_ANTHROPIC_MODEL_ID = "claude-sonnet-4-5-20250929";
