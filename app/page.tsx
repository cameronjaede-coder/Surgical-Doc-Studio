"use client";

import { useCallback, useEffect, useState } from "react";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import { PrDiff } from "@/components/PrDiff";
import { parseDocumentToBlocks } from "@/lib/sds/parse";
import type { SdsBlock } from "@/lib/sds/types";

function toSdsBlocks(
  parsed: Omit<SdsBlock, "verified">[],
): SdsBlock[] {
  return parsed.map((b) => ({ ...b, verified: false }));
}

export default function Home() {
  const [slug, setSlug] = useState("my-prd");
  const [branchInfo, setBranchInfo] = useState<{
    repo: string | null;
    branch: string;
    codaConfigured: boolean;
  } | null>(null);

  const [paste, setPaste] = useState("");
  const [genTopic, setGenTopic] = useState("");
  const [blocks, setBlocks] = useState<SdsBlock[]>([]);

  const [instrById, setInstrById] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pending, setPending] = useState<
    Record<
      string,
      { oldText: string; newText: string; accepted?: boolean } | undefined
    >
  >({});
  const [editBusyId, setEditBusyId] = useState<string | null>(null);
  type LoadingState =
    | { kind: "idle" }
    | { kind: "parse" }
    | { kind: "save" }
    | { kind: "load" }
    | { kind: "generate" }
    | { kind: "coda" }
    | { kind: "verify"; blockId: string };
  const [loading, setLoading] = useState<LoadingState>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [lastCommitMeta, setLastCommitMeta] = useState<{
    commitUrl: string;
    fileUrl: string | null;
  } | null>(null);
  const [commitMetaByBlockId, setCommitMetaByBlockId] = useState<
    Record<string, { commitUrl: string; fileUrl: string | null } | undefined>
  >({});

  const busy = loading.kind !== "idle";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    void fetch("/api/config")
      .then((r) => r.json())
      .then((d) => {
        if (d && typeof d.branch === "string") {
          setBranchInfo({
            repo: d.repo ?? null,
            branch: d.branch,
            codaConfigured: Boolean(d.codaConfigured),
          });
        }
      })
      .catch(() => {});
  }, []);

  const parseFromPaste = async () => {
    setError(null);
    setLoading({ kind: "parse" });
    setPending({});
    await Promise.resolve();
    const parsed = parseDocumentToBlocks(paste);
    setBlocks(toSdsBlocks(parsed));
    setLoading({ kind: "idle" });
  };

  const generateDraft = async () => {
    if (!genTopic.trim()) {
      setError("Describe what to draft before generating.");
      return;
    }
    setError(null);
    setLoading({ kind: "generate" });
    setPending({});
    try {
      const res = await fetch("/api/generate-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: genTopic.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Generate failed.");
        return;
      }
      if (typeof data.markdown !== "string") {
        setError("Invalid draft response.");
        return;
      }
      setPaste(data.markdown);
      const parsed = parseDocumentToBlocks(data.markdown);
      setBlocks(toSdsBlocks(parsed));
    } catch {
      setError("Network error while generating draft.");
    } finally {
      setLoading({ kind: "idle" });
    }
  };

  const syncGithub = async (opts: {
    commitMessage: string;
    verifyBlockId?: string;
    metaBlockId?: string;
    blocksOverride?: SdsBlock[];
    /** Which top button shows a spinner when not verifying a block */
    primaryAction?: "save";
  }) => {
    const effective = opts.blocksOverride ?? blocks;
    if (!slug.trim()) {
      setError("Set a document slug before syncing.");
      return;
    }
    if (effective.length === 0) {
      setError("Parse or generate a document first.");
      return;
    }
    setError(null);
    setLoading(
      opts.verifyBlockId
        ? { kind: "verify", blockId: opts.verifyBlockId }
        : { kind: opts.primaryAction ?? "save" },
    );
    try {
      const res = await fetch("/api/github/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slug.trim(),
          blocks: effective,
          commitMessage: opts.commitMessage,
          verifyBlockId: opts.verifyBlockId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "GitHub sync failed.");
        return;
      }
      if (data.document?.blocks) {
        setBlocks(data.document.blocks as SdsBlock[]);
      }
      if (typeof data.commitUrl === "string") {
        const meta = {
          commitUrl: data.commitUrl,
          fileUrl:
            typeof data.fileUrl === "string" ? data.fileUrl : null,
        };
        setLastCommitMeta(meta);
        const metaBlockId = opts.metaBlockId;
        if (typeof metaBlockId === "string" && metaBlockId) {
          setCommitMetaByBlockId((prev) => ({
            ...prev,
            [metaBlockId]: meta,
          }));
        }
      }
    } catch {
      setError("Network error while syncing to GitHub.");
    } finally {
      setLoading({ kind: "idle" });
    }
  };

  const loadFromGithub = useCallback(async () => {
    if (!slug.trim()) {
      setError("Enter a slug to load.");
      return;
    }
    setError(null);
    setLoading({ kind: "load" });
    setPending({});
    try {
      const res = await fetch(
        `/api/github/document?slug=${encodeURIComponent(slug.trim())}`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Load failed.");
        return;
      }
      const doc = data.document;
      if (!doc?.blocks || !Array.isArray(doc.blocks)) {
        setError("Invalid document from GitHub.");
        return;
      }
      setBlocks(doc.blocks as SdsBlock[]);
      if (typeof doc.markdown === "string") {
        setPaste(doc.markdown);
      }
    } catch {
      setError("Network error while loading.");
    } finally {
      setLoading({ kind: "idle" });
    }
  }, [slug]);

  const runSurgicalEdit = async (id: string) => {
    const block = blocks.find((b) => b.id === id);
    if (!block) return;
    const instruction = (instrById[id] ?? "").trim();
    if (!instruction) {
      setError("Add an instruction before sending to Claude.");
      return;
    }
    setError(null);
    setEditBusyId(id);
    try {
      const res = await fetch("/api/surgical-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ block: block.text, instruction }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Edit failed.");
        return;
      }
      if (typeof data.result !== "string") {
        setError("Invalid edit response.");
        return;
      }
      setPending((p) => ({
        ...p,
        [id]: { oldText: block.text, newText: data.result },
      }));
    } catch {
      setError("Network error during surgical edit.");
    } finally {
      setEditBusyId(null);
    }
  };

  const acceptEdit = async (id: string) => {
    const pair = pending[id];
    if (!pair) return;
    const nextBlocks = blocks.map((b) =>
      b.id === id ? { ...b, text: pair.newText } : b,
    );
    setBlocks(nextBlocks);
    setPending((p) => ({
      ...p,
      [id]:
        p[id] && p[id]!.newText
          ? { ...p[id]!, accepted: true }
          : p[id],
    }));

    await syncGithub({
      commitMessage: `SDS: accept surgical edit for block ${id.slice(0, 8)}`,
      blocksOverride: nextBlocks,
      primaryAction: "save",
      metaBlockId: id,
    });
  };

  const toggleVerify = async (id: string) => {
    const block = blocks.find((b) => b.id === id);
    if (!block) return;
    const nextVerified = !block.verified;
    const nextBlocks = blocks.map((b) =>
      b.id === id ? { ...b, verified: nextVerified } : b,
    );

    await syncGithub({
      commitMessage: nextVerified
        ? `SDS: human-verify block ${id.slice(0, 8)} (${block.kind})`
        : `SDS: revoke verification for block ${id.slice(0, 8)}`,
      verifyBlockId: id,
      metaBlockId: id,
      blocksOverride: nextBlocks,
    });
  };

  const exportCoda = async () => {
    if (!slug.trim()) {
      setError("Set a document slug for export.");
      return;
    }
    setError(null);
    setLoading({ kind: "coda" });
    try {
      const res = await fetch("/api/export-coda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: slug.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Coda export failed.");
        return;
      }
      alert(
        typeof data.message === "string"
          ? data.message
          : "Export submitted to Coda.",
      );
    } catch {
      setError("Network error during Coda export.");
    } finally {
      setLoading({ kind: "idle" });
    }
  };

  const cleanJsonHref = slug.trim()
    ? `/api/clean-json?slug=${encodeURIComponent(slug.trim())}`
    : "";

  return (
    <div className="flex min-h-full flex-col bg-zinc-100 text-zinc-900">
      <header className="border-b border-zinc-800 bg-zinc-900 text-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-5 sm:px-6">
          <h1 className="text-xl font-semibold tracking-tight">
            Surgical Doc Studio
          </h1>
          <p className="max-w-3xl text-sm text-zinc-400">
            Block-level surgical edits with Claude, GitHub audit trails for
            human verification, and clean exports for Coda and downstream AI
            pipelines.
          </p>
          {branchInfo ? (
            <p className="text-xs text-zinc-500">
              Repo: {branchInfo.repo ?? "—"} · Branch:{" "}
              <span className="font-mono">{branchInfo.branch}</span>
              {branchInfo.codaConfigured ? " · Coda: ready" : " · Coda: not configured"}
            </p>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-4 py-8 sm:px-6">
        {busy ? (
          <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600 shadow-sm">
            <LoadingSpinner className="h-4 w-4 text-zinc-700" />
            Working...
          </div>
        ) : null}
        {error ? (
          <div
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Document
          </h2>
          <label className="mb-1 block text-xs font-medium text-zinc-600">
            Slug (stored as{" "}
            <code className="font-mono">sds/&lt;slug&gt;.json</code>)
          </label>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="mb-4 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400"
            placeholder="e.g. q1-pricing-prd"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void syncGithub({
                  commitMessage: "SDS: ingest draft to GitHub",
                  primaryAction: "save",
                })
              }
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {loading.kind === "save" ? (
                <LoadingSpinner className="h-4 w-4 text-white" />
              ) : null}
              Save draft to GitHub
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void loadFromGithub()}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50"
            >
              {loading.kind === "load" ? (
                <LoadingSpinner className="h-4 w-4 text-zinc-700" />
              ) : null}
              Load from GitHub
            </button>
            {branchInfo?.codaConfigured ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void exportCoda()}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-50"
              >
                {loading.kind === "coda" ? (
                  <LoadingSpinner className="h-4 w-4 text-white" />
                ) : null}
                Export verified → Coda
              </button>
            ) : null}
          </div>
          {lastCommitMeta ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-500">Latest commit</span>
              <a
                href={lastCommitMeta.commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-100"
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                Open commit
              </a>
              {lastCommitMeta.fileUrl ? (
                <a
                  href={lastCommitMeta.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  View file
                </a>
              ) : null}
            </div>
          ) : null}
          <p className="mt-4 text-xs text-zinc-600">
            Pipeline{" "}
            {mounted && cleanJsonHref ? (
              <a
                href={cleanJsonHref}
                className="font-mono text-violet-700 underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                clean JSON
              </a>
            ) : (
              <span className="font-mono text-zinc-400">clean JSON</span>
            )}{" "}
            (verified blocks only; use server-to-server with your deploy auth
            as needed).
          </p>
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Ingest
          </h2>
          <div className="mb-6">
            <label className="mb-1 block text-xs font-medium text-zinc-600">
              Generate draft in-app (Claude)
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={genTopic}
                onChange={(e) => setGenTopic(e.target.value)}
                placeholder="e.g. API migration plan for payments service"
                className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => void generateDraft()}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading.kind === "generate" ? (
                  <LoadingSpinner className="h-4 w-4 text-white" />
                ) : null}
                Generate
              </button>
            </div>
          </div>
          <label className="mb-1 block text-xs font-medium text-zinc-600">
            Or paste Markdown
          </label>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={7}
            className="mb-3 w-full resize-y rounded-lg border border-zinc-300 px-3 py-2 text-sm leading-relaxed outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400"
            placeholder="Paste a PRD or specification (headers, paragraphs, lists)."
          />
          <button
            type="button"
            disabled={busy}
            suppressHydrationWarning
            onClick={() => void parseFromPaste()}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {loading.kind === "parse" ? (
              <LoadingSpinner className="h-4 w-4 text-white" />
            ) : null}
            Parse into blocks
          </button>
        </section>

        {blocks.length > 0 ? (
          <section className="space-y-4">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Surgical workspace · {blocks.length} blocks
            </h2>
            <ul className="space-y-4">
              {blocks.map((b, idx) => {
                const hasPending = Boolean(pending[b.id]);
                const expanded = expandedId === b.id;
                const blockCommitMeta = commitMetaByBlockId[b.id];
                return (
                  <li
                    key={b.id}
                    className={`rounded-xl border border-zinc-200 bg-white shadow-sm ${
                      b.verified
                        ? "border-l-4 border-l-emerald-500"
                        : "border-l-4 border-l-zinc-300"
                    }`}
                  >
                    <div className="p-4">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-zinc-500">
                          #{idx + 1}
                        </span>
                        <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium uppercase text-zinc-700">
                          {b.kind}
                        </span>
                        {b.verified ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            Verified
                            {b.verifiedBy
                              ? ` · ${b.verifiedBy}`
                              : ""}
                            {b.verifiedAt
                              ? ` · ${b.verifiedAt.slice(0, 19)}Z`
                              : ""}
                          </span>
                        ) : (
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                            Draft
                          </span>
                        )}
                      </div>
                      <pre className="mb-4 whitespace-pre-wrap rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-sm text-zinc-800">
                        {b.text}
                      </pre>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedId(expanded ? null : b.id)
                          }
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50"
                        >
                          {expanded ? "Close" : "Surgical edit"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void toggleVerify(b.id)}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                          {loading.kind === "verify" &&
                          loading.blockId === b.id ? (
                            <LoadingSpinner className="h-4 w-4 text-white" />
                          ) : null}
                          {b.verified ? "Unverify" : "✓ Human verify + commit"}
                        </button>
                        {blockCommitMeta ? (
                          <>
                            <a
                              href={blockCommitMeta.commitUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100"
                            >
                              Open commit
                            </a>
                            {blockCommitMeta.fileUrl ? (
                              <a
                                href={blockCommitMeta.fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                              >
                                View file
                              </a>
                            ) : null}
                          </>
                        ) : null}
                      </div>

                      {expanded ? (
                        <div className="mt-4 border-t border-zinc-100 pt-4">
                          <label className="mb-1 block text-xs font-medium text-zinc-600">
                            Instruction (only this block is sent to Claude)
                          </label>
                          <textarea
                            value={instrById[b.id] ?? ""}
                            onChange={(e) =>
                              setInstrById((s) => ({
                                ...s,
                                [b.id]: e.target.value,
                              }))
                            }
                            rows={3}
                            className="mb-3 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-400"
                            placeholder='e.g. "Update this to the new /v2/events endpoint."'
                          />
                          <button
                            type="button"
                            disabled={busy || editBusyId === b.id}
                            onClick={() => void runSurgicalEdit(b.id)}
                            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {editBusyId === b.id ? (
                              <LoadingSpinner className="h-4 w-4 text-white" />
                            ) : null}
                            {editBusyId === b.id
                              ? "Running…"
                              : "Run surgical edit"}
                          </button>
                        </div>
                      ) : null}

                      {hasPending ? (
                        <div className="mt-4 space-y-2 border-t border-zinc-100 pt-4">
                          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Diff — AI vs previous block
                          </p>
                          <PrDiff
                            before={pending[b.id]!.oldText}
                            after={pending[b.id]!.newText}
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              disabled={busy || pending[b.id]?.accepted === true}
                              onClick={() => void acceptEdit(b.id)}
                              className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                            >
                              {busy && loading.kind === "save" ? (
                                <LoadingSpinner className="h-4 w-4 text-white" />
                              ) : null}
                              {pending[b.id]?.accepted
                                ? "Accepted"
                                : "Accept new block"}
                            </button>
                            {blockCommitMeta ? (
                              <>
                                <a
                                  href={blockCommitMeta.commitUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100"
                                >
                                  Open commit
                                </a>
                                {blockCommitMeta.fileUrl ? (
                                  <a
                                    href={blockCommitMeta.fileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                                  >
                                    View file
                                  </a>
                                ) : null}
                              </>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}
