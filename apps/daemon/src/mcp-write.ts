import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const SERVER_NAME = 'open-design-write';
const SERVER_VERSION = '0.1.0';

type JsonObject = Record<string, unknown>;

interface RunMcpWriteOptions {
  daemonUrl: string | URL;
}

interface AgentSummary {
  id?: string;
  name?: string;
  available?: boolean;
}

interface ProjectSummary {
  id?: string;
  name?: string;
  metadata?: JsonObject | null;
}

interface ConversationSummary {
  id?: string;
  projectId?: string;
  title?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

interface ChatRunStatusResponse {
  id?: string;
  projectId?: string | null;
  conversationId?: string | null;
  assistantMessageId?: string | null;
  agentId?: string | null;
  status?: string;
  createdAt?: number;
  updatedAt?: number;
  exitCode?: number | null;
  signal?: string | null;
}

interface ChatMessage {
  id?: string;
  role?: string;
  content?: string;
  agentId?: string;
  agentName?: string;
  runId?: string;
  runStatus?: string;
  createdAt?: number;
  startedAt?: number;
  endedAt?: number;
  producedFiles?: unknown[];
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonObject;
  annotations?: JsonObject;
}

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const EMPTY_OBJECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {},
} satisfies JsonObject;

const TOOL_DEFS: ToolDef[] = [
  {
    name: 'list_agents',
    description: 'List Open Design local agent adapters and whether they are currently available.',
    inputSchema: EMPTY_OBJECT_SCHEMA,
    annotations: { ...READ_ANNOTATIONS, title: 'List Open Design agents' },
  },
  {
    name: 'list_skills',
    description: 'List Open Design skills that can be assigned to a project or run.',
    inputSchema: EMPTY_OBJECT_SCHEMA,
    annotations: { ...READ_ANNOTATIONS, title: 'List Open Design skills' },
  },
  {
    name: 'list_design_systems',
    description: 'List Open Design design systems that can be assigned to a project or run.',
    inputSchema: EMPTY_OBJECT_SCHEMA,
    annotations: { ...READ_ANNOTATIONS, title: 'List design systems' },
  },
  {
    name: 'create_project',
    description: 'Create a managed Open Design project. This does not import an arbitrary local folder.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        id: { type: 'string', description: 'Optional project id. Auto-generated when omitted.' },
        name: { type: 'string', description: 'Project display name.' },
        skillId: { type: 'string' },
        designSystemId: { type: 'string' },
        pendingPrompt: { type: 'string' },
        metadata: { type: 'object', additionalProperties: true },
      },
    },
    annotations: { ...WRITE_ANNOTATIONS, title: 'Create Open Design project' },
  },
  {
    name: 'update_project',
    description: 'Patch Open Design project metadata such as name, skill, design system, or non-privileged metadata fields.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId'],
      properties: {
        projectId: { type: 'string' },
        patch: { type: 'object', additionalProperties: true },
      },
    },
    annotations: { ...WRITE_ANNOTATIONS, title: 'Update project' },
  },
  {
    name: 'list_conversations',
    description: 'List conversations for one Open Design project.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId'],
      properties: {
        projectId: { type: 'string' },
      },
    },
    annotations: { ...READ_ANNOTATIONS, title: 'List conversations' },
  },
  {
    name: 'create_conversation',
    description: 'Create a new conversation inside an existing Open Design project.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId'],
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string' },
      },
    },
    annotations: { ...WRITE_ANNOTATIONS, title: 'Create conversation' },
  },
  {
    name: 'write_file',
    description: 'Write or overwrite one project file relative to the project root.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId', 'path', 'content'],
      properties: {
        projectId: { type: 'string' },
        path: { type: 'string', description: 'Relative file path.' },
        content: { type: 'string' },
        encoding: { type: 'string', enum: ['utf8', 'base64'] },
        artifactManifest: { type: 'object', additionalProperties: true },
      },
    },
    annotations: { ...WRITE_ANNOTATIONS, title: 'Write project file' },
  },
  {
    name: 'rename_file',
    description: 'Rename or move one project file within the same project.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId', 'from', 'to'],
      properties: {
        projectId: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
      },
    },
    annotations: { ...WRITE_ANNOTATIONS, title: 'Rename project file' },
  },
  {
    name: 'delete_file',
    description: 'Delete one project file relative to the project root.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId', 'path'],
      properties: {
        projectId: { type: 'string' },
        path: { type: 'string' },
      },
    },
    annotations: { ...WRITE_ANNOTATIONS, title: 'Delete project file' },
  },
  {
    name: 'generate_project_content',
    description: 'Create a new Open Design project, queue one generation run, and optionally wait for completion.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'message'],
      properties: {
        id: { type: 'string', description: 'Optional project id. Auto-generated when omitted.' },
        name: { type: 'string', description: 'Project display name.' },
        message: { type: 'string', description: 'Prompt to execute inside Open Design.' },
        currentPrompt: { type: 'string', description: 'Optional latest user turn override for telemetry.' },
        agentId: { type: 'string', description: 'Optional Open Design inner agent id. Auto-resolved when omitted.' },
        skillId: { type: 'string' },
        designSystemId: { type: 'string' },
        pendingPrompt: { type: 'string' },
        metadata: { type: 'object', additionalProperties: true },
        model: { type: 'string' },
        reasoning: { type: 'string' },
        systemPrompt: { type: 'string' },
        attachments: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional project-relative files to mention to the inner Open Design run.',
        },
        wait: {
          type: 'boolean',
          description: 'Wait for terminal run status before returning. Defaults to true.',
        },
        timeoutMs: { type: 'number' },
        pollIntervalMs: { type: 'number' },
      },
    },
    annotations: { ...WRITE_ANNOTATIONS, title: 'Generate into new project' },
  },
  {
    name: 'continue_project_content',
    description: 'Queue one content-generation run inside an existing Open Design project and optionally wait for completion.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['projectId', 'message'],
      properties: {
        projectId: { type: 'string' },
        conversationId: { type: 'string', description: 'Optional existing conversation id. When omitted, a new conversation is created.' },
        conversationTitle: { type: 'string', description: 'Title for the auto-created conversation when conversationId is omitted.' },
        message: { type: 'string' },
        currentPrompt: { type: 'string' },
        agentId: { type: 'string' },
        skillId: { type: 'string' },
        designSystemId: { type: 'string' },
        model: { type: 'string' },
        reasoning: { type: 'string' },
        systemPrompt: { type: 'string' },
        attachments: {
          type: 'array',
          items: { type: 'string' },
        },
        wait: {
          type: 'boolean',
          description: 'Wait for terminal run status before returning. Defaults to true.',
        },
        timeoutMs: { type: 'number' },
        pollIntervalMs: { type: 'number' },
      },
    },
    annotations: { ...WRITE_ANNOTATIONS, title: 'Generate into existing project' },
  },
  {
    name: 'get_run',
    description: 'Read one Open Design run plus assistant-message and file context when available.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['runId'],
      properties: {
        runId: { type: 'string' },
      },
    },
    annotations: { ...READ_ANNOTATIONS, title: 'Get run status' },
  },
  {
    name: 'wait_for_run',
    description: 'Poll one Open Design run until it reaches a terminal status or the timeout expires.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['runId'],
      properties: {
        runId: { type: 'string' },
        timeoutMs: { type: 'number' },
        pollIntervalMs: { type: 'number' },
      },
    },
    annotations: { ...WRITE_ANNOTATIONS, title: 'Wait for run' },
  },
  {
    name: 'cancel_run',
    description: 'Cancel one active Open Design run.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['runId'],
      properties: {
        runId: { type: 'string' },
      },
    },
    annotations: { ...WRITE_ANNOTATIONS, title: 'Cancel run' },
  },
];

