"use client";

import type { RefObject } from "react";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { parseRepo } from "@/lib/github/parse-repo";
import type { SdsGithubConfig } from "@/lib/sds/settings-types";

export type { SdsGithubConfig };

export type GithubTestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

type Props = {
  draft: SdsGithubConfig;
  onDraftChange: (next: SdsGithubConfig) => void;
  onSave: () => void;
  onTest: () => void;
  testState: GithubTestState;
  saveDisabled?: boolean;
  /** Hide save/test row when using a parent panel with unified actions */
  showActions?: boolean;
  inlineError?: string | null;
  repoInputRef?: RefObject<HTMLInputElement | null>;
};

export function GithubConfigPopoverForm({
  draft,
  onDraftChange,
  onSave,
  onTest,
  testState,
  saveDisabled,
  showActions = true,
  inlineError,
  repoInputRef,
}: Props) {
  const repoOk = parseRepo(draft.repo) !== null;
  const canSave = repoOk && draft.token.trim().length > 0;

  return (
    <div className="w-full space-y-3">
      {inlineError ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800"
        >
          {inlineError}
        </p>
      ) : null}
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-600">
          Repository
        </label>
        <input
          ref={repoInputRef}
          id="sds-github-repo-input"
          value={draft.repo}
          onChange={(e) => onDraftChange({ ...draft, repo: e.target.value })}
          placeholder="owner/repo or https://github.com/owner/repo"
          autoComplete="off"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-600">
          Branch
        </label>
        <input
          value={draft.branch}
          onChange={(e) => onDraftChange({ ...draft, branch: e.target.value })}
          placeholder="main"
          autoComplete="off"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-600">
          GitHub token
        </label>
        <input
          type="password"
          value={draft.token}
          onChange={(e) => onDraftChange({ ...draft, token: e.target.value })}
          placeholder="ghp_xxxxxxxxxxxx"
          autoComplete="off"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
        />
      </div>

      <p className="text-[11px] leading-relaxed text-zinc-500">
        Your token is saved in this browser (localStorage). When you load or sync,
        it is sent to this app over HTTPS only so the server can call GitHub on your
        behalf; it is not written to disk on the server.
      </p>

      {showActions ? (
        <>
          {testState.kind === "ok" ? (
            <p className="text-xs text-emerald-700">{testState.message}</p>
          ) : null}
          {testState.kind === "error" ? (
            <p className="text-xs text-red-700">{testState.message}</p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              disabled={Boolean(saveDisabled) || !canSave}
              onClick={onSave}
              className="inline-flex flex-1 items-center justify-center rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              Save configuration
            </button>
            <button
              type="button"
              disabled={testState.kind === "loading" || !repoOk || !draft.token.trim()}
              onClick={onTest}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
            >
              {testState.kind === "loading" ? (
                <LoadingSpinner className="h-4 w-4 text-zinc-700" />
              ) : null}
              Test connection
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
