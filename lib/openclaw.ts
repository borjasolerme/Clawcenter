import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
export const configPath =
  process.env.OPENCLAW_CONFIG_PATH || path.join(stateDir, "openclaw.json");

export const editableFileNames = [
  "IDENTITY.md",
  "SOUL.md",
  "USER.md",
  "MEMORY.md",
  "TOOLS.md",
  "AGENTS.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
] as const;

const editableFileSet = new Set<string>(editableFileNames);

export type OpenClawConfig = {
  agents?: {
    defaults?: Record<string, unknown>;
    list?: AgentConfig[];
  };
  bindings?: AgentBinding[];
  [key: string]: unknown;
};

export type AgentConfig = {
  id: string;
  name?: string;
  default?: boolean;
  workspace?: string;
  agentDir?: string;
  model?: string;
  heartbeat?: HeartbeatConfig;
  [key: string]: unknown;
};

export type HeartbeatConfig = {
  every?: string;
  activeHours?: {
    start?: string;
    end?: string;
  };
  model?: string;
  target?: string;
  [key: string]: unknown;
};

export type AgentBinding = {
  agentId?: string;
  match?: {
    channel?: string;
    accountId?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type AgentIdentity = {
  name: string;
  emoji: string;
  vibe: string;
  role: string;
  description: string;
};

export type AgentSummary = AgentConfig & {
  identity: AgentIdentity;
  workspace: string;
  model: string;
  bindings: AgentBinding[];
  files: { name: string; exists: boolean }[];
};

export type OrgChartNode = {
  agentId: string;
  parentId?: string;
  x: number;
  y: number;
};

export type OrgChartConfig = {
  nodes: OrgChartNode[];
};

const orgChartPath = path.join(stateDir, "mission-control-org-chart.json");

export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  directory: string;
  source: string;
  scope: string;
  enabled: boolean;
  agents: string[];
  installedAgents: string[];
  files: string[];
};

export async function readConfig() {
  return readJson<OpenClawConfig>(configPath);
}

export async function writeConfig(config: OpenClawConfig) {
  await mkdir(path.dirname(configPath), { recursive: true });
  await backupFile(configPath);
  await atomicWrite(configPath, JSON.stringify(config, null, 2) + "\n");
}

export async function getAgents() {
  const config = await readConfig();
  const defaults = config.agents?.defaults ?? {};
  const defaultWorkspace =
    typeof defaults.workspace === "string"
      ? defaults.workspace
      : path.join(stateDir, "workspace");
  const defaultModel = readPrimaryModel(defaults);
  const bindings = Array.isArray(config.bindings) ? config.bindings : [];
  const agents = config.agents?.list ?? [];

  return Promise.all(
    agents.map(async (agent) => {
      const workspace = agent.workspace || defaultWorkspace;
      const identity = await readIdentity(workspace, agent);
      const files = await Promise.all(
        editableFileNames.map(async (name) => ({
          name,
          exists: await fileExists(path.join(workspace, name)),
        })),
      );

      return {
        ...agent,
        workspace,
        model: agent.model || defaultModel,
        identity,
        bindings: bindings.filter((binding) => binding.agentId === agent.id),
        files,
      } satisfies AgentSummary;
    }),
  );
}

export async function getAgent(agentId: string) {
  const agents = await getAgents();
  const agent = agents.find((item) => item.id === agentId);
  if (!agent) {
    throw new HttpError(404, `Unknown agent: ${agentId}`);
  }
  return agent;
}

export async function readAgentFile(agentId: string, fileName: string) {
  assertEditableFile(fileName);
  const agent = await getAgent(agentId);
  const filePath = path.join(agent.workspace, fileName);
  try {
    return {
      agent,
      fileName,
      content: await readFile(filePath, "utf8"),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { agent, fileName, content: "" };
    }
    throw error;
  }
}

export async function writeAgentFile(agentId: string, fileName: string, content: string) {
  assertEditableFile(fileName);
  const agent = await getAgent(agentId);
  const filePath = path.join(agent.workspace, fileName);
  await mkdir(path.dirname(filePath), { recursive: true });
  await backupFile(filePath);
  await atomicWrite(filePath, content);
  return { agent, fileName, content };
}

export async function updateAgentIdentity(agentId: string, identity: Partial<AgentIdentity>) {
  const agent = await getAgent(agentId);
  const current = await readIdentity(agent.workspace, agent);
  const next = {
    ...current,
    ...identity,
  };
  const content = [
    `- **Name:** ${next.name}`,
    `- **Role:** ${next.role}`,
    `- **Description:** ${next.description}`,
    `- **Vibe:** ${next.vibe}`,
    `- **Emoji:** ${next.emoji}`,
    "",
  ].join("\n");
  await writeAgentFile(agentId, "IDENTITY.md", content);
  return next;
}

export async function readOrgChart(): Promise<OrgChartConfig> {
  try {
    const parsed = await readJson<OrgChartConfig>(orgChartPath);
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes.filter(isOrgChartNode) : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { nodes: [] };
    throw error;
  }
}

export async function writeOrgChart(input: OrgChartConfig) {
  const nodes = Array.isArray(input.nodes) ? input.nodes.filter(isOrgChartNode) : [];
  await mkdir(path.dirname(orgChartPath), { recursive: true });
  await backupFile(orgChartPath);
  await atomicWrite(orgChartPath, JSON.stringify({ nodes }, null, 2) + "\n");
  return { nodes };
}

export async function listSkills() {
  const [agents, config] = await Promise.all([getAgents(), readConfig()]);
  const entries = readSkillEntries(config);
  const defaultAllowlist = readSkillAllowlist(config.agents?.defaults);
  const byDirectory = new Map<string, SkillSummary>();
  const summariesByDirectory = new Map<string, SkillSummary>();

  for (const root of sharedSkillRoots(config)) {
    const directories = await listSkillDirectories(root.directory);
    for (const directory of directories) {
      summariesByDirectory.set(directory, await readSkillSummary(directory, root, entries));
    }
  }

  for (const agent of agents) {
    const visibleByName = new Map<string, SkillSummary>();
    const installedByDirectory = new Set<string>();
    const agentWorkspaceRoots = workspaceSkillRoots(agent.workspace);
    for (const root of agentWorkspaceRoots) {
      const directories = await listSkillDirectories(root);
      for (const directory of directories) installedByDirectory.add(directory);
    }
    const roots = [...sharedSkillRoots(config), ...agentWorkspaceRoots];
    for (const root of roots) {
      const directories = await listSkillDirectories(root);
      for (const directory of directories) {
        const skill = summariesByDirectory.get(directory) ?? await readSkillSummary(directory, root, entries);
        summariesByDirectory.set(directory, skill);
        visibleByName.set(skill.name, skill);
      }
    }

    const agentAllowlist = readSkillAllowlist(agent);
    const effectiveAllowlist = agentAllowlist ?? defaultAllowlist;
    for (const skill of visibleByName.values()) {
      if (!skill.enabled) continue;
      if (effectiveAllowlist && !effectiveAllowlist.has(skill.name)) continue;
      const existing = byDirectory.get(skill.directory);
      if (existing) {
        if (!existing.agents.includes(agent.id)) existing.agents.push(agent.id);
        if (installedByDirectory.has(skill.directory) && !existing.installedAgents.includes(agent.id)) {
          existing.installedAgents.push(agent.id);
        }
      } else {
        byDirectory.set(skill.directory, {
          ...skill,
          agents: [agent.id],
          installedAgents: installedByDirectory.has(skill.directory) ? [agent.id] : [],
        });
      }
    }
  }

  for (const skill of summariesByDirectory.values()) {
    if (!byDirectory.has(skill.directory)) byDirectory.set(skill.directory, skill);
  }

  const skills = [...byDirectory.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    skills,
    updatedAt: new Date().toISOString(),
  };
}

export async function readSkillFile(skillId: string, fileName: string) {
  const skill = await getSkillById(skillId);
  const safeFile = normalizeSkillFile(skill.directory, fileName);
  return {
    skill,
    fileName: safeFile.relative,
    content: await readFile(safeFile.absolute, "utf8"),
  };
}

export async function writeSkillFile(skillId: string, fileName: string, content: string) {
  const skill = await getSkillById(skillId);
  const safeFile = normalizeSkillFile(skill.directory, fileName);
  await backupFile(safeFile.absolute);
  await atomicWrite(safeFile.absolute, content);
  return {
    skill,
    fileName: safeFile.relative,
    content,
  };
}

export async function updateHeartbeat(agentId: string, heartbeat: HeartbeatConfig | null) {
  const config = await readConfig();
  const list = config.agents?.list ?? [];
  const index = list.findIndex((agent) => agent.id === agentId);
  if (index === -1) {
    throw new HttpError(404, `Unknown agent: ${agentId}`);
  }

  if (heartbeat) {
    list[index] = {
      ...list[index],
      heartbeat: normalizeHeartbeat(heartbeat),
    };
  } else {
    const agentWithoutHeartbeat = { ...list[index] };
    delete agentWithoutHeartbeat.heartbeat;
    list[index] = agentWithoutHeartbeat;
  }

  config.agents = {
    ...(config.agents ?? {}),
    list,
  };
  await writeConfig(config);
  return list[index];
}

export async function listCrons() {
  const result = await runOpenClaw(["cron", "list", "--json"], 12_000);
  if (!result.ok) {
    return {
      crons: [],
      error: result.error,
      stderr: result.stderr,
    };
  }

  const parsed = safeJson(result.stdout);
  const crons = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.jobs) ? parsed.jobs : [];
  return { crons, raw: parsed };
}

