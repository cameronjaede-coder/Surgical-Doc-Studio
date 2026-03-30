import { generateText } from "ai";
import { NextResponse } from "next/server";
import {
  createLanguageModel,
  generateSystemPrompt,
  resolveApiKeyForRequest,
  type AiProvider,
} from "@/lib/ai/providers";
import {
  LEGACY_ANTHROPIC_MODEL_ID,
  parseAiInlineRequest,
} from "@/lib/ai/request-body";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const topic =
      body && typeof body === "object" && typeof (body as { topic?: unknown }).topic === "string"
        ? (body as { topic: string }).topic
        : "";

    if (!topic.trim()) {
      return NextResponse.json(
        { error: '"topic" must be a non-empty string.' },
        { status: 400 },
      );
    }

    let provider: AiProvider;
    let modelId: string;
    let keyFromBody: string;

    const parsed = parseAiInlineRequest(body);
    if (parsed) {
      ({ provider, modelId, apiKey: keyFromBody } = parsed);
    } else {
      const env = process.env.ANTHROPIC_API_KEY?.trim();
      if (!env) {
        return NextResponse.json(
          {
            error:
              'No AI configuration. Add an API key in Settings (send "ai" in the body) or set ANTHROPIC_API_KEY.',
          },
          { status: 400 },
        );
      }
      provider = "anthropic";
      modelId = LEGACY_ANTHROPIC_MODEL_ID;
      keyFromBody = "";
    }

    const apiKey = resolveApiKeyForRequest(provider, keyFromBody);
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            "No API key for the selected provider. Add it in Settings or set ANTHROPIC_API_KEY for Claude.",
        },
        { status: 400 },
      );
    }

    const model = createLanguageModel(provider, apiKey, modelId);
    const { text } = await generateText({
      model,
      system: generateSystemPrompt(provider),
      prompt: `Draft a document about:\n\n${topic.trim()}`,
      maxOutputTokens: 8192,
    });

    return NextResponse.json({ markdown: text.trim() });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Draft generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
