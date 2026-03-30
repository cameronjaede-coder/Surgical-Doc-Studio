import { generateText } from "ai";
import { NextResponse } from "next/server";
import {
  createLanguageModel,
  resolveApiKeyForRequest,
  surgicalSystemPrompt,
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

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Expected JSON object body." }, { status: 400 });
    }

    const { block, instruction } = body as { block?: unknown; instruction?: unknown };
    if (typeof block !== "string" || typeof instruction !== "string") {
      return NextResponse.json(
        { error: '"block" and "instruction" must be strings.' },
        { status: 400 },
      );
    }

    if (!instruction.trim()) {
      return NextResponse.json(
        { error: "instruction must not be empty." },
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
      system: surgicalSystemPrompt(provider),
      prompt: `Block:\n\n${block}\n\nInstruction:\n\n${instruction}`,
      maxOutputTokens: 16_384,
    });

    const result = text.trimEnd();
    return NextResponse.json({ result });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Surgical edit failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