export type ActivityEvent = {
  action?: string;
  details?: string;
  id: string;
  agentId: string;
  message?: string;
  result?: string;
  runtime: string;
  status: string;
  label: string;
  summary: string;
  timestamp: number;
  source: string;
};

export async function listActivity() {
  const [tasksResult, commands, sessionEvents, memoryEvents] = await Promise.all([
    runOpenClaw(["tasks", "list", "--json"], 12_000),
    readCommandEvents(),
    readSessionHistoryEvents(),
    readWorkspaceMemoryEvents(),
  ]);

  const events: ActivityEvent[] = [
    ...memoryEvents,
    ...sessionEvents,
    ...commands.filter((command) => !hasRicherSessionEvent(command, sessionEvents)),
  ];
  let taskError = "";

  if (tasksResult.ok) {
    const parsed = safeJson(tasksResult.stdout);
    const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
    for (const task of tasks) {
      if (!task || typeof task !== "object") continue;
      const item = task as Record<string, unknown>;
      const productionSummary = productionLogSummary(firstString(item, ["terminalSummary", "progressSummary", "error"]));
      const instruction = productionLogSummary(firstString(item, ["task", "label", "runtime"]));
      events.push({
        action: typeof item.status === "string" ? item.status : "unknown",
        details: String(item.runId || item.taskId || ""),
        id: String(item.taskId || item.runId || randomUUID()),
        agentId: typeof item.agentId === "string" ? item.agentId : agentFromSession(item.ownerKey),
        message: instruction,
        result: productionSummary,
        runtime: typeof item.runtime === "string" ? item.runtime : "task",
        status: typeof item.status === "string" ? item.status : "unknown",
        label: String(item.label || item.task || item.runtime || "Task"),
        summary: productionSummary || instruction,
        timestamp: numericTimestamp(item.lastEventAt ?? item.endedAt ?? item.startedAt ?? item.createdAt),
        source: "tasks",
      });
    }
  } else {
    taskError = tasksResult.error || tasksResult.stderr || "Failed to load tasks";
  }

  const sorted = events
    .filter((event) => event.timestamp > 0)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 120);

  return {
    events: sorted,
    error: taskError,
    updatedAt: new Date().toISOString(),
  };
}

