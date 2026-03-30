/**
 * Read a fetch Response as text and parse JSON when possible.
 * Returns structured fields so error logging never degrades to `{}`.
 */
export async function readResponseJson(
  res: Response,
): Promise<{
  data: Record<string, unknown>;
  rawText: string;
  jsonOk: boolean;
}> {
  const rawText = await res.text();
  if (!rawText.trim()) {
    return { data: {}, rawText: "", jsonOk: true };
  }
  try {
    const parsed = JSON.parse(rawText) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        data: parsed as Record<string, unknown>,
        rawText,
        jsonOk: true,
      };
    }
    return {
      data: { _unexpectedBody: parsed },
      rawText,
      jsonOk: false,
    };
  } catch {
    return {
      data: { _jsonParseError: true as const },
      rawText,
      jsonOk: false,
    };
  }
}