export async function runWriteMcpStdio(
  { daemonUrl }: RunMcpWriteOptions,
): Promise<void> {
  const baseUrl = String(daemonUrl).replace(/\/$/, '');

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions: [
        'Custom Open Design authoring MCP for local CLI use.',
        'This server is NOT the official built-in `od mcp`; it adds write tools',
        'on top of the running local Open Design daemon so trusted coding',
        'agents can create projects, write files, and start generation runs.',
        '',
        'Safety model:',
        ' - Prefer fresh filenames unless the user explicitly asked to overwrite.',
        ' - Managed project creation is supported.',
        ' - Desktop-gated folder import is intentionally not exposed here.',
        ' - Use list_agents/list_skills/list_design_systems before guessing ids.',
        '',
        'Run workflow:',
        ' - generate_project_content() for a new managed project.',
        ' - continue_project_content() for an existing project.',
        ' - wait_for_run() or get_run() to inspect outcome.',
        '',
        'If you need to read project source deeply, use the standard read-only',
        'Open Design MCP server alongside this one.',
      ].join('\n'),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params?.name;
    const args =
      req.params?.arguments &&
      typeof req.params.arguments === 'object' &&
      !Array.isArray(req.params.arguments)
        ? (req.params.arguments as JsonObject)
        : {};

    try {
      switch (name) {
        case 'list_agents':
          return ok(await requestJson(baseUrl, '/api/agents'));
        case 'list_skills':
          return ok(await requestJson(baseUrl, '/api/skills'));
        case 'list_design_systems':
          return ok(await requestJson(baseUrl, '/api/design-systems'));
        case 'create_project':
          return ok(await createProject(baseUrl, args));
        case 'update_project':
          return ok(await updateProject(baseUrl, args));
        case 'list_conversations':
          return ok(await listConversations(baseUrl, args));
        case 'create_conversation':
          return ok(await createConversation(baseUrl, args));
        case 'write_file':
          return ok(await writeFile(baseUrl, args));
        case 'rename_file':
          return ok(await renameFile(baseUrl, args));
        case 'delete_file':
          return ok(await deleteFile(baseUrl, args));
        case 'generate_project_content':
          return ok(await generateProjectContent(baseUrl, args));
        case 'continue_project_content':
          return ok(await continueProjectContent(baseUrl, args));
        case 'get_run':
          return ok(await getRun(baseUrl, args));
        case 'wait_for_run':
          return ok(await waitForRun(baseUrl, args));
        case 'cancel_run':
          return ok(await cancelRun(baseUrl, args));
        default:
          return errorResult(`unknown tool: ${String(name)}`);
      }
    } catch (error) {
      return errorResult(formatError(error));
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    transport.onclose = done;
    process.stdin.once('end', done);
    process.stdin.once('close', done);
  });
}