export async function addCron(input: Record<string, unknown>) {
  return runCronMutation(["cron", "add"], input);
}

export async function editCron(cronId: string, input: Record<string, unknown>) {
  return runCronMutation(["cron", "edit", cronId], input);
}

export async function removeCron(cronId: string) {
  const result = await runOpenClaw(["cron", "rm", cronId, "--json"], 30_000);
  if (!result.ok) {
    throw new HttpError(502, result.error || "Failed to remove cron");
  }
  return safeJson(result.stdout) ?? { ok: true };
}

function normalizeHeartbeat(input: HeartbeatConfig) {
  const heartbeat: HeartbeatConfig = {};
  if (input.every) heartbeat.every = input.every;
  if (input.model) heartbeat.model = input.model;
  if (input.target) heartbeat.target = input.target;
  if (input.activeHours?.start || input.activeHours?.end) {
    heartbeat.activeHours = {
      start: input.activeHours.start || "08:00",
      end: input.activeHours.end || "22:00",
    };
  }
  return heartbeat;
}

function cronArgsFromInput(input: Record<string, unknown>) {
  const args: string[] = [];
  const stringFields = [
    "name",
    "description",
    "agent",
    "message",
    "model",
    "session",
    "sessionKey",
    "channel",
    "account",
    "to",
    "every",
    "cron",
    "at",
    "tz",
    "stagger",
    "thinking",
    "wake",
    "tools",
  ];

  for (const field of stringFields) {
    const value = input[field];
    if (typeof value === "string" && value.trim()) {
      args.push(`--${toKebab(field)}`, value.trim());
    }
  }

  const numberFields = ["timeoutSeconds"];
  for (const field of numberFields) {
    const value = input[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      args.push(`--${toKebab(field)}`, String(value));
    }
  }

  const booleanFlags = [
    "announce",
    "bestEffortDeliver",
    "deleteAfterRun",
    "keepAfterRun",
    "lightContext",
    "exact",
    "enable",
    "disable",
    "clearAgent",
    "clearSessionKey",
    "clearTools",
    "noDeliver",
    "noLightContext",
  ];
  for (const field of booleanFlags) {
    if (input[field] === true) {
      args.push(`--${toKebab(field)}`);
    }
  }

  return args;
}

