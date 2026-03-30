import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { NextResponse } from "next/server";

const SYSTEM =
  "You are in Surgical Mode. You receive a single document block and a user instruction. Return ONLY the modified block. Do not add explanation, preamble, or commentary. Return only the modified block. Do not alter tone, style, or content of surrounding context (there is no surrounding context in this request—only this block matters). Your entire response must be the rewritten block and nothing else.";

export async function POST(request: Request) {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured." },
        { status: 500 },
      );
    }

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

    const anthropic = createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-5-20250929"),
      system: SYSTEM,
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
