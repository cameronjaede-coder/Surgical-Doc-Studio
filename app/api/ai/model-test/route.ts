import { generateText } from "ai";
import { NextResponse } from "next/server";
import {
  createLanguageModel,
  getPresetById,
  isAiProvider,
  resolveApiKeyForRequest,
  type AiProvider,
} from "@/lib/ai/providers";

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
  const o = body as Record<string, unknown>;
  let provider = o.provider;
  let modelId =
    typeof o.modelId === "string" && o.modelId.trim() ? o.modelId.trim() : "";
  const presetId = typeof o.presetId === "string" ? o.presetId.trim() : "";
  if (presetId) {
    const preset = getPresetById(presetId);
    provider = preset.provider;
    modelId = preset.modelId;
  }
  if (!isAiProvider(provider)) {
    return NextResponse.json(
      { error: 'Invalid "provider" or "presetId".' },
      { status: 400 },
    );
  }
  if (!modelId) {
    return NextResponse.json({ error: "modelId required." }, { status: 400 });
  }
  const fromBody = typeof o.apiKey === "string" ? o.apiKey : "";
  const apiKey = resolveApiKeyForRequest(provider as AiProvider, fromBody);
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "No API key. Paste your provider key above or set ANTHROPIC_API_KEY for Claude.",
      },
      { status: 400 },
    );
  }

  try {
    const model = createLanguageModel(provider as AiProvider, apiKey, modelId);
    const { text } = await generateText({
      model,
      prompt: 'Reply with exactly the two words: Hello World',
      maxOutputTokens: 32,
    });
    const t = text.trim().toLowerCase();
    const ok = t.includes("hello") && t.includes("world");
    if (!ok) {
      return NextResponse.json(
        { error: `Unexpected model output: ${text.slice(0, 120)}` },
        { status: 502 },
      );
    }
    return NextResponse.json({
      ok: true,
      provider,
      modelId,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Model connection failed.";
    if (message.includes("not configured")) {
      return NextResponse.json({ error: message }, { status: 500 });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