async function runCronMutation(baseArgs: string[], input: Record<string, unknown>) {
  const args = [...baseArgs, ...cronArgsFromInput(input), "--json"];
  const result = await runOpenClaw(args, 45_000);
  if (!result.ok) {
    throw new HttpError(502, result.error || "OpenClaw cron command failed");
  }
  return safeJson(result.stdout) ?? { ok: true, stdout: result.stdout };
}

async function runOpenClaw(args: string[], timeout: number) {
  try {
    const { stdout, stderr } = await execFileAsync("openclaw", args, {
      timeout,
      maxBuffer: 1024 * 1024 * 8,
    });
    return { ok: true as const, stdout, stderr };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return {
      ok: false as const,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      error: err.stderr || err.message,
    };
  }
}

async function readCommandEvents(): Promise<ActivityEvent[]> {
  const filePath = path.join(stateDir, "logs", "commands.log");
  try {
    const content = await readFile(filePath, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-80)
      .map<ActivityEvent | null>((line) => {
        const parsed = safeJson(line) as Record<string, unknown> | null;
        if (!parsed) return null;
        const sessionKey = typeof parsed.sessionKey === "string" ? parsed.sessionKey : "";
        const message = productionLogSummary(firstString(parsed, ["message", "text", "prompt", "body", "content", "input"]));
        const action = String(parsed.action || "event");
        return {
          action,
          details: sessionKey || String(parsed.senderId || ""),
          id: `command:${String(parsed.timestamp || randomUUID())}:${action}`,
          agentId: agentFromSession(sessionKey),
          message,
          result: "",
          runtime: "command",
          status: action,
          label: String(parsed.source || "command"),
          summary: message || "Command metadata recorded. Message text was not stored in commands.log.",
          timestamp: Date.parse(String(parsed.timestamp || "")),
          source: "commands.log",
        } satisfies ActivityEvent;
      })
      .filter((event): event is ActivityEvent => Boolean(event));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readSessionHistoryEvents(): Promise<ActivityEvent[]> {
  const agents = await getAgents();
  const files = (
    await Promise.all(
      agents.map(async (agent) => {
        const sessionsDirectory = path.join(stateDir, "agents", agent.id, "sessions");
        return listRecentSessionFiles(agent.id, sessionsDirectory);
      }),
    )
  ).flat();
  const events = (
    await Promise.all(files.map((file) => readSessionFileEvents(file.agentId, file.filePath)))
  ).flat();

  return dedupeActivityEvents(events);
}

async function readWorkspaceMemoryEvents(): Promise<ActivityEvent[]> {
  const agents = await getAgents();
  const events = (
    await Promise.all(
      agents.map(async (agent) => {
        const memoryDirectory = path.join(agent.workspace, "memory");
        const files = await listRecentMemoryFiles(memoryDirectory);
        return (await Promise.all(files.map((file) => readMemoryFileEvents(agent.id, file)))).flat();
      }),
    )
  ).flat();

  return dedupeActivityEvents(events);
}

async function listRecentMemoryFiles(memoryDirectory: string) {
  try {
    const entries = await readdir(memoryDirectory, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name))
        .map(async (entry) => {
          const filePath = path.join(memoryDirectory, entry.name);
          const fileStat = await stat(filePath);
          return { filePath, mtimeMs: fileStat.mtimeMs };
        }),
    );
    return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 5).map((file) => file.filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readMemoryFileEvents(agentId: string, filePath: string): Promise<ActivityEvent[]> {
  const content = await readFile(filePath, "utf8");
  const date = path.basename(filePath, ".md");
  return splitMemorySections(content)
    .map((section, index) => memorySectionToEvent(agentId, date, section, index))
    .filter((event): event is ActivityEvent => Boolean(event));
}

function splitMemorySections(content: string) {
  const sections: { title: string; body: string }[] = [];
  const matches = Array.from(content.matchAll(/^##\s+(.+)$/gm));
  for (const [index, match] of matches.entries()) {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? content.length;
    sections.push({
      title: match[1].trim(),
      body: content.slice(start, end).trim(),
    });
  }
  return sections;
}

function memorySectionToEvent(agentId: string, date: string, section: { title: string; body: string }, index: number): ActivityEvent | null {
  const body = section.body.trim();
  if (!body) return null;
  const title = productionLogSummary(section.title);
  const details = memoryDetails(body);
  const summary = productionLogSummary(memorySummary(section.title, body));
  if (!summary) return null;
  return {
    action: "logged",
    details,
    id: `memory:${agentId}:${date}:${index}:${section.title}`,
    agentId,
    message: body,
    result: summary,
    runtime: "memory",
    status: memoryStatus(section.title, body),
    label: title || "Memory note",
    summary,
    timestamp: memoryTimestamp(date, section.title),
    source: "workspace-memory",
  };
}

function memorySummary(title: string, body: string) {
  const commentCount = body.match(/comment link:/gi)?.length ?? 0;
  const visibility = body.match(/visibility:\s*([^\n]+)/i)?.[1]?.trim();
  const subreddit = body.match(/subreddit:\s*([^\n]+)/i)?.[1]?.trim();
  const thread = body.match(/thread:\s*([^\n]+)/i)?.[1]?.trim();
  const notes = body.match(/notes:\s*([^\n]+)/i)?.[1]?.trim();

  if (commentCount > 1) {
    return `${title}: ${commentCount} comments logged${visibility ? `, ${visibility}` : ""}.`;
  }
  if (commentCount === 1) {
    const target = [subreddit, thread].filter(Boolean).join(" - ");
    return `${title}: posted 1 Reddit comment${target ? ` in ${target}` : ""}${visibility ? `, ${visibility}` : ""}${notes ? `. ${notes}` : ""}`;
  }

  const bullets = body
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean)
    .filter((line) => !/^links?:/i.test(line));
  return `${title}: ${bullets.slice(0, 3).join("; ")}`;
}

function memoryDetails(body: string) {
  const links = Array.from(body.matchAll(/(?:comment link|thread link):\s*(https?:\/\/\S+)/gi)).map((match) => match[1]);
  return links.slice(0, 3).join(" / ");
}

function memoryStatus(title: string, body: string) {
  const text = `${title}\n${body}`.toLowerCase();
  if (text.includes("failed") || text.includes("error")) return "failed";
  if (text.includes("verified") || text.includes("visible") || text.includes("done") || text.includes("posted")) return "done";
  return "logged";
}

function memoryTimestamp(date: string, title: string) {
  const time = title.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const iso = time ? `${date}T${time[1].padStart(2, "0")}:${time[2]}:00` : `${date}T12:00:00`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function listRecentSessionFiles(agentId: string, sessionsDirectory: string) {
  try {
    const entries = await readdir(sessionsDirectory, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => {
          if (!entry.isFile()) return false;
          if (!entry.name.endsWith(".jsonl")) return false;
          if (entry.name.includes(".trajectory") || entry.name.includes(".checkpoint")) return false;
          if (entry.name.includes(".deleted.")) return false;
          return true;
        })
        .map(async (entry) => {
          const filePath = path.join(sessionsDirectory, entry.name);
          const fileStat = await stat(filePath);
          return { agentId, filePath, mtimeMs: fileStat.mtimeMs };
        }),
    );
    return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 8);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readSessionFileEvents(agentId: string, filePath: string): Promise<ActivityEvent[]> {
  const content = await readFile(filePath, "utf8");
  const events: ActivityEvent[] = [];
  let currentSlack: { channel: string; sender: string; messageId: string; text: string } | null = null;

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = safeJson(line) as Record<string, unknown> | null;
    if (!parsed || parsed.type !== "message") continue;
    const message = parsed.message;
    if (!message || typeof message !== "object") continue;

    const record = message as Record<string, unknown>;
    const role = typeof record.role === "string" ? record.role : "";
    const timestamp = numericTimestamp(record.timestamp ?? parsed.timestamp);

    if (role === "user") {
      const text = sessionMessageText(record);
      const slack = parseSlackMessage(text);
      if (!slack) continue;
      currentSlack = slack;
      events.push({
        action: "received",
        details: `${slack.channel} / from ${slack.sender}`,
        id: `session:${agentId}:${slack.messageId || String(parsed.id || timestamp)}:in`,
        agentId,
        message: slack.text,
        result: "",
        runtime: "slack",
        status: "incoming",
        label: slack.channel,
        summary: productionLogSummary(slack.text),
        timestamp,
        source: "session-history",
      });
      continue;
    }

    if (role === "assistant" && currentSlack) {
      const text = assistantFinalText(record);
      if (!text) continue;
      const summary = productionLogSummary(text.replace(/^\[\[reply_to_current\]\]\s*/i, ""));
      if (!summary) continue;
      events.push({
        action: "replied",
        details: `${currentSlack.channel} / reply to ${currentSlack.sender}`,
        id: `session:${agentId}:${String(parsed.id || timestamp)}:out`,
        agentId,
        message: summary,
        result: summary,
        runtime: "slack",
        status: "replied",
        label: currentSlack.channel,
        summary,
        timestamp,
        source: "session-history",
      });
    }
  }

  return events;
}

function sessionMessageText(record: Record<string, unknown>) {
  const content = record.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const item = part as Record<string, unknown>;
      return item.type === "text" && typeof item.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function assistantFinalText(record: Record<string, unknown>) {
  const content = record.content;
  if (!Array.isArray(content)) return "";
  const textParts = content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const item = part as Record<string, unknown>;
      if (item.type !== "text" || typeof item.text !== "string") return "";
      return item.text;
    })
    .filter(Boolean);
  return textParts.join("\n\n");
}

function parseSlackMessage(text: string) {
  const match = text.match(/System:\s*\[[^\]]+\]\s*Slack message in\s+(.+?)\s+from\s+(.+?):\s*([\s\S]*?)(?:\n\nConversation info|\n\nSender|\n\n\[Bootstrap|$)/);
  if (!match) return null;
  const messageId = text.match(/"message_id":\s*"([^"]+)"/)?.[1] || "";
  return {
    channel: match[1].trim(),
    sender: match[2].trim(),
    text: match[3].trim(),
    messageId,
  };
}

function hasRicherSessionEvent(command: ActivityEvent, sessionEvents: ActivityEvent[]) {
  if (command.source !== "commands.log" || command.message) return false;
  if (command.status !== "new") return false;
  return sessionEvents.some(
    (event) =>
      event.agentId === command.agentId &&
      event.status === "incoming" &&
      Math.abs(event.timestamp - command.timestamp) < 15 * 60_000,
  );
}

function dedupeActivityEvents(events: ActivityEvent[]) {
  const seen = new Set<string>();
  const unique: ActivityEvent[] = [];
  for (const event of events) {
    const key = `${event.source}:${event.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(event);
  }
  return unique;
}

async function readIdentity(workspace: string, agent: AgentConfig): Promise<AgentIdentity> {
  const fallback = {
    name: agent.name || agent.id,
    emoji: "◎",
    vibe: "",
    role: "",
    description: "",
  };

  try {
    const content = await readFile(path.join(workspace, "IDENTITY.md"), "utf8");
    const fields = parseIdentityFields(content);
    return {
      name: fields.name || fallback.name,
      emoji: fields.emoji || fallback.emoji,
      vibe: fields.vibe || "",
      role: fields.role || "",
      description: fields.description || "",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

function agentFromSession(value: unknown) {
  if (typeof value !== "string") return "system";
  const match = value.match(/agent:([^:]+)/);
  return match?.[1] || "system";
}

function numericTimestamp(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function compactSummary(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 520);
}

function productionLogSummary(value: string) {
  const clean = value
    .replace(/<[^>]+>/g, " ")
    .replace(/```[^`]*```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s*[-*]\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return "";

  const firstStrongSentence = clean.match(/^(.{80,360}?[.!?])\s/);
  return compactSummary(firstStrongSentence?.[1] || clean);
}

function firstString(input: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function parseIdentityFields(content: string) {
  const fields: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*-\s+\*\*([^*]+):\*\*\s*(.*)\s*$/);
    if (match) {
      fields[match[1].trim().toLowerCase()] = match[2].trim();
    }
  }
  return fields;
}

function isOrgChartNode(value: unknown): value is OrgChartNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  return typeof node.agentId === "string" && typeof node.x === "number" && typeof node.y === "number";
}

type SkillRoot = {
  directory: string;
  scope: string;
};

function sharedSkillRoots(config: OpenClawConfig): SkillRoot[] {
  return [
    ...extraSkillRoots(config),
    { directory: path.join(stateDir, "skills"), scope: "Managed" },
    { directory: path.join(os.homedir(), ".agents", "skills"), scope: "Personal" },
  ];
}

function workspaceSkillRoots(workspace: string): SkillRoot[] {
  return [
    { directory: path.join(workspace, "skills"), scope: "Workspace" },
  ];
}

function extraSkillRoots(config: OpenClawConfig): SkillRoot[] {
  const skills = config.skills;
  if (!skills || typeof skills !== "object") return [];
  const load = (skills as { load?: unknown }).load;
  if (!load || typeof load !== "object") return [];
  const extraDirs = (load as { extraDirs?: unknown }).extraDirs;
  if (!Array.isArray(extraDirs)) return [];
  return extraDirs
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((directory) => ({ directory, scope: "Extra" }));
}

async function listSkillDirectories(root: string | SkillRoot) {
  const rootDirectory = typeof root === "string" ? root : root.directory;
  try {
    const entries = await readdir(rootDirectory, { withFileTypes: true });
    const directories: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const directory = path.join(rootDirectory, entry.name);
      if (await fileExists(path.join(directory, "SKILL.md"))) directories.push(directory);
    }
    return directories;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readSkillSummary(directory: string, root: SkillRoot, entries: Record<string, { enabled?: unknown }>): Promise<SkillSummary> {
  const content = await readFile(path.join(directory, "SKILL.md"), "utf8");
  const metadata = parseSkillMetadata(content);
  const fallbackName = path.basename(directory);
  const name = metadata.name || fallbackName;
  const source = path.relative(stateDir, root.directory).replaceAll(path.sep, "/") || root.directory;
  return {
    id: skillIdFromDirectory(directory),
    name,
    description: metadata.description,
    directory,
    source,
    scope: root.scope,
    enabled: entries[name]?.enabled !== false && entries[fallbackName]?.enabled !== false,
    agents: [],
    installedAgents: [],
    files: await listSkillMarkdownFiles(directory),
  };
}

async function listSkillMarkdownFiles(directory: string) {
  const files: string[] = [];
  async function walk(current: string, depth: number) {
    if (depth > 4 || files.length >= 200) return;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(path.relative(directory, absolute).replaceAll(path.sep, "/"));
      }
    }
  }
  await walk(directory, 0);
  return files.sort((a, b) => {
    if (a === "SKILL.md") return -1;
    if (b === "SKILL.md") return 1;
    return a.localeCompare(b);
  });
}

