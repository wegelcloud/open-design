// @ts-nocheck
import { claudeAgentDef } from './defs/claude.js';
import { codexAgentDef } from './defs/codex.js';
import { devinAgentDef } from './defs/devin.js';
import { geminiAgentDef } from './defs/gemini.js';
import { opencodeAgentDef } from './defs/opencode.js';
import { hermesAgentDef } from './defs/hermes.js';
import { kimiAgentDef } from './defs/kimi.js';
import { cursorAgentDef } from './defs/cursor-agent.js';
import { qwenAgentDef } from './defs/qwen.js';
import { qoderAgentDef } from './defs/qoder.js';
import { copilotAgentDef } from './defs/copilot.js';
import { piAgentDef } from './defs/pi.js';
import { kiroAgentDef } from './defs/kiro.js';
import { kiloAgentDef } from './defs/kilo.js';
import { vibeAgentDef } from './defs/vibe.js';
import { deepseekAgentDef } from './defs/deepseek.js';

type AgentDef = {
  id: string;
  name: string;
  bin: string;
  versionArgs: string[];
  fallbackModels: Array<{ id: string; label: string }>;
  buildArgs: (...args: any[]) => string[];
  streamFormat: string;
  [key: string]: any;
};

export const AGENT_DEFS: AgentDef[] = [
  claudeAgentDef,
  codexAgentDef,
  devinAgentDef,
  geminiAgentDef,
  opencodeAgentDef,
  hermesAgentDef,
  kimiAgentDef,
  cursorAgentDef,
  qwenAgentDef,
  qoderAgentDef,
  copilotAgentDef,
  piAgentDef,
  kiroAgentDef,
  kiloAgentDef,
  vibeAgentDef,
  deepseekAgentDef,
];

const ids = new Set();
for (const def of AGENT_DEFS) {
  if (ids.has(def.id)) {
    throw new Error(`Duplicate agent definition id: ${def.id}`);
  }
  ids.add(def.id);
}

export function getAgentDef(id): AgentDef | null {
  return AGENT_DEFS.find((a) => a.id === id) || null;
}
