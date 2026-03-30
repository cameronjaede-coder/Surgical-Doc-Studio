"use client";

import { diffLines } from "diff";

export function PrDiff({ before, after }: { before: string; after: string }) {
  const parts = diffLines(before, after);

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-950 font-mono text-xs leading-relaxed text-zinc-100">
      <div className="max-h-72 overflow-y-auto p-3">
        {parts.map((part, i) => {
          if (part.added) {
            return (
              <span
                key={i}
                className="block whitespace-pre-wrap border-l-2 border-emerald-500 bg-emerald-950/80 pl-2 text-emerald-100"
              >
                +{part.value}
              </span>
            );
          }
          if (part.removed) {
            return (
              <span
                key={i}
                className="block whitespace-pre-wrap border-l-2 border-red-500 bg-red-950/80 pl-2 text-red-100"
              >
                −{part.value}
              </span>
            );
          }
          return (
            <span key={i} className="block whitespace-pre-wrap pl-2 opacity-80">
              {part.value}
            </span>
          );
        })}
      </div>
    </div>
  );
}