async function createProject(baseUrl: string, args: JsonObject): Promise<unknown> {
  requireString(args.name, 'name');
  const id =
    typeof args.id === 'string' && args.id.trim().length > 0
      ? args.id.trim()
      : makeProjectId();
  return await requestJson(baseUrl, '/api/projects', {
    method: 'POST',
    body: JSON.stringify({
      id,
      name: args.name.trim(),
      ...(typeof args.skillId === 'string' ? { skillId: args.skillId } : {}),
      ...(typeof args.designSystemId === 'string'
        ? { designSystemId: args.designSystemId }
        : {}),
      ...(typeof args.pendingPrompt === 'string'
        ? { pendingPrompt: args.pendingPrompt }
        : {}),
      ...(isPlainObject(args.metadata) ? { metadata: args.metadata } : {}),
    }),
  });
}

async function updateProject(baseUrl: string, args: JsonObject): Promise<unknown> {
  requireString(args.projectId, 'projectId');
  const patch = isPlainObject(args.patch) ? args.patch : {};
  return await requestJson(
    baseUrl,
    `/api/projects/${encodeURIComponent(args.projectId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  );
}

async function listConversations(baseUrl: string, args: JsonObject): Promise<unknown> {
  requireString(args.projectId, 'projectId');
  return await requestJson(
    baseUrl,
    `/api/projects/${encodeURIComponent(args.projectId)}/conversations`,
  );
}

async function createConversation(baseUrl: string, args: JsonObject): Promise<unknown> {
  requireString(args.projectId, 'projectId');
  return await requestJson(
    baseUrl,
    `/api/projects/${encodeURIComponent(args.projectId)}/conversations`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...(typeof args.title === 'string' ? { title: args.title } : {}),
      }),
    },
  );
}

async function writeFile(baseUrl: string, args: JsonObject): Promise<unknown> {
  requireString(args.projectId, 'projectId');
  requireString(args.path, 'path');
  requireString(args.content, 'content');
  return await requestJson(
    baseUrl,
    `/api/projects/${encodeURIComponent(args.projectId)}/files`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: args.path,
        content: args.content,
        ...(args.encoding === 'base64' ? { encoding: 'base64' } : {}),
        ...(isPlainObject(args.artifactManifest)
          ? { artifactManifest: args.artifactManifest }
          : {}),
      }),
    },
  );
}

async function renameFile(baseUrl: string, args: JsonObject): Promise<unknown> {
  requireString(args.projectId, 'projectId');
  requireString(args.from, 'from');
  requireString(args.to, 'to');
  return await requestJson(
    baseUrl,
    `/api/projects/${encodeURIComponent(args.projectId)}/files/rename`,
    {
      method: 'POST',
      body: JSON.stringify({ from: args.from, to: args.to }),
    },
  );
}

async function deleteFile(baseUrl: string, args: JsonObject): Promise<unknown> {
  requireString(args.projectId, 'projectId');
  requireString(args.path, 'path');
  return await requestJson(
    baseUrl,
    `/api/projects/${encodeURIComponent(args.projectId)}/files/${encodeURIComponent(args.path)}`,
    { method: 'DELETE' },
  );
}

async function generateProjectContent(
  baseUrl: string,
  args: JsonObject,
): Promise<unknown> {
  const created = asObject(await createProject(baseUrl, args));
  const project = asObject(created.project);
  const conversationId = asOptionalString(created.conversationId);
  const projectId = asOptionalString(project.id);
  if (!projectId || !conversationId) {
    throw new Error('project creation did not return project.id and conversationId');
  }
  const started = await queueContentRun(baseUrl, {
    projectId,
    conversationId,
    message: args.message,
    currentPrompt: args.currentPrompt,
    requestedAgentId: args.agentId,
    skillId:
      typeof args.skillId === 'string'
        ? args.skillId
        : asOptionalString(project.skillId) ?? null,
    designSystemId:
      typeof args.designSystemId === 'string'
        ? args.designSystemId
        : asOptionalString(project.designSystemId) ?? null,
    model: typeof args.model === 'string' ? args.model : null,
    reasoning: typeof args.reasoning === 'string' ? args.reasoning : null,
    systemPrompt: typeof args.systemPrompt === 'string' ? args.systemPrompt : null,
    attachments: asStringArray(args.attachments),
  });
  const response: JsonObject = {
    project: created.project,
    conversationId,
    ...started,
  };
  if (shouldWait(args.wait)) {
    response.waitResult = await waitForRun(baseUrl, {
      runId: started.runId,
      timeoutMs: args.timeoutMs,
      pollIntervalMs: args.pollIntervalMs,
    });
  }
  return response;
}

async function continueProjectContent(
  baseUrl: string,
  args: JsonObject,
): Promise<unknown> {
  requireString(args.projectId, 'projectId');
  const projectId = args.projectId;
  let conversationId =
    typeof args.conversationId === 'string' && args.conversationId.trim().length > 0
      ? args.conversationId.trim()
      : null;
  if (!conversationId) {
    const created = asObject(
      await createConversation(baseUrl, {
        projectId,
        title:
          typeof args.conversationTitle === 'string'
            ? args.conversationTitle
            : null,
      }),
    );
    conversationId = asOptionalString(asObject(created.conversation).id);
  }
  if (!conversationId) {
    throw new Error('conversation creation did not return conversation.id');
  }
  const started = await queueContentRun(baseUrl, {
    projectId,
    conversationId,
    message: args.message,
    currentPrompt: args.currentPrompt,
    requestedAgentId: args.agentId,
    skillId: typeof args.skillId === 'string' ? args.skillId : null,
    designSystemId:
      typeof args.designSystemId === 'string' ? args.designSystemId : null,
    model: typeof args.model === 'string' ? args.model : null,
    reasoning: typeof args.reasoning === 'string' ? args.reasoning : null,
    systemPrompt: typeof args.systemPrompt === 'string' ? args.systemPrompt : null,
    attachments: asStringArray(args.attachments),
  });
  const response: JsonObject = {
    projectId,
    conversationId,
    ...started,
  };
  if (shouldWait(args.wait)) {
    response.waitResult = await waitForRun(baseUrl, {
      runId: started.runId,
      timeoutMs: args.timeoutMs,
      pollIntervalMs: args.pollIntervalMs,
    });
  }
  return response;
}

async function queueContentRun(
  baseUrl: string,
  options: {
    projectId: string;
    conversationId: string;
    message: unknown;
    currentPrompt: unknown;
    requestedAgentId: unknown;
    skillId: string | null;
    designSystemId: string | null;
    model: string | null;
    reasoning: string | null;
    systemPrompt: string | null;
    attachments: string[];
  },
): Promise<JsonObject> {
  requireString(options.message, 'message');
  const agent = await resolveAgent(baseUrl, options.requestedAgentId);
  const now = Date.now();
  const userMessageId = `mcp-user-${randomUUID()}`;
  const assistantMessageId = `mcp-assistant-${randomUUID()}`;
  const clientRequestId = `mcp-${randomUUID()}`;

  await upsertConversationMessage(baseUrl, {
    projectId: options.projectId,
    conversationId: options.conversationId,
    messageId: userMessageId,
    body: {
      id: userMessageId,
      role: 'user',
      content: options.message.trim(),
      createdAt: now,
    },
  });

  await upsertConversationMessage(baseUrl, {
    projectId: options.projectId,
    conversationId: options.conversationId,
    messageId: assistantMessageId,
    body: {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      agentId: agent.id,
      agentName: agent.name,
      runStatus: 'queued',
      startedAt: now,
      createdAt: now,
    },
  });

  const created = asObject(
    await requestJson(baseUrl, '/api/runs', {
      method: 'POST',
      body: JSON.stringify({
        agentId: agent.id,
        message: options.message.trim(),
        currentPrompt:
          typeof options.currentPrompt === 'string' && options.currentPrompt.trim().length > 0
            ? options.currentPrompt.trim()
            : options.message.trim(),
        projectId: options.projectId,
        conversationId: options.conversationId,
        assistantMessageId,
        clientRequestId,
        ...(options.skillId ? { skillId: options.skillId } : {}),
        ...(options.designSystemId
          ? { designSystemId: options.designSystemId }
          : {}),
        ...(options.model ? { model: options.model } : {}),
        ...(options.reasoning ? { reasoning: options.reasoning } : {}),
        ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
        ...(options.attachments.length > 0
          ? { attachments: options.attachments }
          : {}),
      }),
    }),
  );
  const runId = asOptionalString(created.runId);
  if (!runId) throw new Error('run creation did not return runId');

  await upsertConversationMessage(baseUrl, {
    projectId: options.projectId,
    conversationId: options.conversationId,
    messageId: assistantMessageId,
    body: {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      agentId: agent.id,
      agentName: agent.name,
      runId,
      runStatus: 'queued',
      startedAt: now,
      createdAt: now,
    },
  });

  return {
    runId,
    agentId: agent.id,
    agentName: agent.name,
    userMessageId,
    assistantMessageId,
    clientRequestId,
  };
}

async function getRun(baseUrl: string, args: JsonObject): Promise<unknown> {
  requireString(args.runId, 'runId');
  const run = await fetchRunStatus(baseUrl, args.runId);
  return await enrichRun(baseUrl, run);
}

async function waitForRun(baseUrl: string, args: JsonObject): Promise<unknown> {
  requireString(args.runId, 'runId');
  const timeoutMs = clampPositiveInteger(args.timeoutMs, 120_000, 5_000, 600_000);
  const pollIntervalMs = clampPositiveInteger(args.pollIntervalMs, 1_000, 250, 5_000);
  const startedAt = Date.now();
  let run = await fetchRunStatus(baseUrl, args.runId);
  while (!isTerminalRunStatus(run.status) && Date.now() - startedAt < timeoutMs) {
    await sleep(pollIntervalMs);
    run = await fetchRunStatus(baseUrl, args.runId);
  }
  return await enrichRun(baseUrl, run, {
    timedOut: !isTerminalRunStatus(run.status),
    timeoutMs,
    pollIntervalMs,
  });
}

async function cancelRun(baseUrl: string, args: JsonObject): Promise<unknown> {
  requireString(args.runId, 'runId');
  return await requestJson(
    baseUrl,
    `/api/runs/${encodeURIComponent(args.runId)}/cancel`,
    { method: 'POST' },
  );
}

async function resolveAgent(
  baseUrl: string,
  requested: unknown,
): Promise<{ id: string; name: string }> {
  const agentsBody = asObject(await requestJson(baseUrl, '/api/agents'));
  const agents = asAgentArray(agentsBody.agents);
  const requestedId =
    typeof requested === 'string' && requested.trim().length > 0
      ? requested.trim()
      : null;

  if (requestedId) {
    const match = agents.find((agent) => agent.id === requestedId);
    if (!match) throw new Error(`unknown Open Design agent: ${requestedId}`);
    if (match.available === false) {
      throw new Error(`Open Design agent "${requestedId}" is not available on this machine`);
    }
    return {
      id: requestedId,
      name: typeof match.name === 'string' ? match.name : requestedId,
    };
  }

  let configuredId: string | null = null;
  try {
    const appConfigBody = asObject(await requestJson(baseUrl, '/api/app-config'));
    const config = asObject(appConfigBody.config);
    configuredId =
      typeof config.agentId === 'string' && config.agentId.trim().length > 0
        ? config.agentId.trim()
        : null;
  } catch {
    configuredId = null;
  }

  if (configuredId) {
    const configured = agents.find(
      (agent) => agent.id === configuredId && agent.available !== false,
    );
    if (configured) {
      return {
        id: configuredId,
        name:
          typeof configured.name === 'string' && configured.name.length > 0
            ? configured.name
            : configuredId,
      };
    }
  }

  const available = agents.find(
    (agent) =>
      typeof agent.id === 'string' &&
      agent.id.length > 0 &&
      agent.available !== false,
  );
  if (!available?.id) {
    throw new Error(
      'No available Open Design agent found. Configure a local agent in Open Design first.',
    );
  }
  return {
    id: available.id,
    name:
      typeof available.name === 'string' && available.name.length > 0
        ? available.name
        : available.id,
  };
}

async function upsertConversationMessage(
  baseUrl: string,
  options: {
    projectId: string;
    conversationId: string;
    messageId: string;
    body: JsonObject;
  },
): Promise<unknown> {
  return await requestJson(
    baseUrl,
    `/api/projects/${encodeURIComponent(options.projectId)}/conversations/${encodeURIComponent(options.conversationId)}/messages/${encodeURIComponent(options.messageId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(options.body),
    },
  );
}

async function fetchRunStatus(
  baseUrl: string,
  runId: string,
): Promise<ChatRunStatusResponse> {
  return asRunStatusResponse(
    await requestJson(baseUrl, `/api/runs/${encodeURIComponent(runId)}`),
  );
}

async function enrichRun(
  baseUrl: string,
  run: ChatRunStatusResponse,
  extra: JsonObject = {},
): Promise<JsonObject> {
  const result: JsonObject = {
    run,
    ...extra,
  };

  if (run.projectId) {
    try {
      const filesBody = asObject(
        await requestJson(
          baseUrl,
          `/api/projects/${encodeURIComponent(run.projectId)}/files`,
        ),
      );
      result.files = Array.isArray(filesBody.files) ? filesBody.files : [];
    } catch (error) {
      result.filesError = formatError(error);
    }
  }

  if (run.projectId && run.conversationId) {
    try {
      const messagesBody = asObject(
        await requestJson(
          baseUrl,
          `/api/projects/${encodeURIComponent(run.projectId)}/conversations/${encodeURIComponent(run.conversationId)}/messages`,
        ),
      );
      const messages = asMessageArray(messagesBody.messages);
      if (run.assistantMessageId) {
        let assistantMessage =
          messages.find((message) => message.id === run.assistantMessageId) ?? null;
        if (
          assistantMessage &&
          isTerminalRunStatus(run.status) &&
          (assistantMessage.runStatus !== run.status || assistantMessage.endedAt == null)
        ) {
          assistantMessage = await finalizeAssistantMessage(baseUrl, run, assistantMessage);
        }
        result.assistantMessage = assistantMessage;
      } else {
        result.assistantMessage = null;
      }
    } catch (error) {
      result.assistantMessageError = formatError(error);
    }
  }

  return result;
}

async function finalizeAssistantMessage(
  baseUrl: string,
  run: ChatRunStatusResponse,
  assistantMessage: ChatMessage,
): Promise<ChatMessage> {
  if (!run.projectId || !run.conversationId || !run.assistantMessageId) {
    return assistantMessage;
  }
  const finalizedBody: JsonObject = {
    id: run.assistantMessageId,
    role: assistantMessage.role === 'assistant' ? 'assistant' : 'assistant',
    content: typeof assistantMessage.content === 'string' ? assistantMessage.content : '',
    runId: run.id,
    runStatus: run.status ?? assistantMessage.runStatus ?? 'failed',
    startedAt:
      typeof assistantMessage.startedAt === 'number'
        ? assistantMessage.startedAt
        : run.createdAt ?? Date.now(),
    endedAt:
      typeof assistantMessage.endedAt === 'number'
        ? assistantMessage.endedAt
        : Date.now(),
    createdAt:
      typeof assistantMessage.createdAt === 'number'
        ? assistantMessage.createdAt
        : run.createdAt ?? Date.now(),
  };
  if (typeof run.agentId === 'string' && run.agentId.length > 0) {
    finalizedBody.agentId = run.agentId;
  } else if (typeof assistantMessage.agentId === 'string') {
    finalizedBody.agentId = assistantMessage.agentId;
  }
  if (typeof assistantMessage.agentName === 'string' && assistantMessage.agentName.length > 0) {
    finalizedBody.agentName = assistantMessage.agentName;
  }
  await upsertConversationMessage(baseUrl, {
    projectId: run.projectId,
    conversationId: run.conversationId,
    messageId: run.assistantMessageId,
    body: finalizedBody,
  });
  return finalizedBody as ChatMessage;
}

async function requestJson(
  baseUrl: string,
  pathname: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(endpoint(baseUrl, pathname), {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...init.headers,
    },
  });
  const text = await response.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const details = body;
    const reason = extractResponseErrorMessage(details) ?? `daemon returned ${response.status}`;
    const error = new Error(reason);
    (error as Error & { status?: number; details?: unknown }).status = response.status;
    (error as Error & { status?: number; details?: unknown }).details = details;
    throw error;
  }
  return body;
}

