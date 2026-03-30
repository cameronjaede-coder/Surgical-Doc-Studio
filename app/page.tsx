"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCopy,
  CircleDashed,
  ArrowLeft,
  Download,
  FileText,
  FlaskConical,
  GitBranch,
  GitCommitHorizontal,
  RotateCcw,
  Scissors,
  Settings2,
  Sparkles,
  Undo2,
} from "lucide-react";
import {
  GithubConfigPopoverForm,
  type GithubTestState,
  type SdsGithubConfig,
} from "@/components/GithubConfigPopover";
import {
  ModelSettingsForm,
  type ModelTestState,
} from "@/components/ModelSettingsForm";
import { LoadingSpinner } from "@/components/LoadingSpinner";
import {
  apiKeyForProvider,
  getPresetById,
} from "@/lib/ai/providers";
import { parseRepo } from "@/lib/github/parse-repo";
import {
  EditorTutorial,
  type EditorTutorialStep,
} from "@/components/EditorTutorial";
import { FileSwitcherMenu } from "@/components/FileSwitcherMenu";
import { LandingPage } from "@/components/LandingPage";
import { PrDiff } from "@/components/PrDiff";
import { blocksToMarkdown, parseDocumentToBlocks } from "@/lib/sds/parse";
import type { SdsBlock } from "@/lib/sds/types";
import {
  aiConfigFromUnknown,
  DEFAULT_AI_CONFIG,
  type AiUserConfig,
} from "@/lib/sds/settings-types";
import {
  mergeVerificationFromLocalStorage,
  persistVerificationToLocalStorage,
} from "@/lib/sds/verification-local-storage";
import {
  isPlaceholderDocumentName,
  slugFromPromptFirst40,
  suggestDocumentFilename,
} from "@/lib/sds/slug-helpers";
import { readResponseJson } from "@/lib/sds/fetch-json";
import {
  isTechnicalAiErrorMessage,
  toUserFacingBannerMessage,
} from "@/lib/sds/user-facing-error";
import {
  hasSeenEditorTutorialForSlug,
  markEditorTutorialSeenForSlug,
} from "@/lib/sds/tutorial-seen";

const SDS_EDITOR_SESSION_KEY = "SDS_EDITOR_SESSION_V1";

type EditorSessionV1 = {
  v: 1;
  slug: string;
  blocks: SdsBlock[];
  lastSavedMarkdown: string | null;
  paste: string;
  selectedBlockId: string | null;
};

function toSdsBlocks(
  parsed: Omit<SdsBlock, "verified">[],
): SdsBlock[] {
  return parsed.map((b) => ({ ...b, verified: false }));
}

function isSdsBlockLike(x: unknown): x is SdsBlock {
  if (!x || typeof x !== "object") return false;
  const b = x as Record<string, unknown>;
  return (
    typeof b.id === "string" &&
    typeof b.text === "string" &&
    typeof b.verified === "boolean" &&
    (b.kind === "header" || b.kind === "paragraph" || b.kind === "list")
  );
}

/**
 * Forward wheel to a scroll parent (sidebar) or the window when a focused
 * <textarea> would otherwise swallow scroll.
 */
function wheelForwardToScrollParent(
  e: WheelEvent,
  scrollParent: HTMLElement | null,
) {
  const el = e.currentTarget as HTMLTextAreaElement;
  const { scrollTop, scrollHeight, clientHeight } = el;
  const dy = e.deltaY;
  const applyScroll = (delta: number) => {
    if (scrollParent) {
      scrollParent.scrollTop += delta;
    } else {
      window.scrollBy({ top: delta, left: 0, behavior: "auto" });
    }
  };
  if (scrollHeight <= clientHeight + 1) {
    e.preventDefault();
    applyScroll(dy);
    return;
  }
  const atTop = scrollTop <= 0;
  const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
  if ((dy < 0 && atTop) || (dy > 0 && atBottom)) {
    e.preventDefault();
    applyScroll(dy);
  }
}

