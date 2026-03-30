export type BlockKind = "header" | "paragraph" | "list";

export type SdsBlock = {
  id: string;
  kind: BlockKind;
  text: string;
  verified: boolean;
  verifiedAt?: string;
  verifiedBy?: string;
};

export type SdsDocument = {
  version: 1;
  slug: string;
  updatedAt: string;
  branch: string;
  blocks: SdsBlock[];
  markdown: string;
};
