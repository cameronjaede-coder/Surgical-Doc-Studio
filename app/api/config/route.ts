import { NextResponse } from "next/server";
import { parseRepo } from "@/lib/github-repo";

export async function GET() {
  const repoEnv = process.env.GITHUB_REPO ?? "";
  const parsed = parseRepo(repoEnv);
  const branch = (process.env.GITHUB_BRANCH || "main").trim() || "main";

  return NextResponse.json({
    repo: parsed ? `${parsed.owner}/${parsed.repo}` : null,
    branch,
  });
}
