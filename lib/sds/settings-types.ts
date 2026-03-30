export type SdsGithubConfig = {
  repo: string;
  branch: string;
  token: string;
};

export type AiUserConfig = {
  activeModelPreset: string;
  anthropicApiKey: string;
  googleApiKey: string;
  openaiApiKey: string;
};

export const DEFAULT_AI_CONFIG: AiUserConfig = {
  activeModelPreset: "claude-3-5-sonnet",
  anthropicApiKey: "",
  googleApiKey: "",
  openaiApiKey: "",
};

/** Full blob stored in localStorage as SDS_CONFIG */
export type SdsStoredConfig = SdsGithubConfig & AiUserConfig;

export function aiConfigFromUnknown(j: Record<string, unknown>): AiUserConfig {
  const preset =
    typeof j.activeModelPreset === "string" && j.activeModelPreset.trim()
      ? j.activeModelPreset
      : DEFAULT_AI_CONFIG.activeModelPreset;
  return {
    activeModelPreset: preset,
    anthropicApiKey:
      typeof j.anthropicApiKey === "string" ? j.anthropicApiKey : "",
    googleApiKey: typeof j.googleApiKey === "string" ? j.googleApiKey : "",
    openaiApiKey: typeof j.openaiApiKey === "string" ? j.openaiApiKey : "",
  };
}
