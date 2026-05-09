// @ts-nocheck
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { delimiter } from 'node:path';
import path from 'node:path';
import { homedir } from 'node:os';
import { wellKnownUserToolchainBins } from '@open-design/platform';
import { expandHomePath } from './paths.js';

const AGENT_BIN_ENV_KEYS = new Map([
  ['claude', 'CLAUDE_BIN'],
  ['codex', 'CODEX_BIN'],
  ['copilot', 'COPILOT_BIN'],
  ['cursor-agent', 'CURSOR_AGENT_BIN'],
  ['deepseek', 'DEEPSEEK_BIN'],
  ['devin', 'DEVIN_BIN'],
  ['gemini', 'GEMINI_BIN'],
  ['hermes', 'HERMES_BIN'],
  ['kimi', 'KIMI_BIN'],
  ['kiro', 'KIRO_BIN'],
  ['kilo', 'KILO_BIN'],
  ['opencode', 'OPENCODE_BIN'],
  ['pi', 'PI_BIN'],
  ['qoder', 'QODER_BIN'],
  ['qwen', 'QWEN_BIN'],
  ['vibe', 'VIBE_BIN'],
]);

const TOOLCHAIN_DIR_CACHE_TTL_MS = 5000;
let cachedToolchainHome = null;
let cachedToolchainDirs = null;
let cachedToolchainDirsAt = 0;

function userToolchainDirs() {
  const homeOverride = process.env.OD_AGENT_HOME;
  const home = homeOverride || homedir();
  const now = Date.now();
  if (
    cachedToolchainHome === home &&
    cachedToolchainDirs &&
    now - cachedToolchainDirsAt < TOOLCHAIN_DIR_CACHE_TTL_MS
  ) {
    return cachedToolchainDirs;
  }
  cachedToolchainHome = home;
  cachedToolchainDirsAt = now;
  // When OD_AGENT_HOME is set, scope the search strictly to the override
  // home: skip Homebrew / /usr/local *and* pass an empty env so that a
  // developer or CI runner with NPM_CONFIG_PREFIX / npm_config_prefix
  // exported can't leak the real machine's <prefix>/bin into a sandboxed
  // detection run. Without this the agents.test.ts cases that build a
  // tmp home would be machine-environment-dependent.
  cachedToolchainDirs = wellKnownUserToolchainBins({
    home,
    includeSystemBins: process.platform !== 'win32' && !homeOverride,
    env: homeOverride ? {} : process.env,
  });
  return cachedToolchainDirs;
}

function resolvePathDirs() {
  const seen = new Set();
  const dirs = [
    ...(process.env.PATH || '').split(delimiter),
    // GUI launchers (macOS .app bundles, Linux .desktop files) often start
    // with a minimal PATH. Include common user-level CLI install locations
    // so agent detection matches the user's shell-installed tools,
    // especially Node version managers.
    ...userToolchainDirs(),
  ];
  return dirs.filter((dir) => {
    if (!dir || seen.has(dir)) return false;
    seen.add(dir);
    return true;
  });
}

export function resolveOnPath(bin) {
  const exts =
    process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')
      : [''];
  const dirs = resolvePathDirs();
  for (const dir of dirs) {
    for (const ext of exts) {
      const full = path.join(dir, bin + ext);
      if (full && existsSync(full)) return full;
    }
  }
  return null;
}

function looksExecutableOnWindows(filePath) {
  const ext = path.extname(filePath).trim().toUpperCase();
  if (!ext) return false;
  const executableExts = (process.env.PATHEXT || '.EXE;.CMD;.BAT')
    .split(';')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  return executableExts.includes(ext);
}

// Resolve the first available binary for an agent definition. Tries
// `def.bin` first, then walks `def.fallbackBins` in order. Used for
// agents whose forks ship under a different binary name but speak the
// exact same CLI (Claude Code → OpenClaude, issue #235). Returns null
// when no candidate is on PATH.
function configuredExecutableOverride(def, configuredEnv = {}) {
  const envKey = AGENT_BIN_ENV_KEYS.get(def?.id);
  if (!envKey) return null;
  const raw = configuredEnv?.[envKey];
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const expanded = expandHomePath(raw.trim());
  if (!path.isAbsolute(expanded)) return null;
  try {
    if (!statSync(expanded).isFile()) return null;
    if (process.platform === 'win32') {
      if (!looksExecutableOnWindows(expanded)) return null;
    } else {
      accessSync(expanded, constants.X_OK);
    }
    return expanded;
  } catch {
    return null;
  }
}

export function resolveAgentExecutable(def, configuredEnv = {}) {
  if (!def?.bin) return null;
  const configured = configuredExecutableOverride(def, configuredEnv);
  if (configured) return configured;
  const candidates = [
    def.bin,
    ...(Array.isArray(def.fallbackBins) ? def.fallbackBins : []),
  ];
  for (const bin of candidates) {
    const resolved = resolveOnPath(bin);
    if (resolved) return resolved;
  }
  return null;
}
