import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { NextResponse } from "next/server";

const SYSTEM = `You write high-fidelity technical documents and PRDs in Markdown.
Use ## and ### headings, normal paragraphs, and bullet or numbered lists where appropriate.
Output ONLY the Markdown document. No preamble or explanation.`;

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

    const anthropic = createAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-5-20250929"),
      system: SYSTEM,
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