function endpoint(baseUrl: string, pathname: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname}${pathname}`.replace(/\/+/g, '/');
  url.search = '';
  url.hash = '';
  return url.toString();
}

function extractResponseErrorMessage(payload: unknown): string | null {
  if (typeof payload === 'string' && payload.trim().length > 0) return payload.trim();
  if (!isPlainObject(payload)) return null;
  const body = payload;
  if (typeof body.message === 'string' && body.message.trim().length > 0) {
    return body.message.trim();
  }
  if (typeof body.error === 'string' && body.error.trim().length > 0) {
    return body.error.trim();
  }
  if (isPlainObject(body.details)) {
    const detailBody = body.details;
    if (typeof detailBody.reason === 'string' && detailBody.reason.trim().length > 0) {
      return detailBody.reason.trim();
    }
  }
  return null;
}

function ok(payload: unknown) {
  const text =
    typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: 'text', text }] };
}

function errorResult(message: string) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    const status = 'status' in error ? (error as { status?: number }).status : undefined;
    const details =
      'details' in error ? (error as { details?: unknown }).details : undefined;
    const message = error.message || 'unknown error';
    if (details !== undefined) {
      return `${status ? `HTTP ${status}: ` : ''}${message}\n${JSON.stringify(details, null, 2)}`;
    }
    return `${status ? `HTTP ${status}: ` : ''}${message}`;
  }
  return String(error);
}

function requireString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required (string).`);
  }
}

function makeProjectId(): string {
  return `od-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function shouldWait(value: unknown): boolean {
  return value !== false;
}

function isTerminalRunStatus(status: unknown): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}

function clampPositiveInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.floor(value);
  return Math.min(max, Math.max(min, rounded));
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): JsonObject {
  return isPlainObject(value) ? value : {};
}

function asAgentArray(value: unknown): AgentSummary[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is AgentSummary => isPlainObject(entry))
    : [];
}

function asRunStatusResponse(value: unknown): ChatRunStatusResponse {
  return isPlainObject(value) ? (value as ChatRunStatusResponse) : {};
}

function asMessageArray(value: unknown): ChatMessage[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is ChatMessage => isPlainObject(entry))
    : [];
}