export default function Home() {
  const [slug, setSlug] = useState("");
  const [branchInfo, setBranchInfo] = useState<{
    repo: string | null;
    branch: string;
  } | null>(null);
  const SDS_CONFIG_KEY = "SDS_CONFIG";
  const [githubConfig, setGithubConfig] = useState<SdsGithubConfig>({
    repo: "",
    branch: "main",
    token: "",
  });
  const [aiConfig, setAiConfig] = useState<AiUserConfig>(DEFAULT_AI_CONFIG);
  const [githubPopoverOpen, setGithubPopoverOpen] = useState(false);
  const [githubDraft, setGithubDraft] = useState<SdsGithubConfig>(githubConfig);
  const [aiDraft, setAiDraft] = useState<AiUserConfig>(DEFAULT_AI_CONFIG);
  const [githubTest, setGithubTest] = useState<GithubTestState>({ kind: "idle" });
  const [aiModelTest, setAiModelTest] = useState<ModelTestState>({ kind: "idle" });
  const githubHeaderRef = useRef<HTMLDivElement>(null);
  const githubRepoInputRef = useRef<HTMLInputElement>(null);
  const fileSwitcherRef = useRef<HTMLDivElement>(null);
  const githubConfigRef = useRef(githubConfig);
  githubConfigRef.current = githubConfig;
  const aiConfigRef = useRef(aiConfig);
  aiConfigRef.current = aiConfig;

  const [paste, setPaste] = useState("");
  const [genTopic, setGenTopic] = useState("");
  const [blocks, setBlocks] = useState<SdsBlock[]>([]);
  const [sessionRestored, setSessionRestored] = useState(false);

  const [instrById, setInstrById] = useState<Record<string, string>>({});
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [githubSettingsError, setGithubSettingsError] = useState<string | null>(
    null,
  );
  const [fileSwitcherOpen, setFileSwitcherOpen] = useState(false);
  /** Markdown snapshot after last parse/load/successful GitHub sync — for dirty detection */
  const [lastSavedMarkdown, setLastSavedMarkdown] = useState<string | null>(null);
  const [pending, setPending] = useState<
    Record<string, { oldText: string; newText: string } | undefined>
  >({});
  const [editBusyId, setEditBusyId] = useState<string | null>(null);
  type LoadingState =
    | { kind: "idle" }
    | { kind: "parse" }
    | { kind: "file" }
    | { kind: "save" }
    | { kind: "load" }
    | { kind: "generate" }
    | { kind: "verify"; blockId: string }
    | { kind: "bulk-verify" };
  const [loading, setLoading] = useState<LoadingState>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [commitMetaByBlockId, setCommitMetaByBlockId] = useState<
    Record<string, { commitUrl: string; fileUrl: string | null } | undefined>
  >({});
  const [justVerifiedId, setJustVerifiedId] = useState<string | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportVerifiedOnly, setExportVerifiedOnly] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  /** Bulk checkbox selection (multi-select for verify); distinct from `selectedBlockId` (sidebar). */
  const [bulkSelectedIds, setBulkSelectedIds] = useState<string[]>([]);
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);
  const blockRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const commandScrollRef = useRef<HTMLDivElement | null>(null);
  const commandBodyScrollRef = useRef<HTMLDivElement | null>(null);
  const documentFlowScrollRef = useRef<HTMLDivElement | null>(null);
  const documentFlowSectionRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const instructionRef = useRef<HTMLTextAreaElement | null>(null);
  const sourceTextRef = useRef<HTMLTextAreaElement | null>(null);
  const slugInputRef = useRef<HTMLInputElement | null>(null);
  const slugRef = useRef("");
  slugRef.current = slug;
  const documentTitleAnchorRef = useRef<HTMLDivElement | null>(null);
  const tutorialAsideRef = useRef<HTMLElement | null>(null);
  const [headerTitleEditing, setHeaderTitleEditing] = useState(false);
  const [editorTutorialOpen, setEditorTutorialOpen] = useState(false);
  const [editorTutorialStep, setEditorTutorialStep] = useState(0);
  const [slugWiggle, setSlugWiggle] = useState(false);

  const busy = loading.kind !== "idle";
  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) ?? null;
  const selectedIndex = selectedBlock
    ? blocks.findIndex((b) => b.id === selectedBlock.id)
    : -1;
  const selectedPending = selectedBlock ? pending[selectedBlock.id] : undefined;
  const selectedCommitMeta = selectedBlock
    ? commitMetaByBlockId[selectedBlock.id]
    : undefined;
  const exportBlocks = exportVerifiedOnly
    ? blocks.filter((b) => b.verified)
    : blocks;

  const currentMarkdown = useMemo(() => blocksToMarkdown(blocks), [blocks]);
  const hasUnsavedChanges =
    blocks.length > 0 &&
    lastSavedMarkdown !== null &&
    currentMarkdown !== lastSavedMarkdown;

  const inEditor = sessionRestored && blocks.length > 0;

  const resetToLanding = useCallback(() => {
    if (hasUnsavedChanges) {
      if (
        !window.confirm(
          "You have unsaved edits. Leave this document and go back to the start screen?",
        )
      ) {
        return;
      }
    }
    try {
      localStorage.removeItem(SDS_EDITOR_SESSION_KEY);
    } catch {
      /* ignore */
    }
    setBlocks([]);
    setPaste("");
    setGenTopic("");
    setPending({});
    setInstrById({});
    setSelectedBlockId(null);
    setLastSavedMarkdown(null);
    setCommitMetaByBlockId({});
    setBulkSelectedIds([]);
    setSlug("");
    setError(null);
    setFileSwitcherOpen(false);
    setHeaderTitleEditing(false);
    setEditorTutorialOpen(false);
    setEditorTutorialStep(0);
  }, [hasUnsavedChanges]);

  const dismissEditorTutorial = useCallback((markSeen: boolean) => {
    if (markSeen) markEditorTutorialSeenForSlug(slugRef.current);
    setEditorTutorialOpen(false);
    setEditorTutorialStep(0);
  }, []);

  const editorTutorialSteps = useMemo<EditorTutorialStep[]>(
    () => [
      {
        title: "Document Flow",
        description:
          "Surgical Doc Studio splits your PRD into blocks (headers, paragraphs, lists). Click a block to select it for editing. Use the checkboxes when you want to verify several blocks at once.",
        targetRef: documentFlowSectionRef,
      },
      {
        title: "Surgical Command Center",
        description:
          "Only the selected block is sent to the model. Edit the source text, write a precise instruction, and run Surgical edit for small, safe changes. Review the diff before accepting.",
        targetRef: commandScrollRef,
      },
      {
        title: "Review & GitHub",
        description:
          "When a block is ready, use Mark reviewed & sync at the bottom of this column to push changes. Configure repository and token under Settings first—verify and sync use that connection.",
        targetRef: tutorialAsideRef,
      },
      {
        title: "Header & export",
        description:
          "Use this bar for repo, branch, and the filename menu (rename, switch GitHub files, start fresh). Settings holds tokens and models. At the far right, Finalize & Export copies or downloads Markdown. Back (by the logo) returns to the start screen.",
        targetRef: documentTitleAnchorRef,
      },
    ],
    [],
  );

  const flowBusy =
    loading.kind === "parse" ||
    loading.kind === "file" ||
    loading.kind === "load" ||
    loading.kind === "generate"
      ? loading.kind
      : "idle";

  const githubConnected =
    parseRepo(githubConfig.repo) !== null &&
    githubConfig.token.trim().length > 0;
  const headerRepoDisplay =
    githubConfig.repo.trim() || branchInfo?.repo || "—";
  const headerBranchDisplay = githubConfig.repo.trim()
    ? (githubConfig.branch || "main").trim() || "main"
    : (branchInfo?.branch ?? "main");

  const errorBannerMessage = useMemo(() => {
    if (!error) return null;
    const t = error.trim();
    if (!t) return null;
    if (isTechnicalAiErrorMessage(t)) {
      console.warn("[SDS] hid technical error from banner:", t);
      return null;
    }
    return t;
  }, [error]);

  useEffect(() => {
    let loadedFromStorage = false;
    try {
      const raw = localStorage.getItem(SDS_CONFIG_KEY);
      if (raw) {
        const j = JSON.parse(raw) as Record<string, unknown>;
        const repo = typeof j.repo === "string" ? j.repo : "";
        const branch =
          typeof j.branch === "string" && j.branch.trim() ? j.branch : "main";
        const token = typeof j.token === "string" ? j.token : "";
        const next: SdsGithubConfig = { repo, branch, token };
        setGithubConfig(next);
        setAiConfig(aiConfigFromUnknown(j));
        if (parseRepo(repo)) {
          setBranchInfo({
            repo: repo.trim(),
            branch: (branch || "main").trim() || "main",
          });
          loadedFromStorage = true;
        }
      }
    } catch {
      /* ignore corrupt localStorage */
    }
    if (!loadedFromStorage) {
      void fetch("/api/config")
        .then((r) => r.json())
        .then((d) => {
          if (d && typeof d.branch === "string") {
            setBranchInfo({
              repo: d.repo ?? null,
              branch: d.branch,
            });
          }
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SDS_EDITOR_SESSION_KEY);
      if (raw) {
        const data = JSON.parse(raw) as Partial<EditorSessionV1>;
        if (
          data.v === 1 &&
          Array.isArray(data.blocks) &&
          data.blocks.length > 0
        ) {
          const restored = data.blocks.filter(isSdsBlockLike);
          if (restored.length > 0) {
            const md =
              typeof data.lastSavedMarkdown === "string" || data.lastSavedMarkdown === null
                ? data.lastSavedMarkdown
                : null;
            const slugVal = typeof data.slug === "string" ? data.slug : "";
            const pasteVal =
              typeof data.paste === "string"
                ? data.paste
                : blocksToMarkdown(restored);
            const sel =
              typeof data.selectedBlockId === "string" ? data.selectedBlockId : null;
            setSlug(slugVal);
            setBlocks(restored);
            setLastSavedMarkdown(
              md ?? blocksToMarkdown(restored),
            );
            setPaste(pasteVal);
            setSelectedBlockId(
              sel && restored.some((b) => b.id === sel)
                ? sel
                : (restored[0]?.id ?? null),
            );
          }
        }
      }
    } catch {
      /* ignore corrupt session */
    }
    setSessionRestored(true);
  }, []);

  useEffect(() => {
    if (!sessionRestored) return;
    if (blocks.length === 0) {
      try {
        localStorage.removeItem(SDS_EDITOR_SESSION_KEY);
      } catch {
        /* ignore */
      }
      return;
    }
    const t = window.setTimeout(() => {
      try {
        const payload: EditorSessionV1 = {
          v: 1,
          slug,
          blocks,
          lastSavedMarkdown,
          paste,
          selectedBlockId,
        };
        localStorage.setItem(SDS_EDITOR_SESSION_KEY, JSON.stringify(payload));
      } catch (e) {
        console.warn("[SDS] editor session save failed", e);
      }
    }, 320);
    return () => clearTimeout(t);
  }, [
    sessionRestored,
    blocks,
    slug,
    lastSavedMarkdown,
    paste,
    selectedBlockId,
  ]);

  useEffect(() => {
    if (!githubPopoverOpen) return;
    setGithubDraft(githubConfigRef.current);
    setAiDraft(aiConfigRef.current);
    setGithubTest({ kind: "idle" });
    setAiModelTest({ kind: "idle" });
  }, [githubPopoverOpen]);

  const openSettingsAndFocusRepo = useCallback((message?: string) => {
    if (message) setGithubSettingsError(message);
    setGithubPopoverOpen(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        githubRepoInputRef.current?.focus();
      });
    });
  }, []);

  const buildAiInlinePayload = () => {
    const preset = getPresetById(aiConfig.activeModelPreset);
    return {
      provider: preset.provider,
      modelId: preset.modelId,
      apiKey: apiKeyForProvider(aiConfig, preset.provider),
    };
  };

  useEffect(() => {
    if (!githubPopoverOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = githubHeaderRef.current;
      if (!el?.contains(e.target as Node)) {
        setGithubPopoverOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGithubPopoverOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [githubPopoverOpen]);

  useEffect(() => {
    if (!fileSwitcherOpen) return;
    const onDown = (e: PointerEvent) => {
      if (fileSwitcherRef.current?.contains(e.target as Node)) return;
      setFileSwitcherOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [fileSwitcherOpen]);

  const scrollToDocumentFlow = () => {
    requestAnimationFrame(() => {
      documentFlowSectionRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const focusSlugForSync = useCallback(() => {
    setHeaderTitleEditing(true);
    setSlugWiggle(true);
    window.setTimeout(() => setSlugWiggle(false), 700);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        documentTitleAnchorRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
        const el = document.getElementById("slug-input") as HTMLInputElement | null;
        el?.focus();
        el?.select();
      });
    });
  }, []);

  useEffect(() => {
    if (!headerTitleEditing) return;
    const id = window.setTimeout(() => {
      slugInputRef.current?.focus();
      slugInputRef.current?.select();
    }, 0);
    return () => clearTimeout(id);
  }, [headerTitleEditing]);

  const applyMarkdownAsBlocks = (
    markdown: string,
    opts?: { slugOverride?: string; serverBlocks?: SdsBlock[] },
  ) => {
    if (opts?.slugOverride !== undefined) {
      const s = opts.slugOverride.trim();
      if (s) setSlug(s);
    }
    setPending({});
    setBulkSelectedIds([]);
    const slugForStore = (opts?.slugOverride ?? slug).trim() || "_draft";
    let next: SdsBlock[];
    if (
      opts?.serverBlocks &&
      opts.serverBlocks.length > 0 &&
      opts.serverBlocks.every(isSdsBlockLike)
    ) {
      next = mergeVerificationFromLocalStorage(
        slugForStore,
        markdown,
        opts.serverBlocks.map((b) => ({ ...b })),
      );
    } else {
      next = mergeVerificationFromLocalStorage(
        slugForStore,
        markdown,
        toSdsBlocks(parseDocumentToBlocks(markdown)),
      );
    }
    setBlocks(next);
    setPaste(markdown);
    setLastSavedMarkdown(blocksToMarkdown(next));
    setSelectedBlockId(next[0]?.id ?? null);

    const slugForTour = (opts?.slugOverride ?? slug).trim();
    queueMicrotask(() => {
      if (hasSeenEditorTutorialForSlug(slugForTour)) return;
      setEditorTutorialOpen(true);
      setEditorTutorialStep(0);
    });
  };

  const parseFromPaste = async () => {
    setError(null);
    setLoading({ kind: "parse" });
    await Promise.resolve();
    let slugOverride: string | undefined;
    if (isPlaceholderDocumentName(slug) && paste.trim()) {
      const suggested = suggestDocumentFilename({ markdown: paste, topic: "" });
      if (suggested) slugOverride = suggested;
    }
    applyMarkdownAsBlocks(
      paste,
      slugOverride ? { slugOverride } : undefined,
    );
    setLoading({ kind: "idle" });
    scrollToDocumentFlow();
  };

  const generateDraft = async () => {
    if (!genTopic.trim()) {
      setError("Describe what to draft before generating.");
      return;
    }
    setError(null);
    setLoading({ kind: "generate" });
    setPending({});
    const topicTrim = genTopic.trim();
    let effectiveSlug = slug.trim();
    if (isPlaceholderDocumentName(effectiveSlug)) {
      effectiveSlug = slugFromPromptFirst40(topicTrim);
      setSlug(effectiveSlug);
    }
    try {
      const res = await fetch("/api/generate-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topicTrim,
          ai: buildAiInlinePayload(),
        }),
      });
      const { data, rawText, jsonOk } = await readResponseJson(res);
      if (!res.ok) {
        console.error(
          "[SDS] generate-draft failed",
          `HTTP ${res.status} ${res.statusText || ""}`.trim(),
          "| jsonParsed:",
          jsonOk,
          "| apiError:",
          data.error,
        );
        if (rawText.length) {
          console.error(
            "[SDS] generate-draft response body (preview):",
            rawText.slice(0, 2000),
          );
        }
        setError(toUserFacingBannerMessage(data.error));
        return;
      }
      if (typeof data.markdown !== "string") {
        console.error(
          "[SDS] generate-draft invalid body (missing markdown)",
          "| preview:",
          rawText.slice(0, 1500),
        );
        setError(
          isTechnicalAiErrorMessage(String(data?.error ?? ""))
            ? null
            : "Something went wrong loading the draft.",
        );
        return;
      }
      applyMarkdownAsBlocks(data.markdown, { slugOverride: effectiveSlug });
      scrollToDocumentFlow();
    } catch (e) {
      console.error("[SDS] generate-draft network error", e);
      setError(
        "We couldn't reach the server. Check your connection and try again.",
      );
    } finally {
      setLoading({ kind: "idle" });
    }
  };

  const githubApiPayload = (): SdsGithubConfig | undefined => {
    const repo = githubConfig.repo.trim();
    const token = githubConfig.token.trim();
    const branch = (githubConfig.branch || "main").trim() || "main";
    if (!parseRepo(repo) || !token) return undefined;
    return { repo, branch, token };
  };

  const getGithubHeaders = useCallback((): Record<string, string> | null => {
    const gh = githubApiPayload();
    if (!gh) return null;
    return {
      "x-sds-github-repo": gh.repo,
      "x-sds-github-branch": gh.branch,
      "x-sds-github-token": gh.token,
    };
  }, [githubConfig]);

  /** Persists GitHub + AI config to localStorage and updates related state. */
  const persistGithubAndAi = (gh: SdsGithubConfig, ai: AiUserConfig): boolean => {
    const rawRepo = gh.repo.trim();
    const parsedRepo = rawRepo ? parseRepo(rawRepo) : null;
    const repo = parsedRepo ? `${parsedRepo.owner}/${parsedRepo.repo}` : rawRepo;
    const branch = (gh.branch || "main").trim() || "main";
    const token = gh.token.trim();
    if (rawRepo && !parsedRepo) {
      setGithubSettingsError(
        'Repository must look like "owner/repo" or a full github.com URL.',
      );
      return false;
    }
    setGithubSettingsError(null);
    setError(null);
    const normalized: SdsGithubConfig = { repo, branch, token };
    try {
      localStorage.setItem(SDS_CONFIG_KEY, JSON.stringify({ ...normalized, ...ai }));
    } catch {
      setGithubSettingsError(
        "Could not save configuration (storage may be full or blocked).",
      );
      return false;
    }
    setGithubConfig(normalized);
    setGithubDraft(normalized);
    setAiConfig(ai);
    if (parseRepo(repo)) {
      setBranchInfo({ repo: repo.trim(), branch });
    }
    return true;
  };

  const saveAppSettings = () => {
    setGithubSettingsError(null);
    if (!persistGithubAndAi(githubDraft, aiDraft)) {
      openSettingsAndFocusRepo();
      return;
    }
    setGithubPopoverOpen(false);
    setToast("Settings saved.");
  };

  const testGithubConnection = async () => {
    setGithubTest({ kind: "loading" });
    try {
      const res = await fetch("/api/github/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: githubDraft.repo.trim(),
          branch: (githubDraft.branch || "main").trim() || "main",
          token: githubDraft.token.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGithubTest({
          kind: "error",
          message: typeof data.error === "string" ? data.error : "Test failed.",
        });
        return;
      }
      const br =
        typeof data.branch === "string"
          ? data.branch
          : (githubDraft.branch || "main").trim() || "main";
      setGithubTest({
        kind: "ok",
        message: `OK — ${String(data.repo ?? githubDraft.repo.trim())} @ ${br}`,
      });
    } catch {
      setGithubTest({ kind: "error", message: "Network error." });
    }
  };

  const testModelConnection = async () => {
    setAiModelTest({ kind: "loading" });
    const preset = getPresetById(aiDraft.activeModelPreset);
    const apiKey = apiKeyForProvider(aiDraft, preset.provider);
    try {
      const res = await fetch("/api/ai/model-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          presetId: aiDraft.activeModelPreset,
          apiKey,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAiModelTest({
          kind: "error",
          message: typeof data.error === "string" ? data.error : "Model test failed.",
        });
        return;
      }
      setAiModelTest({
        kind: "ok",
        message: `Model OK — ${preset.label} (${preset.modelId})`,
      });
    } catch {
      setAiModelTest({ kind: "error", message: "Network error." });
    }
  };

  const syncGithub = async (opts: {
    commitMessage: string;
    verifyBlockId?: string;
    verifyBlockIds?: string[];
    metaBlockId?: string;
    blocksOverride?: SdsBlock[];
    verifiedOnly?: boolean;
    writeAuditSidecar?: boolean;
  }): Promise<{ ok: boolean; fileUrl?: string | null }> => {
    const effective = opts.blocksOverride ?? blocks;
    if (!slug.trim() || isPlaceholderDocumentName(slug)) {
      setError("Enter a document name in the header to save your progress.");
      focusSlugForSync();
      return { ok: false };
    }
    if (effective.length === 0) {
      setError("Parse or generate a document first.");
      return { ok: false };
    }
    const gh = githubApiPayload();
    if (!gh) {
      setGithubSettingsError(
        "Add a GitHub repository and token in Settings before syncing.",
      );
      openSettingsAndFocusRepo();
      return { ok: false };
    }
    setError(null);
    setLoading(
      opts.verifyBlockIds?.length
        ? { kind: "bulk-verify" }
        : opts.verifyBlockId
          ? { kind: "verify", blockId: opts.verifyBlockId }
          : { kind: "save" },
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
          verifyBlockIds:
            opts.verifyBlockIds?.length ? opts.verifyBlockIds : undefined,
          verifiedOnly: opts.verifiedOnly,
          writeAuditSidecar: opts.writeAuditSidecar,
          github: gh,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("[SDS] github/sync failed", {
          status: res.status,
          response: data,
        });
        const msg = toUserFacingBannerMessage(data.error);
        setError(msg ?? "Couldn't sync with GitHub. Try again.");
        return { ok: false };
      }
      const fileUrl =
        typeof data.fileUrl === "string" && data.fileUrl.length > 0
          ? data.fileUrl
          : null;
      if (data.document?.blocks) {
        const synced = data.document.blocks as SdsBlock[];
        setBlocks(synced);
        setLastSavedMarkdown(blocksToMarkdown(synced));
      }
      if (typeof data.commitUrl === "string") {
        const meta = {
          commitUrl: data.commitUrl,
          fileUrl,
        };
        const metaBlockId = opts.metaBlockId;
        if (typeof metaBlockId === "string" && metaBlockId) {
          setCommitMetaByBlockId((prev) => ({
            ...prev,
            [metaBlockId]: meta,
          }));
        }
      }
      if (opts.verifyBlockId) {
        setJustVerifiedId(opts.verifyBlockId);
        setTimeout(() => setJustVerifiedId(null), 1400);
      }
      if (opts.verifyBlockIds?.length) {
        const first = opts.verifyBlockIds[0];
        if (first) {
          setJustVerifiedId(first);
          setTimeout(() => setJustVerifiedId(null), 1400);
        }
      }
      return { ok: true, fileUrl };
    } catch (e) {
      console.error("[SDS] github/sync network error", e);
      setError("Network error while syncing to GitHub.");
      return { ok: false };
    } finally {
      setLoading({ kind: "idle" });
    }
  };

  const loadFromGithub = async (slugParam?: string) => {
    const effectiveSlug = (slugParam ?? slug).trim();
    if (!effectiveSlug) {
      setError("Add a document name before loading from GitHub.");
      focusSlugForSync();
      return;
    }
    if (slugParam !== undefined && slugParam.trim() !== slug.trim()) {
      setSlug(slugParam.trim());
    }
    const gh = githubApiPayload();
    if (!gh) {
      setGithubSettingsError(
        "Add a GitHub repository and token in Settings before loading.",
      );
      openSettingsAndFocusRepo();
      return;
    }
    setLoading({ kind: "load" });
    try {
      const headers: Record<string, string> = {};
      if (gh) {
        headers["x-sds-github-repo"] = gh.repo;
        headers["x-sds-github-branch"] = gh.branch;
        headers["x-sds-github-token"] = gh.token;
      }
      const res = await fetch(
        `/api/github/document?slug=${encodeURIComponent(effectiveSlug)}`,
        { headers },
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) {
        setToast(
          "No file found with that slug in GitHub. Create one from the start screen or paste Markdown.",
        );
        return;
      }
      if (!res.ok) {
        console.error("[SDS] github/document failed", {
          status: res.status,
          response: data,
        });
        setError(
          toUserFacingBannerMessage(data.error) ??
            "Couldn't load that document. Try again.",
        );
        return;
      }
      const doc = data.document;
      if (!doc || typeof doc.markdown !== "string") {
        console.error("[SDS] github/document invalid payload", { data });
        setError("Something went wrong with that file.");
        return;
      }
      const serverBlocks = Array.isArray(doc.blocks)
        ? doc.blocks.filter(isSdsBlockLike)
        : [];
      const loadedSlug =
        typeof doc.slug === "string" && doc.slug.trim()
          ? doc.slug.trim()
          : effectiveSlug;
      applyMarkdownAsBlocks(doc.markdown, {
        slugOverride: loadedSlug,
        serverBlocks: serverBlocks.length > 0 ? serverBlocks : undefined,
      });
      scrollToDocumentFlow();
    } catch (e) {
      console.error("[SDS] loadFromGithub network error", e);
      setError("Network error while loading.");
    } finally {
      setLoading({ kind: "idle" });
    }
  };

  const onLocalFileSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".md") && !lower.endsWith(".txt")) {
      setToast("Please choose a .md or .txt file.");
      return;
    }
    setError(null);
    setLoading({ kind: "file" });
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      const base = file.name.replace(/^.*[/\\]/, "");
      const slugFromFile =
        base.replace(/\.(md|txt)$/i, "").trim() || "document";
      setSlug(slugFromFile);
      applyMarkdownAsBlocks(text, { slugOverride: slugFromFile });
      setLoading({ kind: "idle" });
      scrollToDocumentFlow();
    };
    reader.onerror = () => {
      setError("Could not read that file.");
      setLoading({ kind: "idle" });
    };
    reader.readAsText(file);
  };

  const runSurgicalEdit = async (id: string) => {
    const block = blocks.find((b) => b.id === id);
    if (!block) return;
    const instruction = (instrById[id] ?? "").trim();
    if (!instruction) {
      setError("Add an instruction before running surgical edit.");
      instructionRef.current?.focus();
      return;
    }
    setError(null);
    setEditBusyId(id);
    try {
      const res = await fetch("/api/surgical-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          block: block.text,
          instruction,
          ai: buildAiInlinePayload(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error("[SDS] surgical-edit failed", {
          status: res.status,
          response: data,
        });
        setError(toUserFacingBannerMessage(data.error));
        return;
      }
      if (typeof data.result !== "string") {
        console.error("[SDS] surgical-edit invalid body", { data });
        setError("Something went wrong with that edit. Try again.");
        return;
      }
      setPending((p) => ({
        ...p,
        [id]: { oldText: block.text, newText: data.result },
      }));
      const scrollCommandBodyToDiff = () => {
        const body = commandBodyScrollRef.current;
        if (!body) return;
        body.scrollTo({ top: body.scrollHeight, behavior: "smooth" });
      };
      requestAnimationFrame(() => {
        requestAnimationFrame(scrollCommandBodyToDiff);
      });
    } catch (e) {
      console.error("[SDS] surgical-edit network error", e);
      setError("Network error during surgical edit.");
    } finally {
      setEditBusyId(null);
    }
  };

  const discardSurgicalEdit = (id: string) => {
    setPending((p) => {
      if (!p[id]) return p;
      const next = { ...p };
      delete next[id];
      return next;
    });
  };

  const acceptEdit = async (id: string) => {
    const pair = pending[id];
    if (!pair) return;
    const nextBlocks = blocks.map((b) =>
      b.id === id ? { ...b, text: pair.newText, verified: true } : b,
    );
    setBlocks(nextBlocks);

    const result = await syncGithub({
      commitMessage: `SDS: accept surgical edit + verify block ${id.slice(0, 8)}`,
      blocksOverride: nextBlocks,
      metaBlockId: id,
      verifyBlockId: id,
    });
    if (result.ok) {
      setPending((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
    }
  };

  const handleSourceTextChange = (text: string) => {
    if (!selectedBlockId) return;
    setBlocks((prev) =>
      prev.map((b) => (b.id === selectedBlockId ? { ...b, text } : b)),
    );
    setPending((prev) => {
      if (!prev[selectedBlockId]) return prev;
      const next = { ...prev };
      delete next[selectedBlockId];
      return next;
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

  const toggleBulkBlock = (id: string) => {
    setBulkSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const bulkVerifyAndSync = async () => {
    if (bulkSelectedIds.length === 0) return;
    const n = bulkSelectedIds.length;
    if (
      !window.confirm(
        `Verify ${n} block(s) on GitHub? This will mark them as human-reviewed and push to your repo.`,
      )
    ) {
      return;
    }
    const idSet = new Set(bulkSelectedIds);
    const nextBlocks = blocks.map((b) =>
      idSet.has(b.id) ? { ...b, verified: true } : b,
    );
    const result = await syncGithub({
      commitMessage: `SDS: bulk verify ${n} block(s)`,
      blocksOverride: nextBlocks,
      verifyBlockIds: [...bulkSelectedIds],
      writeAuditSidecar: true,
    });
    if (result.ok) {
      setBulkSelectedIds([]);
      setToast(`Verified ${n} block(s) on GitHub.`);
    }
  };

  const copyMarkdownToClipboard = async () => {
    const markdown = blocksToMarkdown(exportBlocks);
    if (!markdown.trim()) {
      setError("Nothing to copy.");
      return;
    }
    await navigator.clipboard.writeText(markdown);
    setToast("Markdown copied to clipboard.");
    setExportMenuOpen(false);
  };

  const downloadMarkdown = () => {
    const markdown = blocksToMarkdown(exportBlocks);
    if (!markdown.trim()) {
      setError("Nothing to download.");
      return;
    }
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug.trim() || "document"}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setToast("Markdown download started.");
    setExportMenuOpen(false);
  };

  useEffect(() => {
    if (!selectedBlockId) return;
    const node = blockRefs.current[selectedBlockId];
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedBlockId]);

  useEffect(() => {
    if (!selectedBlockId) return;
    commandScrollRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const t = window.setTimeout(() => sourceTextRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [selectedBlockId]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    const el = selectAllCheckboxRef.current;
    if (!el) return;
    if (blocks.length === 0) {
      el.indeterminate = false;
      return;
    }
    el.indeterminate =
      bulkSelectedIds.length > 0 && bulkSelectedIds.length < blocks.length;
  }, [blocks, bulkSelectedIds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (blocks.length === 0) return;
    const md = blocksToMarkdown(blocks);
    const slugForStore = slug.trim() || "_draft";
    const t = window.setTimeout(() => {
      persistVerificationToLocalStorage(slugForStore, md, blocks);
    }, 400);
    return () => clearTimeout(t);
  }, [blocks, slug]);

  useLayoutEffect(() => {
    if (!selectedBlockId) return;
    const src = sourceTextRef.current;
    const instr = instructionRef.current;
    const parent = commandBodyScrollRef.current;
    const nodes = [src, instr].filter(
      (n): n is HTMLTextAreaElement => n != null,
    );
    const onWheel = (e: WheelEvent) =>
      wheelForwardToScrollParent(e, parent);
    for (const el of nodes) {
      el.addEventListener("wheel", onWheel, { passive: false });
    }
    return () => {
      for (const el of nodes) {
        el.removeEventListener("wheel", onWheel);
      }
    };
  }, [selectedBlockId]);

  return (
    <div className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)] bg-zinc-100 text-zinc-900 lg:h-dvh lg:max-h-dvh lg:overflow-hidden">
      <header className="sticky top-0 z-20 shrink-0 border-b border-zinc-200 bg-white/90 backdrop-blur lg:static">
        <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {inEditor ? (
              <button
                type="button"
                title="Back to start"
                onClick={resetToLanding}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 sm:px-2.5"
              >
                <ArrowLeft className="h-4 w-4 text-zinc-600" aria-hidden />
                <span className="hidden sm:inline">Back</span>
              </button>
            ) : null}
            <div className="rounded-lg bg-zinc-900 p-2 text-white">
              <Scissors className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold tracking-tight">Surgical Doc Studio</h1>
              <p className="text-xs text-zinc-500">Context-safe block editing for PRDs</p>
            </div>
          </div>
          <div
            ref={githubHeaderRef}
            className={`relative flex min-w-0 flex-1 flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-2 ${
              !inEditor
                ? "justify-end"
                : "sm:justify-center lg:max-w-[min(100%,52rem)]"
            }`}
          >
            {inEditor ? (
              <>
                <div
                  ref={documentTitleAnchorRef}
                  className="flex min-w-0 flex-wrap items-center justify-center gap-x-1.5 gap-y-1 rounded-lg border border-zinc-200/90 bg-zinc-50/90 px-2 py-1.5 text-[11px] text-zinc-700 sm:text-xs"
                >
                  {githubConnected ? (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]"
                      title="GitHub connected"
                      aria-hidden
                    />
                  ) : null}
                  <span className="max-w-[7rem] truncate font-medium text-zinc-800 sm:max-w-[10rem]">
                    {headerRepoDisplay}
                  </span>
                  <span className="text-zinc-300" aria-hidden>
                    /
                  </span>
                  <span className="max-w-[5rem] truncate font-medium text-zinc-800 sm:max-w-[8rem]">
                    {headerBranchDisplay}
                  </span>
                  <span className="text-zinc-300" aria-hidden>
                    /
                  </span>
                  <span className="inline-flex min-w-0 max-w-[min(100%,14rem)] items-center gap-1">
                    <FileText
                      className="h-3.5 w-3.5 shrink-0 text-zinc-500"
                      aria-hidden
                    />
                    {headerTitleEditing ? (
                      <input
                        id="slug-input"
                        ref={slugInputRef}
                        type="text"
                        value={slug}
                        onChange={(e) => setSlug(e.target.value)}
                        onBlur={() => setHeaderTitleEditing(false)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (!busy) void loadFromGithub();
                            return;
                          }
                          if (e.key === "Escape") {
                            setHeaderTitleEditing(false);
                          }
                        }}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        name="sds-document-filename"
                        aria-label="Document filename"
                        placeholder="Untitled"
                        className={`min-w-[120px] max-w-[14rem] flex-1 rounded border bg-white px-1.5 py-0.5 font-mono text-xs text-zinc-900 outline-none placeholder:text-zinc-400 placeholder:italic focus:border-indigo-400 focus:ring-1 focus:ring-indigo-300 sm:text-sm ${
                          slugWiggle
                            ? "border-red-400 ring-2 ring-red-400/80 animate-slug-wiggle"
                            : "border-zinc-300"
                        }`}
                      />
                    ) : (
                      <div
                        ref={fileSwitcherRef}
                        className="relative inline-flex max-w-full min-w-0 items-center"
                      >
                        <button
                          type="button"
                          aria-expanded={fileSwitcherOpen}
                          aria-haspopup="menu"
                          title="Document name, rename, or switch project"
                          onClick={() => setFileSwitcherOpen((v) => !v)}
                          className={`inline-flex max-w-full min-w-0 items-center gap-0.5 truncate rounded border px-1.5 py-0.5 text-left font-mono text-xs transition hover:border-zinc-400 hover:bg-white sm:text-sm ${
                            slugWiggle
                              ? "border-red-400 ring-2 ring-red-400/80 animate-slug-wiggle"
                              : "border-zinc-200/90"
                          } ${
                            isPlaceholderDocumentName(slug)
                              ? "italic text-zinc-400"
                              : "text-zinc-900"
                          }`}
                        >
                          <span className="min-w-0 truncate">
                            {isPlaceholderDocumentName(slug)
                              ? "Untitled"
                              : slug.trim()}
                          </span>
                          <ChevronDown
                            className="h-3.5 w-3.5 shrink-0 text-zinc-400"
                            aria-hidden
                          />
                        </button>
                        <FileSwitcherMenu
                          open={fileSwitcherOpen}
                          onClose={() => setFileSwitcherOpen(false)}
                          onRename={() => {
                            setHeaderTitleEditing(true);
                            setFileSwitcherOpen(false);
                          }}
                          onOpenNewFile={resetToLanding}
                          onSelectRepoSlug={(s) => {
                            void loadFromGithub(s);
                          }}
                          getGithubHeaders={getGithubHeaders}
                          currentSlug={slug}
                        />
                      </div>
                    )}
                  </span>
                </div>
              </>
            ) : null}
            <button
              type="button"
              title="Settings (GitHub & models)"
              onClick={() => setGithubPopoverOpen((v) => !v)}
              className="inline-flex shrink-0 items-center justify-center gap-2 self-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-700 transition hover:bg-slate-100"
            >
              <Settings2 className="h-3.5 w-3.5 text-zinc-500" aria-hidden />
              <span className="hidden sm:inline">Settings</span>
            </button>
            {githubPopoverOpen ? (
              <div
                className="absolute left-1/2 top-full z-40 mt-2 w-[min(100vw-2rem,28rem)] max-h-[min(85vh,640px)] -translate-x-1/2 overflow-y-auto overscroll-contain rounded-xl border border-zinc-200 bg-white shadow-xl"
                role="dialog"
                aria-label="App settings"
              >
                <div className="space-y-4 p-4">
                  <ModelSettingsForm
                    draft={aiDraft}
                    onDraftChange={(next) => {
                      setAiDraft(next);
                      setAiModelTest({ kind: "idle" });
                    }}
                  />
                  <div className="border-t border-zinc-200 pt-4">
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      GitHub
                    </h3>
                    <GithubConfigPopoverForm
                      draft={githubDraft}
                      onDraftChange={(next) => {
                        setGithubDraft(next);
                        setGithubTest({ kind: "idle" });
                        setGithubSettingsError(null);
                      }}
                      onSave={saveAppSettings}
                      onTest={() => void testGithubConnection()}
                      testState={githubTest}
                      saveDisabled={busy}
                      showActions={false}
                      inlineError={githubSettingsError}
                      repoInputRef={githubRepoInputRef}
                    />
                  </div>
                  {githubTest.kind === "ok" ? (
                    <p className="text-xs text-emerald-700">{githubTest.message}</p>
                  ) : null}
                  {githubTest.kind === "error" ? (
                    <p className="text-xs text-red-700">{githubTest.message}</p>
                  ) : null}
                  {aiModelTest.kind === "ok" ? (
                    <p className="text-xs text-emerald-700">{aiModelTest.message}</p>
                  ) : null}
                  {aiModelTest.kind === "error" ? (
                    <p className="text-xs text-red-700">{aiModelTest.message}</p>
                  ) : null}
                  <div className="flex flex-col gap-2 border-t border-zinc-100 pt-3 sm:flex-row sm:flex-wrap">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={saveAppSettings}
                      className="inline-flex flex-1 items-center justify-center rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      Save configuration
                    </button>
                    <button
                      type="button"
                      disabled={
                        githubTest.kind === "loading" ||
                        !parseRepo(githubDraft.repo) ||
                        !githubDraft.token.trim()
                      }
                      onClick={() => void testGithubConnection()}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                    >
                      {githubTest.kind === "loading" ? (
                        <LoadingSpinner className="h-4 w-4 text-zinc-700" />
                      ) : null}
                      Test GitHub
                    </button>
                    <button
                      type="button"
                      disabled={
                        aiModelTest.kind === "loading" ||
                        !apiKeyForProvider(
                          aiDraft,
                          getPresetById(aiDraft.activeModelPreset).provider,
                        )
                      }
                      onClick={() => void testModelConnection()}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                    >
                      {aiModelTest.kind === "loading" ? (
                        <LoadingSpinner className="h-4 w-4 text-zinc-700" />
                      ) : null}
                      Check model connection
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          {inEditor ? (
            <div className="relative flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setExportMenuOpen((v) => !v)}
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
              >
                {loading.kind === "save" ? (
                  <LoadingSpinner className="h-4 w-4 text-white" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Finalize & Export
                <ChevronDown className="h-4 w-4" />
              </button>
              {exportMenuOpen ? (
                <div className="absolute right-0 top-11 z-30 w-72 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg">
                  <label className="mb-2 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
                    <input
                      type="checkbox"
                      checked={exportVerifiedOnly}
                      onChange={(e) => setExportVerifiedOnly(e.target.checked)}
                    />
                    Export verified blocks only
                  </label>
                  <button
                    type="button"
                    onClick={() => void copyMarkdownToClipboard()}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-50"
                  >
                    <ClipboardCopy className="h-4 w-4 text-zinc-600" />
                    Copy to Clipboard
                  </button>
                  <button
                    type="button"
                    onClick={downloadMarkdown}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-50"
                  >
                    <Download className="h-4 w-4 text-zinc-600" />
                    Download as Markdown
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col gap-4 overflow-x-hidden px-4 pb-4 pt-4 transition-opacity duration-300 lg:overflow-hidden lg:pt-6">
        {errorBannerMessage ? (
          <div
            className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            {errorBannerMessage}
          </div>
        ) : null}

        {!sessionRestored ? (
          <div className="flex min-h-[40vh] flex-1 flex-col items-center justify-center gap-3 py-16 text-zinc-500">
            <LoadingSpinner className="h-8 w-8 text-zinc-400" />
            <p className="text-sm">Loading…</p>
          </div>
        ) : blocks.length === 0 ? (
          <LandingPage
            genTopic={genTopic}
            onGenTopicChange={setGenTopic}
            onGenerate={() => void generateDraft()}
            slug={slug}
            onSlugChange={setSlug}
            onLoadGithub={() => void loadFromGithub()}
            paste={paste}
            onPasteChange={setPaste}
            onParse={() => void parseFromPaste()}
            onOpenSettings={() => setGithubPopoverOpen(true)}
            busy={busy}
            flowBusy={flowBusy}
            githubConnected={githubConnected}
            fileInputRef={fileInputRef}
            onFileSelected={onLocalFileSelected}
          />
        ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden lg:flex-row lg:gap-6">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-[3]">
          <div
            ref={documentFlowSectionRef}
            className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
          >
            <div className="flex shrink-0 items-center gap-3 border-b border-zinc-100 px-4 py-3">
              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  ref={selectAllCheckboxRef}
                  type="checkbox"
                  disabled={blocks.length === 0}
                  checked={
                    blocks.length > 0 &&
                    bulkSelectedIds.length === blocks.length
                  }
                  onChange={(e) => {
                    if (e.target.checked) {
                      setBulkSelectedIds(blocks.map((b) => b.id));
                    } else {
                      setBulkSelectedIds([]);
                    }
                  }}
                  className="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-sm font-medium text-zinc-700">
                  Document Flow ({blocks.length} blocks)
                </span>
              </label>
            </div>
            <div
              ref={documentFlowScrollRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2"
            >
                <ul className="space-y-1">
                  {blocks.map((b, idx) => {
                    const selected = b.id === selectedBlockId;
                    const bulkOn = bulkSelectedIds.includes(b.id);
                    return (
                      <li
                        key={b.id}
                        ref={(el) => {
                          blockRefs.current[b.id] = el;
                        }}
                        className={`group relative rounded-md border px-3 py-2 transition ${
                          selected
                            ? "border border-zinc-200 border-l-2 border-l-indigo-500 bg-indigo-50/30 shadow-md"
                            : bulkOn
                              ? b.verified
                                ? "border-emerald-200 bg-emerald-50/50 ring-1 ring-blue-200/70"
                                : "border-blue-200/80 bg-blue-50/50 ring-1 ring-blue-200/50"
                              : b.verified
                                ? "border-emerald-200 bg-emerald-50/40"
                                : "border-transparent hover:border-zinc-200 hover:border-dashed hover:bg-zinc-50"
                        } ${justVerifiedId === b.id ? "animate-pulse" : ""}`}
                        onClick={() => setSelectedBlockId(b.id)}
                      >
                        <div className="mb-1 flex items-center gap-2 text-[11px] text-zinc-500">
                          <input
                            type="checkbox"
                            checked={bulkOn}
                            onChange={() => toggleBulkBlock(b.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-3.5 w-3.5 shrink-0 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
                            aria-label={`Select block ${idx + 1}`}
                          />
                          <span className="font-medium">#{idx + 1}</span>
                          <span className="uppercase tracking-wide">{b.kind}</span>
                          {b.verified ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" />
                              Verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">
                              <CircleDashed className="h-3 w-3" />
                              Draft
                            </span>
                          )}
                        </div>
                        <p className="whitespace-pre-wrap text-sm leading-7 text-zinc-800">
                          {b.text}
                        </p>
                        {b.verified && (b.verifiedBy || b.verifiedAt) ? (
                          <div className="mt-1 text-right text-[11px] text-zinc-500">
                            {b.verifiedBy ? `@${b.verifiedBy}` : ""}
                            {b.verifiedAt ? ` · ${b.verifiedAt.slice(0, 19)}Z` : ""}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          aria-label={`Open block ${idx + 1} in command center`}
                          title="Edit in command center"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedBlockId(b.id);
                          }}
                          className="absolute right-2 top-2 hidden rounded bg-white/90 p-1.5 text-zinc-700 shadow-sm ring-1 ring-zinc-200 group-hover:inline-flex"
                        >
                          <FlaskConical className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
            </div>
          </div>
          </div>

        <aside
          ref={tutorialAsideRef}
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:flex-[2] lg:basis-0"
        >
          <div
            ref={commandScrollRef}
            className={`flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-white shadow-sm ${
              selectedBlock
                ? "border-indigo-200 ring-1 ring-indigo-100"
                : "border-zinc-200"
            }`}
          >
            <div
              className={`shrink-0 rounded-t-xl border-b px-4 py-3 ${
                selectedBlock ? "border-indigo-100 bg-indigo-50/60" : "border-zinc-100"
              }`}
            >
              <h2 className="text-sm font-semibold text-zinc-800">Surgical Command Center</h2>
              {selectedBlock ? (
                <p className="mt-1 text-xs text-zinc-500">
                  Block #{selectedIndex + 1} · {selectedBlock.kind.toUpperCase()}
                </p>
              ) : (
                <p className="mt-1 text-xs text-zinc-500">Select a block from the document flow.</p>
              )}
            </div>
            {selectedBlock ? (
              <>
                <div
                  ref={commandBodyScrollRef}
                  className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
                >
                  <div className="space-y-2">
                    <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      Current source text
                    </label>
                    <textarea
                      ref={sourceTextRef}
                      value={selectedBlock.text}
                      onChange={(e) => handleSourceTextChange(e.target.value)}
                      rows={5}
                      className="w-full resize-y rounded-lg border border-zinc-300 p-3 text-sm leading-relaxed text-zinc-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500"
                      spellCheck
                    />
                  </div>

                  <div className="rounded-lg border border-slate-200/90 bg-slate-50/50 p-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
                      AI toolkit
                    </p>
                    <div className="space-y-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-zinc-600">
                          Model instruction (only this block + instruction are sent)
                        </label>
                        <textarea
                          ref={instructionRef}
                          value={instrById[selectedBlock.id] ?? ""}
                          onChange={(e) =>
                            setInstrById((s) => ({ ...s, [selectedBlock.id]: e.target.value }))
                          }
                          rows={4}
                          className="w-full rounded-lg border border-zinc-300 bg-white p-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-300"
                          placeholder='e.g. "Update this section to reflect the /v2/events API endpoint."'
                        />
                      </div>
                      <button
                        type="button"
                        disabled={busy || editBusyId === selectedBlock.id}
                        onClick={() => void runSurgicalEdit(selectedBlock.id)}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {editBusyId === selectedBlock.id ? (
                          <LoadingSpinner className="h-4 w-4 text-white" />
                        ) : (
                          <Sparkles className="h-4 w-4" />
                        )}
                        Surgical edit
                      </button>
                    </div>
                  </div>

                  {selectedPending ? (
                    <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                          Diff
                        </p>
                        <button
                          type="button"
                          disabled={busy}
                          aria-label="Undo surgical edit — discard AI suggestion"
                          title="Discard AI suggestion (keep current text), then you can mark reviewed & sync"
                          onClick={() => discardSurgicalEdit(selectedBlock.id)}
                          className="rounded-md p-1.5 text-zinc-500 outline-none hover:bg-zinc-200/90 hover:text-zinc-800 disabled:opacity-50"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      </div>
                      <PrDiff before={selectedPending.oldText} after={selectedPending.newText} />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void acceptEdit(selectedBlock.id)}
                          className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-black disabled:opacity-50"
                        >
                          {busy &&
                          (loading.kind === "save" ||
                            (loading.kind === "verify" &&
                              loading.blockId === selectedBlock.id)) ? (
                            <LoadingSpinner className="h-4 w-4 text-white" />
                          ) : null}
                          Accept & commit
                        </button>
                        {selectedCommitMeta ? (
                          <>
                            <a
                              href={selectedCommitMeta.commitUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
                            >
                              <GitCommitHorizontal className="h-4 w-4" />
                              Open commit
                            </a>
                            {selectedCommitMeta.fileUrl ? (
                              <a
                                href={selectedCommitMeta.fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
                              >
                                <GitBranch className="h-4 w-4" />
                                View file
                              </a>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="shrink-0 border-t border-zinc-200 bg-zinc-50/95 p-4 backdrop-blur-sm">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Review & GitHub
                  </p>
                  <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
                    Mark this block reviewed (or remove review) and sync the document to your repo.
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    title={
                      selectedBlock.verified
                        ? "Clear the reviewed flag for this block and push the document to GitHub."
                        : "Mark this block as human-reviewed and push the document to GitHub."
                    }
                    onClick={() => void toggleVerify(selectedBlock.id)}
                    className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50 ${
                      selectedBlock.verified
                        ? `border border-zinc-300 bg-white text-zinc-800 shadow-sm hover:bg-zinc-50 ${
                            hasUnsavedChanges
                              ? "animate-pulse ring-2 ring-amber-400/70"
                              : ""
                          }`
                        : `bg-emerald-600 text-white hover:bg-emerald-700 ${
                            hasUnsavedChanges
                              ? "animate-pulse ring-2 ring-emerald-300/80"
                              : ""
                          }`
                    }`}
                  >
                    {loading.kind === "verify" && loading.blockId === selectedBlock.id ? (
                      <LoadingSpinner
                        className={`h-4 w-4 ${
                          selectedBlock.verified ? "text-zinc-700" : "text-white"
                        }`}
                      />
                    ) : selectedBlock.verified ? (
                      <Undo2 className="h-4 w-4" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    {selectedBlock.verified
                      ? "Remove review & sync"
                      : "Mark reviewed & sync"}
                  </button>
                </div>
              </>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-8 text-center text-sm text-zinc-500">
                Select a block to start surgical operations.
              </div>
            )}
          </div>
        </aside>
        </div>
        )}
      </main>
      <EditorTutorial
        open={inEditor && editorTutorialOpen}
        steps={editorTutorialSteps}
        stepIndex={editorTutorialStep}
        onStepIndexChange={setEditorTutorialStep}
        onSkip={() => dismissEditorTutorial(true)}
        onComplete={() => dismissEditorTutorial(true)}
      />
      {bulkSelectedIds.length > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-6 pt-2">
          <div
            className="pointer-events-auto flex w-full max-w-xl animate-in fade-in slide-in-from-bottom-4 flex-col items-stretch gap-3 rounded-2xl border border-slate-700/80 bg-slate-900 px-4 py-3 text-white shadow-2xl duration-200 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:rounded-full sm:px-6"
            role="toolbar"
            aria-label="Bulk actions"
          >
            <span className="text-center text-sm text-slate-200 sm:text-left">
              {bulkSelectedIds.length} block
              {bulkSelectedIds.length === 1 ? "" : "s"} selected
            </span>
            <div className="flex items-center justify-center gap-3 sm:justify-end">
              <button
                type="button"
                className="text-sm text-slate-400 underline-offset-2 hover:text-white hover:underline"
                onClick={() => setBulkSelectedIds([])}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void bulkVerifyAndSync()}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-emerald-500 disabled:opacity-50"
              >
                {loading.kind === "bulk-verify" ? (
                  <LoadingSpinner className="h-4 w-4 text-white" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Verify {bulkSelectedIds.length} selected
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {toast ? (
        <div className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white shadow-lg">
          <Check className="h-4 w-4 text-emerald-300" />
          {toast}
        </div>
      ) : null}
    </div>
  );
}
