"use client";

import { useEffect, useState } from "react";
import { FileText, Pencil, Plus } from "lucide-react";
import { LoadingSpinner } from "@/components/LoadingSpinner";

type ListState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; slugs: string[] }
  | { kind: "error"; message: string };

type Props = {
  open: boolean;
  onClose: () => void;
  onRename: () => void;
  onOpenNewFile: () => void;
  onSelectRepoSlug: (slug: string) => void;
  getGithubHeaders: () => Record<string, string> | null;
  currentSlug: string;
};

export function FileSwitcherMenu({
  open,
  onClose,
  onRename,
  onOpenNewFile,
  onSelectRepoSlug,
  getGithubHeaders,
  currentSlug,
}: Props) {
  const [list, setList] = useState<ListState>({ kind: "idle" });

  useEffect(() => {
    if (!open) {
      setList({ kind: "idle" });
      return;
    }
    let cancelled = false;
    (async () => {
      setList({ kind: "loading" });
      const h = getGithubHeaders();
      if (!h) {
        if (!cancelled) {
          setList({
            kind: "error",
            message: "Add repository and token in Settings to browse files.",
          });
        }
        return;
      }
      try {
        const res = await fetch("/api/github/list-documents", { headers: h });
        const data = (await res.json().catch(() => ({}))) as {
          slugs?: unknown;
          error?: unknown;
        };
        if (!res.ok) {
          if (!cancelled) {
            setList({
              kind: "error",
              message:
                typeof data.error === "string"
                  ? data.error
                  : "Could not list files.",
            });
          }
          return;
        }
        const slugs = Array.isArray(data.slugs)
          ? data.slugs.filter((s): s is string => typeof s === "string")
          : [];
        if (!cancelled) setList({ kind: "ok", slugs });
      } catch {
        if (!cancelled) setList({ kind: "error", message: "Network error." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, getGithubHeaders]);

  if (!open) return null;

  return (
    <div
      role="menu"
      aria-label="Document and project"
      className="absolute left-0 top-full z-50 mt-1 min-w-[15rem] max-h-[min(70vh,22rem)] overflow-y-auto overscroll-contain rounded-xl border border-zinc-200 bg-white py-1 shadow-xl"
    >
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-50"
        onClick={() => {
          onRename();
          onClose();
        }}
      >
        <Pencil className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
        Rename document
      </button>
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-50"
        onClick={() => {
          onOpenNewFile();
          onClose();
        }}
      >
        <Plus className="h-4 w-4 shrink-0 text-zinc-500" aria-hidden />
        Open new file
      </button>
      <div className="my-1 border-t border-zinc-100" />
      <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
        Switch project
      </p>
      <p className="px-3 pb-1 text-[11px] leading-snug text-zinc-500">
        Open another <code className="rounded bg-zinc-100 px-0.5 font-mono text-[10px]">sds/*.md</code>{" "}
        from this repo.
      </p>
      {list.kind === "loading" ? (
        <div className="flex justify-center py-4">
          <LoadingSpinner className="h-5 w-5 text-zinc-500" />
        </div>
      ) : null}
      {list.kind === "error" ? (
        <p className="px-3 py-2 text-xs text-amber-800">{list.message}</p>
      ) : null}
      {list.kind === "ok" && list.slugs.length === 0 ? (
        <p className="px-3 py-2 text-xs text-zinc-500">No documents in sds/ yet.</p>
      ) : null}
      {list.kind === "ok" && list.slugs.length > 0 ? (
        <ul className="max-h-48 overflow-y-auto py-0.5">
          {list.slugs.map((s) => {
            const active = s === currentSlug.trim();
            return (
              <li key={s}>
                <button
                  type="button"
                  role="menuitem"
                  disabled={active}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm font-mono hover:bg-zinc-50 disabled:cursor-default disabled:bg-zinc-50/80 disabled:text-zinc-400 ${
                    active ? "text-indigo-700" : "text-zinc-800"
                  }`}
                  onClick={() => {
                    onSelectRepoSlug(s);
                    onClose();
                  }}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
                  {s}
                  {active ? (
                    <span className="ml-auto text-[10px] font-sans font-normal text-zinc-400">
                      current
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
