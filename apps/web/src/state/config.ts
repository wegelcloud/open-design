import type { AppConfig, MediaProviderCredentials } from '../types';

const STORAGE_KEY = 'open-design:config';

export const DEFAULT_CONFIG: AppConfig = {
  mode: 'daemon',
  apiKey: '',
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-5',
  agentId: null,
  skillId: null,
  designSystemId: null,
  onboardingCompleted: false,
  mediaProviders: {},
  composio: {},
  agentModels: {},
};

/** Well-known providers with pre-filled base URLs. */
export const KNOWN_PROVIDERS: Array<{ label: string; baseUrl: string; model: string }> = [
  { label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-5' },
  { label: 'MiMo (Xiaomi) — OpenAI', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', model: 'mimo-v2.5-pro' },
  { label: 'MiMo (Xiaomi) — Anthropic', baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic', model: 'mimo-v2.5-pro' },
];

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      mediaProviders: { ...(parsed.mediaProviders ?? {}) },
      composio: { ...(parsed.composio ?? {}) },
      agentModels: { ...(parsed.agentModels ?? {}) },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

interface PublicComposioConfigResponse {
  configured?: boolean;
  apiKeyTail?: string;
}

export async function fetchComposioConfigFromDaemon(): Promise<AppConfig['composio'] | null> {
  try {
    const response = await fetch('/api/connectors/composio/config');
    if (!response.ok) return null;
    const payload = await response.json() as PublicComposioConfigResponse;
    return {
      apiKey: '',
      apiKeyConfigured: Boolean(payload.configured),
      apiKeyTail: payload.apiKeyTail ?? '',
    };
  } catch {
    return null;
  }
}

export async function syncComposioConfigToDaemon(
  config: AppConfig['composio'] | undefined,
): Promise<void> {
  const apiKey = config?.apiKey ?? '';
  const payload = {
    ...(apiKey.trim() || !config?.apiKeyConfigured ? { apiKey } : {}),
  };
  try {
    await fetch('/api/connectors/composio/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Daemon offline; localStorage keeps the user's copy for the next save.
  }
}

export function saveConfig(config: AppConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function hasAnyConfiguredProvider(
  providers: Record<string, MediaProviderCredentials> | undefined,
): boolean {
  if (!providers) return false;
  return Object.values(providers).some((entry) =>
    Boolean(entry?.apiKey?.trim() || entry?.baseUrl?.trim()),
  );
}

export async function syncMediaProvidersToDaemon(
  providers: Record<string, MediaProviderCredentials> | undefined,
  options?: { force?: boolean },
): Promise<void> {
  if (!providers) return;
  try {
    await fetch('/api/media/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providers, force: Boolean(options?.force) }),
    });
  } catch {
    // Daemon offline; localStorage keeps the user's copy for the next save.
  }
}