function parseSkillMetadata(content: string) {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const metadata = { name: "", description: "" };
  if (!frontmatter) return metadata;
  for (const line of frontmatter[1].split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].toLowerCase();
    const value = match[2].replace(/^["']|["']$/g, "").trim();
    if (key === "name") metadata.name = value;
    if (key === "description") metadata.description = value;
  }
  return metadata;
}

function readSkillEntries(config: OpenClawConfig) {
  const skills = config.skills;
  if (!skills || typeof skills !== "object") return {};
  const entries = (skills as { entries?: unknown }).entries;
  if (!entries || typeof entries !== "object") return {};
  return entries as Record<string, { enabled?: unknown }>;
}

function readSkillAllowlist(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const skills = (input as { skills?: unknown }).skills;
  if (!Array.isArray(skills)) return null;
  return new Set(skills.filter((skill): skill is string => typeof skill === "string"));
}

async function getSkillById(skillId: string) {
  const { skills } = await listSkills();
  const skill = skills.find((item) => item.id === skillId);
  if (!skill) throw new HttpError(404, `Unknown skill: ${skillId}`);
  return skill;
}

function skillIdFromDirectory(directory: string) {
  return Buffer.from(directory).toString("base64url");
}

function normalizeSkillFile(skillDirectory: string, fileName: string) {
  const normalizedRelative = fileName.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalizedRelative || !normalizedRelative.toLowerCase().endsWith(".md")) {
    throw new HttpError(400, "Only markdown files in skill folders are editable");
  }
  const absolute = path.resolve(skillDirectory, normalizedRelative);
  const relative = path.relative(skillDirectory, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new HttpError(400, "Skill file must stay inside the skill directory");
  }
  return {
    absolute,
    relative: relative.replaceAll(path.sep, "/"),
  };
}

function readPrimaryModel(defaults: Record<string, unknown>) {
  const model = defaults.model;
  if (model && typeof model === "object" && "primary" in model) {
    const primary = (model as { primary?: unknown }).primary;
    if (typeof primary === "string") return primary;
  }
  return "default";
}

function assertEditableFile(fileName: string) {
  if (!editableFileSet.has(fileName)) {
    throw new HttpError(400, `File is not editable from mission control: ${fileName}`);
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

async function backupFile(filePath: string) {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await copyFile(filePath, `${filePath}.mission-control-${stamp}.bak`);
}

async function atomicWrite(filePath: string, content: string) {
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, filePath);
}

async function fileExists(filePath: string) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function safeJson(input: string) {
  if (!input.trim()) return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function toKebab(input: string) {
  return input.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function jsonError(error: unknown) {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Unknown error";
  return Response.json({ error: message }, { status: 500 });
}
