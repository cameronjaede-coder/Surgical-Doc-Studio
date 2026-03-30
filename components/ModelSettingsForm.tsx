"use client";

import { AI_MODEL_PRESETS } from "@/lib/ai/providers";
import type { AiUserConfig } from "@/lib/sds/settings-types";

export type ModelTestState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

type Props = {
  draft: AiUserConfig;
  onDraftChange: (next: AiUserConfig) => void;
};

export function ModelSettingsForm({ draft, onDraftChange }: Props) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Model settings
      </h3>
      <p className="text-[11px] leading-relaxed text-zinc-500">
        Used for <strong>Generate</strong> and <strong>Surgical edit</strong>. Keys are stored in
        this browser (localStorage) and sent to this app over HTTPS only for each request.
      </p>
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-600">
          Active model
        </label>
        <select
          value={draft.activeModelPreset}
          onChange={(e) =>
            onDraftChange({ ...draft, activeModelPreset: e.target.value })
          }
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
        >
          {AI_MODEL_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-600">
          Anthropic API key
        </label>
        <input
          type="password"
          value={draft.anthropicApiKey}
          onChange={(e) =>
            onDraftChange({ ...draft, anthropicApiKey: e.target.value })
          }
          placeholder="sk-ant-…"
          autoComplete="off"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-600">
          Google AI Studio (Gemini) key
        </label>
        <input
          type="password"
          value={draft.googleApiKey}
          onChange={(e) =>
            onDraftChange({ ...draft, googleApiKey: e.target.value })
          }
          placeholder="AIza…"
          autoComplete="off"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-600">
          OpenAI API key
        </label>
        <input
          type="password"
          value={draft.openaiApiKey}
          onChange={(e) =>
            onDraftChange({ ...draft, openaiApiKey: e.target.value })
          }
          placeholder="sk-…"
          autoComplete="off"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 font-mono text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
        />
      </div>
    </div>
  );
}
