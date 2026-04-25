"use client";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Form,
  Input,
  Pagination,
  Spinner,
  Table,
  Tabs,
  TextArea,
  toast,
} from "@heroui/react";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, useTransition } from "react";

type Section = "overview" | "schedules" | "files" | "skills" | "activity";

type Heartbeat = {
  every?: string;
  activeHours?: { start?: string; end?: string };
  model?: string;
  target?: string;
};

type Agent = {
  id: string;
  name?: string;
  workspace: string;
  model: string;
  default?: boolean;
  heartbeat?: Heartbeat;
  identity: {
    name: string;
    emoji: string;
    vibe: string;
    role: string;
    description: string;
  };
  bindings: { match?: { channel?: string; accountId?: string } }[];
  files: { name: string; exists: boolean }[];
};

type CronJob = Record<string, unknown> & {
  id?: string;
  name?: string;
  description?: string;
  agent?: string;
  agentId?: string;
  disabled?: boolean;
  enabled?: boolean;
};

type ActivityEvent = {
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

type SkillSummary = {
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

type OrgChartNode = {
  agentId: string;
  parentId?: string;
  x: number;
  y: number;
};

type AgentNodeData = {
  agent: Agent;
};

type AgentFlowNode = Node<AgentNodeData, "agent">;
type AgentFlowEdge = Edge<Record<string, never>, "smoothstep">;

const nodeTypes = {
  agent: AgentFlowNodeComponent,
};

const editableFiles = [
  "IDENTITY.md",
  "SOUL.md",
  "USER.md",
  "MEMORY.md",
  "TOOLS.md",
  "AGENTS.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
];

const emptyCronForm = {
  name: "",
  description: "",
  agent: "",
  message: "",
  every: "",
  cron: "",
  at: "",
  tz: "Europe/Rome",
  model: "",
  channel: "last",
  wake: "now",
};

type CronForm = typeof emptyCronForm;

const schedulePresets: {
  id: string;
  label: string;
  description: string;
  fields: Partial<CronForm>;
}[] = [
  { id: "30m", label: "Every 30 minutes", description: "Frequent follow-up", fields: { every: "30m" } },
  { id: "hourly", label: "Every hour", description: "Regular check-in", fields: { every: "1h" } },
  { id: "morning", label: "Every morning", description: "Daily at 9:00", fields: { cron: "0 9 * * *", tz: "Europe/Rome" } },
  { id: "weekdays", label: "Weekdays", description: "Mon-Fri at 9:00", fields: { cron: "0 9 * * 1-5", tz: "Europe/Rome" } },
  { id: "later", label: "Once later", description: "Runs once in 2 hours", fields: { at: "+2h" } },
];

const sectionLabels: Record<Section, string> = {
  overview: "Agents org chart",
  schedules: "Schedules",
  files: "Main files",
  skills: "Skills",
  activity: "Activity",
};

const workspaceNav: { id: Section; label: string; icon: SidebarIconName }[] = [
  { id: "overview", label: "Agents org chart", icon: "overview" },
  { id: "schedules", label: "Schedules", icon: "schedules" },
  { id: "files", label: "Main files", icon: "files" },
  { id: "skills", label: "Skills", icon: "skills" },
  { id: "activity", label: "Activity", icon: "activity" },
];
const sectionIds = new Set<Section>(workspaceNav.map((item) => item.id));

type SidebarIconName = "overview" | "schedules" | "files" | "skills" | "activity";

export function MissionControl() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [crons, setCrons] = useState<CronJob[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [orgChartNodes, setOrgChartNodes] = useState<OrgChartNode[]>([]);
  const [cronError, setCronError] = useState("");
  const [activityError, setActivityError] = useState("");
  const [skillsError, setSkillsError] = useState("");
  const [activityUpdatedAt, setActivityUpdatedAt] = useState("");
  const [activeSection, setActiveSection] = useState<Section>("overview");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedFile, setSelectedFile] = useState("IDENTITY.md");
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [selectedSkillFile, setSelectedSkillFile] = useState("SKILL.md");
  const [fileContent, setFileContent] = useState("");
  const [fileDirty, setFileDirty] = useState(false);
  const [skillContent, setSkillContent] = useState("");
  const [skillDirty, setSkillDirty] = useState(false);
  const [cronForm, setCronForm] = useState(emptyCronForm);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0];
  const selectedAgentFileId = selectedAgent?.id ?? "";
  const selectedAgentSkills = useMemo(
    () => selectedAgent ? skills.filter((skill) => skill.installedAgents.includes(selectedAgent.id)) : [],
    [selectedAgent, skills],
  );
  const selectedSkill = selectedAgentSkills.find((skill) => skill.id === selectedSkillId);
  const selectedSkillIdForFile = selectedSkill?.id ?? "";
  const selectedSkillFileName = selectedSkill?.files.includes(selectedSkillFile)
    ? selectedSkillFile
    : selectedSkill?.files[0] || "SKILL.md";

  const cronsByAgent = useMemo(() => {
    const grouped = new Map<string, CronJob[]>();
    for (const agent of agents) grouped.set(agent.id, []);
    grouped.set("unassigned", []);
    for (const cron of crons) {
      const agentId = getCronAgentId(cron);
      const key = agentId && grouped.has(agentId) ? agentId : "unassigned";
      grouped.get(key)?.push(cron);
    }
    return grouped;
  }, [agents, crons]);

  const loadFile = useCallback(async (agentId: string, fileName: string, signal?: AbortSignal) => {
    try {
      const response = await fetch(
        `/api/agents/${encodeURIComponent(agentId)}/files/${encodeURIComponent(fileName)}`,
        { cache: "no-store", signal },
      );
      const payload = await response.json();
      if (!response.ok) {
        toast.danger("Failed to load file", { description: payload.error || fileName });
        return;
      }
      setFileContent(payload.content);
      setFileDirty(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.danger("Failed to load file", { description: fileName });
    }
  }, []);

  const loadSkillFile = useCallback(async (skillId: string, fileName: string, signal?: AbortSignal) => {
    try {
      const response = await fetch(
        `/api/skills/${encodeURIComponent(skillId)}/files?file=${encodeURIComponent(fileName)}`,
        { cache: "no-store", signal },
      );
      const payload = await response.json();
      if (!response.ok) {
        toast.danger("Failed to load skill file", { description: payload.error || fileName });
        return;
      }
      setSkillContent(payload.content);
      setSkillDirty(false);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.danger("Failed to load skill file", { description: fileName });
    }
  }, []);

  const refreshActivity = useCallback(async () => {
    try {
      const response = await fetch("/api/activity", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to load activity");
      setActivity(Array.isArray(payload.events) ? payload.events : []);
      setActivityError(payload.error || "");
      setActivityUpdatedAt(payload.updatedAt || "");
    } catch (error) {
      setActivityError(error instanceof Error ? error.message : "Failed to load activity");
    }
  }, []);

  const refreshAll = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const [agentResponse, cronResponse, activityResponse, orgChartResponse, skillsResponse] = await Promise.all([
        fetch("/api/agents", { cache: "no-store" }),
        fetch("/api/crons", { cache: "no-store" }),
        fetch("/api/activity", { cache: "no-store" }),
        fetch("/api/org-chart", { cache: "no-store" }),
        fetch("/api/skills", { cache: "no-store" }),
      ]);
      const agentPayload = await agentResponse.json();
      const cronPayload = await cronResponse.json();
      const activityPayload = await activityResponse.json();
      const orgChartPayload = await orgChartResponse.json();
      const skillsPayload = await skillsResponse.json();
      if (!agentResponse.ok) throw new Error(agentPayload.error || "Failed to load agents");
      setAgents(agentPayload.agents);
      setCrons(Array.isArray(cronPayload.crons) ? cronPayload.crons : []);
      setCronError(cronPayload.error || "");
      setActivity(Array.isArray(activityPayload.events) ? activityPayload.events : []);
      setActivityError(activityPayload.error || "");
      setActivityUpdatedAt(activityPayload.updatedAt || "");
      setOrgChartNodes(Array.isArray(orgChartPayload.nodes) ? orgChartPayload.nodes : []);
      setSkills(Array.isArray(skillsPayload.skills) ? skillsPayload.skills : []);
      setSkillsError(skillsResponse.ok ? "" : skillsPayload.error || "Failed to load skills");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load mission control";
      if (showLoading) toast.danger("Clawcenter failed to load", { description: message });
      else setActivityError(message);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const section = params.get("section");
    if (params.get("screenshot") === "1") setAutoRefresh(false);
    if (isSection(section)) setActiveSection(section);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void refreshAll(false), 15_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refreshAll]);

  useEffect(() => {
    if (!selectedAgentFileId) return;
    const controller = new AbortController();
    void loadFile(selectedAgentFileId, selectedFile, controller.signal);
    return () => controller.abort();
  }, [loadFile, selectedAgentFileId, selectedFile]);

  useEffect(() => {
    if (!selectedSkillIdForFile) return;
    const controller = new AbortController();
    void loadSkillFile(selectedSkillIdForFile, selectedSkillFileName, controller.signal);
    return () => controller.abort();
  }, [loadSkillFile, selectedSkillFileName, selectedSkillIdForFile]);

  function saveFile() {
    if (!selectedAgent) return;
    startTransition(async () => {
      const response = await fetch(
        `/api/agents/${encodeURIComponent(selectedAgent.id)}/files/${encodeURIComponent(selectedFile)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: fileContent }),
        },
      );
      const payload = await response.json();
      if (response.ok) toast.success(`Saved ${selectedFile}`);
      else toast.danger("Save failed", { description: payload.error });
      if (response.ok) {
        setFileDirty(false);
        await refreshAll();
      }
    });
  }

  function saveSkillFile() {
    if (!selectedSkill) return;
    startTransition(async () => {
      const response = await fetch(`/api/skills/${encodeURIComponent(selectedSkill.id)}/files`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: selectedSkillFileName, content: skillContent }),
      });
      const payload = await response.json();
      if (response.ok) toast.success(`Saved ${selectedSkillFileName}`);
      else toast.danger("Skill save failed", { description: payload.error });
      if (response.ok) {
        setSkillDirty(false);
        await refreshAll(false);
      }
    });
  }

  function selectSkill(skillId: string) {
    setSelectedSkillId(skillId);
    setSelectedSkillFile("SKILL.md");
  }

  function createCron() {
    startTransition(async () => {
      const cronPayload = cleanPayload({ ...cronForm, agent: cronForm.agent || selectedAgent?.id || "" });
      const response = await fetch("/api/crons", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cronPayload),
      });
      const payload = await response.json();
      if (response.ok) toast.success("Cron created");
      else toast.danger("Cron create failed", { description: payload.error });
      if (response.ok) {
        setCronForm({ ...emptyCronForm, agent: selectedAgent?.id || "" });
        await refreshAll();
      }
    });
  }

  async function saveOrgChart(nodes: OrgChartNode[], options?: { silent?: boolean }) {
    const response = await fetch("/api/org-chart", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodes }),
    });
    const payload = await response.json();
    if (response.ok) {
      setOrgChartNodes(payload.nodes);
      if (!options?.silent) toast.success("Org chart saved");
    } else {
      toast.danger("Org chart save failed", { description: payload.error });
    }
  }

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <Card>
          <CardContent className="flex items-center gap-3">
            <Spinner color="accent" />
            <span>Loading Clawcenter...</span>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <MissionShell
      activeSection={activeSection}
      autoRefresh={autoRefresh}
      onAutoRefreshChange={setAutoRefresh}
      onRefresh={() => void refreshAll()}
      onSectionChange={(section) => {
        setActiveSection(section);
        const url = new URL(window.location.href);
        url.searchParams.set("section", section);
        window.history.replaceState(null, "", url);
      }}
    >
          {activeSection === "overview" ? (
          <Overview
            agents={agents}
            selectedAgentId={selectedAgent?.id}
            nodes={orgChartNodes}
            onSelectAgent={(id) => {
              setSelectedAgentId(id);
            }}
            onSaveChart={saveOrgChart}
          />
          ) : null}

          {activeSection === "schedules" ? (
          <Schedules
            agents={agents}
            cronsByAgent={cronsByAgent}
            cronError={cronError}
            cronForm={cronForm}
            isPending={isPending}
            onCronFormChange={setCronForm}
            onCreateCron={createCron}
            onRefresh={refreshAll}
          />
          ) : null}

          {activeSection === "files" ? (
          <FilesPanel
            agents={agents}
            agent={selectedAgent}
            selectedFile={selectedFile}
            fileContent={fileContent}
            fileDirty={fileDirty}
            onAgentSelect={setSelectedAgentId}
            isPending={isPending}
            onFileSelect={setSelectedFile}
            onContentChange={(content) => {
              setFileContent(content);
              setFileDirty(true);
            }}
            onSave={saveFile}
          />
          ) : null}

          {activeSection === "skills" ? (
          <SkillsPanel
            agent={selectedAgent}
            agents={agents}
            allSkills={skills}
            isPending={isPending}
            selectedSkill={selectedSkill}
            selectedSkillFile={selectedSkillFileName}
            skillContent={skillContent}
            skillDirty={skillDirty}
            skills={selectedAgentSkills}
            skillsError={skillsError}
            onAgentSelect={setSelectedAgentId}
            onContentChange={(content) => {
              setSkillContent(content);
              setSkillDirty(true);
            }}
            onFileSelect={setSelectedSkillFile}
            onSave={saveSkillFile}
            onSkillClose={() => setSelectedSkillId("")}
            onSkillSelect={selectSkill}
          />
          ) : null}

          {activeSection === "activity" ? (
          <ActivityFeed agents={agents} events={activity} error={activityError} updatedAt={activityUpdatedAt} onRefresh={refreshActivity} />
          ) : null}
    </MissionShell>
  );
}

function isSection(value: string | null): value is Section {
  return Boolean(value && sectionIds.has(value as Section));
}

function MissionShell({
  activeSection,
  autoRefresh,
  children,
  onAutoRefreshChange,
  onRefresh,
  onSectionChange,
}: {
  activeSection: Section;
  autoRefresh: boolean;
  children: React.ReactNode;
  onAutoRefreshChange: (enabled: boolean) => void;
  onRefresh: () => void;
  onSectionChange: (section: Section) => void;
}) {
  return (
    <main className="grid min-h-screen grid-cols-[250px_minmax(0,1fr)] bg-background text-foreground max-lg:grid-cols-1">
      <SidebarNav
        activeSection={activeSection}
        onSectionChange={onSectionChange}
      />
      <section className="grid min-w-0 content-start">
        <TopBar
          activeSection={activeSection}
          autoRefresh={autoRefresh}
          onAutoRefreshChange={onAutoRefreshChange}
          onRefresh={onRefresh}
        />
        <div className="grid gap-0">{children}</div>
      </section>
    </main>
  );
}

function SidebarNav({
  activeSection,
  onSectionChange,
}: {
  activeSection: Section;
  onSectionChange: (section: Section) => void;
}) {
  return (
    <aside className="sticky top-0 flex h-screen flex-col border-r border-border bg-background p-3 max-lg:static max-lg:h-auto max-lg:border-b max-lg:border-r-0">
      <div className="grid flex-1 content-start gap-6 max-lg:gap-3">
        <div className="flex items-center justify-between gap-2 px-2 py-2">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-widest text-muted">OpenClaw</p>
            <h1 className="truncate text-sm font-semibold">Clawcenter</h1>
          </div>
          <ThemeToggle compact />
        </div>

        <nav className="grid gap-1" aria-label="Workspace">
          <p className="px-2 text-xs font-medium text-muted">Workspace</p>
          <div className="grid gap-1 max-lg:flex max-lg:overflow-x-auto max-lg:pb-1">
            {workspaceNav.map((item) => (
              <SidebarNavItem
                key={item.id}
                icon={item.icon}
                isActive={activeSection === item.id}
                onSelect={() => onSectionChange(item.id)}
              >
                {item.label}
              </SidebarNavItem>
            ))}
          </div>
        </nav>
      </div>
    </aside>
  );
}

function SidebarNavItem({
  children,
  icon,
  isActive,
  onSelect,
}: {
  children: React.ReactNode;
  icon: SidebarIconName;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`flex h-9 items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-default max-lg:shrink-0 ${
        isActive ? "bg-default font-medium text-foreground" : "text-muted"
      }`}
      type="button"
      onClick={onSelect}
    >
      <SidebarIcon name={icon} isActive={isActive} />
      <span className="truncate">{children}</span>
    </button>
  );
}

function SidebarIcon({ isActive, name }: { isActive: boolean; name: SidebarIconName }) {
  return (
    <span
      className={`grid size-6 shrink-0 place-items-center rounded-lg border border-border bg-surface ${
        isActive ? "text-foreground" : "text-muted"
      }`}
    >
      <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
        {name === "overview" ? (
          <>
            <path d="M5 5h6v6H5z" />
            <path d="M13 5h6v6h-6z" />
            <path d="M5 13h6v6H5z" />
            <path d="M13 13h6v6h-6z" />
          </>
        ) : null}
        {name === "schedules" ? (
          <>
            <path d="M7 3v3" />
            <path d="M17 3v3" />
            <path d="M4.5 8.5h15" />
            <path d="M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
            <path d="M12 12v4l3 1.5" />
          </>
        ) : null}
        {name === "files" ? (
          <>
            <path d="M7 3.5h6l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 19z" />
            <path d="M13 3.5V8h4" />
            <path d="M9.5 12h5" />
            <path d="M9.5 15h5" />
          </>
        ) : null}
        {name === "skills" ? (
          <>
            <path d="M7.5 4.5h9l3 3v12h-15v-15z" />
            <path d="M16.5 4.5V8h3" />
            <path d="M8.5 12h7" />
            <path d="M8.5 15h5" />
            <path d="M7 20.5h10" />
          </>
        ) : null}
        {name === "activity" ? (
          <>
            <path d="M4 13h4l2-6 4 10 2-5h4" />
            <path d="M4 19h16" />
          </>
        ) : null}
      </svg>
    </span>
  );
}

function TopBar({
  activeSection,
  autoRefresh,
  onAutoRefreshChange,
  onRefresh,
}: {
  activeSection: Section;
  autoRefresh: boolean;
  onAutoRefreshChange: (enabled: boolean) => void;
  onRefresh: () => void;
}) {
  return (
    <header className="flex min-h-14 items-center justify-between gap-4 border-b border-border px-4 max-md:grid max-md:py-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-sm text-muted">Views</span>
        <span className="text-muted">/</span>
        <h2 className="truncate text-sm font-semibold">{sectionLabels[activeSection]}</h2>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 max-md:justify-start">
        <Button className="max-sm:flex-1" size="sm" variant="tertiary" onPress={() => onAutoRefreshChange(!autoRefresh)}>
          {autoRefresh ? "Auto refresh on" : "Auto refresh off"}
        </Button>
        <Button className="max-sm:flex-1" size="sm" variant="secondary" onPress={onRefresh}>Refresh</Button>
      </div>
    </header>
  );
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 overflow-hidden bg-background ${className}`}>
      {children}
    </section>
  );
}

function PageColumns({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-[calc(100vh-3.5rem)] grid-cols-[300px_minmax(0,1fr)] max-lg:min-h-0 max-lg:grid-cols-1">
      {children}
    </div>
  );
}

function SectionSidebar({
  bodyClassName = "",
  children,
  eyebrow,
  title,
}: {
  bodyClassName?: string;
  children: React.ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <Panel className="border-r border-border max-lg:border-r-0 max-lg:border-b">
      <PanelHeader eyebrow={eyebrow} title={title} />
      <PanelBody className={`grid gap-6 max-lg:max-h-[320px] max-lg:overflow-auto ${bodyClassName}`}>
        {children}
      </PanelBody>
    </Panel>
  );
}

function SidebarSectionGroup({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="grid gap-2">
      <p className="text-xs font-medium uppercase tracking-widest text-muted">{title}</p>
      <div className="grid gap-1">{children}</div>
    </div>
  );
}

function PanelHeader({
  actions,
  eyebrow,
  title,
}: {
  actions?: React.ReactNode;
  eyebrow?: string;
  title: React.ReactNode;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-3 max-sm:grid">
      <div className="min-w-0">
        {eyebrow ? <p className="text-xs font-medium uppercase tracking-widest text-muted">{eyebrow}</p> : null}
        <h3 className="truncate text-sm font-semibold">{title}</h3>
      </div>
      {actions ? <div className="shrink-0 max-sm:min-w-0">{actions}</div> : null}
    </div>
  );
}

function PanelBody({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}

function SelectableRow({
  children,
  isActive,
  meta,
  onSelect,
}: {
  children: React.ReactNode;
  isActive: boolean;
  meta?: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      className={`flex min-h-9 w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-default ${
        isActive ? "bg-default text-foreground" : "text-muted"
      }`}
      type="button"
      onClick={onSelect}
    >
      <span className="min-w-0 truncate font-medium">{children}</span>
      {meta ? <span className="shrink-0 text-xs text-muted">{meta}</span> : null}
    </button>
  );
}

function AgentRows({
  agents,
  getMeta,
  onSelect,
  selectedAgentId,
}: {
  agents: Agent[];
  getMeta?: (agent: Agent) => React.ReactNode;
  onSelect: (agentId: string) => void;
  selectedAgentId: string;
}) {
  return (
    <div className="grid gap-1">
      {agents.map((agent) => (
        <SelectableRow
          key={agent.id}
          isActive={agent.id === selectedAgentId}
          meta={getMeta?.(agent)}
          onSelect={() => onSelect(agent.id)}
        >
          {agent.identity.emoji} {agent.identity.name}
        </SelectableRow>
      ))}
    </div>
  );
}

type ThemeName = "light" | "dark";

const THEME_STORAGE_KEY = "heroui-theme";

function normalizeTheme(value: string | null | undefined): ThemeName {
  return value === "light" ? "light" : "dark";
}

function getThemeSnapshot(): ThemeName {
  if (typeof document === "undefined") return "dark";
  return normalizeTheme(document.documentElement.dataset.theme);
}

function getServerThemeSnapshot(): ThemeName {
  return "dark";
}

function subscribeTheme(callback: () => void) {
  if (typeof document === "undefined" || typeof window === "undefined") return () => {};
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  window.addEventListener("storage", callback);
  return () => {
    observer.disconnect();
    window.removeEventListener("storage", callback);
  };
}

function applyTheme(nextTheme: ThemeName) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.add(nextTheme);
  document.documentElement.dataset.theme = nextTheme;
  window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
}

function initializeStoredTheme() {
  if (typeof window === "undefined") return;
  applyTheme(normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY)));
}

initializeStoredTheme();

function useThemeSnapshot() {
  return useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
}

function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useThemeSnapshot();

  return (
    <Button
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="text-foreground"
      isIconOnly={compact}
      size="sm"
      variant="secondary"
      onPress={() => applyTheme(theme === "dark" ? "light" : "dark")}
    >
      <ThemeIcon theme={theme} />
      {!compact ? <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span> : null}
    </Button>
  );
}

function ThemeIcon({ theme }: { theme: ThemeName }) {
  return (
    <svg aria-hidden="true" className="size-4 text-foreground" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
      {theme === "dark" ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </>
      ) : (
        <path d="M20.5 14.5A7.5 7.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5z" />
      )}
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </svg>
  );
}

function ChevronIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`size-4 transition-transform ${isOpen ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function Overview({ agents, selectedAgentId, nodes, onSelectAgent, onSaveChart }: { agents: Agent[]; selectedAgentId?: string; nodes: OrgChartNode[]; onSelectAgent: (agentId: string) => void; onSaveChart: (nodes: OrgChartNode[], options?: { silent?: boolean }) => Promise<void> }) {
  const [chartLayout, setChartLayout] = useState<OrgChartNode[]>([]);
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<AgentFlowNode>([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<AgentFlowEdge>([]);
  const [editingAgentId, setEditingAgentId] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const flowColorMode = useThemeSnapshot();
  const editingAgent = agents.find((agent) => agent.id === editingAgentId);
  const editingLayout = chartLayout.find((node) => node.agentId === editingAgentId);

  useEffect(() => {
    const savedNodes = new Map(nodes.map((node) => [node.agentId, node]));
    const nextLayout = agents.map((agent, index) => savedNodes.get(agent.id) ?? defaultOrgNode(agent.id, index));
    setChartLayout(nextLayout);
    setFlowNodes(nextLayout.map((layout): AgentFlowNode => {
      const agent = agents.find((item) => item.id === layout.agentId) ?? agents[0];
      return {
        id: agent.id,
        type: "agent",
        position: { x: layout.x, y: layout.y },
        data: { agent },
        selected: selectedAgentId === agent.id,
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      };
    }));
    setFlowEdges(nextLayout.flatMap((layout) => {
      if (!layout.parentId) return [];
      return [{
        id: `${layout.parentId}:${layout.agentId}`,
        source: layout.parentId,
        target: layout.agentId,
        sourceHandle: "source-bottom",
        targetHandle: "target-top",
        type: "smoothstep",
        style: { strokeWidth: 2 },
        data: {},
      } satisfies AgentFlowEdge];
    }));
  }, [agents, nodes, selectedAgentId, setFlowEdges, setFlowNodes]);

  function currentChartNodes() {
    return flowNodes.map((node) => ({
      agentId: node.id,
      parentId: chartLayout.find((layout) => layout.agentId === node.id)?.parentId,
      x: node.position.x,
      y: node.position.y,
    }));
  }

  async function autosavePosition(node: AgentFlowNode) {
    const next = currentChartNodes().map((item) => item.agentId === node.id ? { ...item, x: node.position.x, y: node.position.y } : item);
    await onSaveChart(next, { silent: true });
  }

  function connectAgents(connection: Connection) {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const nextLayout = currentChartNodes().map((node) => node.agentId === connection.target ? { ...node, parentId: connection.source } : node);
    setChartLayout(nextLayout);
    setFlowEdges((current) => addEdge({ ...connection, type: "smoothstep", style: { strokeWidth: 2 }, data: {} }, current.filter((edge) => edge.target !== connection.target)));
    void onSaveChart(nextLayout, { silent: true });
  }

  async function saveAgentFromChart(agentId: string, identity: Agent["identity"]) {
    const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/identity`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(identity),
    });
    const payload = await response.json();
    if (response.ok) {
      toast.success("Agent updated");
      await onSaveChart(currentChartNodes());
      setEditingAgentId("");
    } else {
      toast.danger("Agent update failed", { description: payload.error });
    }
  }

  return (
    <div className="relative h-[calc(100dvh-3.5rem)] min-h-[560px] overflow-hidden bg-background max-md:h-[calc(100dvh-7rem)] max-md:min-h-[520px]">
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={connectAgents}
              onConnectStart={() => setIsConnecting(true)}
              onConnectEnd={() => window.setTimeout(() => setIsConnecting(false), 0)}
              onNodeClick={(_, node) => {
                if (!isConnecting) onSelectAgent(node.id);
              }}
              onNodeDoubleClick={(_, node) => {
                if (!isConnecting) setEditingAgentId(node.id);
              }}
              onNodeDragStop={(_, node) => void autosavePosition(node)}
              onPaneClick={() => {
                if (!isConnecting) setEditingAgentId("");
              }}
              nodesDraggable
              nodesConnectable
              elementsSelectable
              panOnDrag
              connectionLineStyle={{ strokeWidth: 2 }}
              fitView
              fitViewOptions={{ padding: 0.35, maxZoom: 0.9 }}
              minZoom={0.15}
              maxZoom={1.5}
              colorMode={flowColorMode}
              proOptions={{ hideAttribution: true }}
            >
              <Background />
              <Controls />
              <MiniMap pannable zoomable />
            </ReactFlow>
            {editingAgent && editingLayout ? (
              <AgentChartEditor
                key={editingAgent.id}
                agent={editingAgent}
                onClose={() => setEditingAgentId("")}
                onSave={saveAgentFromChart}
              />
            ) : null}
    </div>
  );
}

function AgentChartEditor({
  agent,
  onClose,
  onSave,
}: {
  agent: Agent;
  onClose: () => void;
  onSave: (agentId: string, identity: Agent["identity"]) => Promise<void>;
}) {
  const [draft, setDraft] = useState(agent.identity);

  return (
    <Card className="absolute right-6 top-6 z-10 w-[360px] shadow-overlay max-sm:left-3 max-sm:right-3 max-sm:top-3 max-sm:w-auto">
      <Button
        aria-label="Close agent editor"
        className="absolute right-3 top-3 z-10"
        isIconOnly
        size="sm"
        variant="tertiary"
        onPress={onClose}
      >
        <CloseIcon />
      </Button>
      <CardHeader className="pr-14">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-widest text-muted">Edit agent</p>
          <h3 className="mt-1 truncate text-lg font-semibold">{agent.identity.emoji} {agent.identity.name}</h3>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field label="Name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
        <Field label="Emoji" value={draft.emoji} onChange={(emoji) => setDraft({ ...draft, emoji })} />
        <Field label="Role" value={draft.role} onChange={(role) => setDraft({ ...draft, role })} />
        <TextField label="Description" value={draft.description} className="min-h-[120px]" onChange={(description) => setDraft({ ...draft, description })} />
        <Button variant="primary" onPress={() => void onSave(agent.id, draft)}>Save agent</Button>
      </CardContent>
    </Card>
  );
}

function defaultOrgNode(agentId: string, index: number): OrgChartNode {
  return {
    agentId,
    x: 32 + (index % 3) * 260,
    y: 32 + Math.floor(index / 3) * 150,
  };
}

function AgentFlowNodeComponent({ data, selected, isConnectable }: NodeProps<AgentFlowNode>) {
  const agent = data.agent;
  return (
    <div className={`relative grid w-[240px] gap-2 rounded-xl border border-border bg-surface p-3 text-left shadow-surface transition max-sm:w-[220px] ${selected ? "outline outline-2 outline-focus outline-offset-2" : ""}`}>
      <Handle id="target-top" className="!size-3 !border-2 !border-background !bg-accent" isConnectable={isConnectable} type="target" position={Position.Top} />
      <Handle id="target-left" className="!size-3 !border-2 !border-background !bg-accent" isConnectable={isConnectable} type="target" position={Position.Left} />
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-lg bg-default">{agent.identity.emoji}</span>
        <span className="min-w-0">
          <strong className="block truncate">{agent.identity.name}</strong>
          <span className="block truncate text-sm text-muted">{agent.identity.role || "No role yet"}</span>
        </span>
      </div>
      <p className="line-clamp-2 text-sm text-muted">{agent.model}</p>
      <Handle id="source-right" className="!size-3 !border-2 !border-background !bg-accent" isConnectable={isConnectable} type="source" position={Position.Right} />
      <Handle id="source-bottom" className="!size-3 !border-2 !border-background !bg-accent" isConnectable={isConnectable} type="source" position={Position.Bottom} />
    </div>
  );
}

function Schedules({ agents, cronsByAgent, cronError, cronForm, isPending, onCronFormChange, onCreateCron, onRefresh }: { agents: Agent[]; cronsByAgent: Map<string, CronJob[]>; cronError: string; cronForm: CronForm; isPending: boolean; onCronFormChange: (form: CronForm) => void; onCreateCron: () => void; onRefresh: () => Promise<void> }) {
  const [selectedScheduleAgentId, setSelectedScheduleAgentId] = useState(agents[0]?.id ?? "");
  const selectedAgent = agents.find((agent) => agent.id === selectedScheduleAgentId) ?? agents[0];
  const selectedCrons = selectedAgent ? cronsByAgent.get(selectedAgent.id) ?? [] : [];

  if (!selectedAgent) return null;

  return (
    <PageColumns>
      <SectionSidebar bodyClassName="auto-rows-min content-start gap-2" eyebrow="Schedules" title="Agents">
        {cronError ? <Chip color="danger" variant="soft">Cron list failed: {cronError}</Chip> : null}
        <AgentRows
          agents={agents}
          selectedAgentId={selectedAgent.id}
          getMeta={(agent) => `${cronsByAgent.get(agent.id)?.length ?? 0} jobs`}
          onSelect={(agentId) => {
            setSelectedScheduleAgentId(agentId);
            onCronFormChange({ ...cronForm, agent: agentId });
          }}
        />
      </SectionSidebar>

      <div className="grid content-start">
        <ScheduleTabs
          agent={selectedAgent}
          crons={selectedCrons}
          cronForm={cronForm}
          isPending={isPending}
          onCreateCron={onCreateCron}
          onCronFormChange={onCronFormChange}
          onRefresh={onRefresh}
        />
      </div>
    </PageColumns>
  );
}

function FilesPanel({
  agent,
  agents,
  fileContent,
  fileDirty,
  isPending,
  onAgentSelect,
  onContentChange,
  onFileSelect,
  onSave,
  selectedFile,
}: {
  agent?: Agent;
  agents: Agent[];
  fileContent: string;
  fileDirty: boolean;
  isPending: boolean;
  onAgentSelect: (agentId: string) => void;
  onContentChange: (content: string) => void;
  onFileSelect: (file: string) => void;
  onSave: () => void;
  selectedFile: string;
}) {
  if (!agent) return null;
  return (
    <PageColumns>
      <SectionSidebar eyebrow="Main files" title="Navigator">
        <SidebarSectionGroup title="Agent">
          <AgentRows agents={agents} selectedAgentId={agent.id} onSelect={onAgentSelect} />
        </SidebarSectionGroup>
        <SidebarSectionGroup title="File">
          {editableFiles.map((file) => {
            const exists = agent.files.find((item) => item.name === file)?.exists;
            return (
              <SelectableRow
                key={file}
                isActive={selectedFile === file}
                meta={exists ? undefined : "new"}
                onSelect={() => onFileSelect(file)}
              >
                {file}
              </SelectableRow>
            );
          })}
        </SidebarSectionGroup>
      </SectionSidebar>
      <Panel>
        <PanelHeader
          eyebrow={`${agent.identity.emoji} ${agent.identity.name}`}
          title={selectedFile}
          actions={<Button variant="primary" isDisabled={!fileDirty} onPress={onSave}>{isPending ? "Saving..." : "Save file"}</Button>}
        />
        <PanelBody>
          <TextArea aria-label={selectedFile} fullWidth variant="secondary" className="min-h-[640px] font-mono leading-6 max-md:min-h-[420px]" value={fileContent} onChange={(event) => onContentChange(event.target.value)} />
        </PanelBody>
      </Panel>
    </PageColumns>
  );
}

function SkillsPanel({
  agent,
  agents,
  allSkills,
  isPending,
  onAgentSelect,
  onContentChange,
  onFileSelect,
  onSave,
  onSkillClose,
  onSkillSelect,
  selectedSkill,
  selectedSkillFile,
  skillContent,
  skillDirty,
  skills,
  skillsError,
}: {
  agent?: Agent;
  agents: Agent[];
  allSkills: SkillSummary[];
  isPending: boolean;
  onAgentSelect: (agentId: string) => void;
  onContentChange: (content: string) => void;
  onFileSelect: (file: string) => void;
  onSave: () => void;
  onSkillClose: () => void;
  onSkillSelect: (skillId: string) => void;
  selectedSkill?: SkillSummary;
  selectedSkillFile: string;
  skillContent: string;
  skillDirty: boolean;
  skills: SkillSummary[];
  skillsError: string;
}) {
  return (
    <PageColumns>
      <SectionSidebar eyebrow="Skills" title="Agents">
        {skillsError ? <Chip color="warning" variant="soft">{skillsError}</Chip> : null}
        <AgentRows
          agents={agents}
          selectedAgentId={agent?.id ?? ""}
          getMeta={(item) => `${totalSkillsForAgent(item, allSkills)} skills`}
          onSelect={onAgentSelect}
        />
      </SectionSidebar>

      {agent ? (
        <Panel>
          <PanelHeader
            eyebrow={`${agent.identity.emoji} ${agent.identity.name}`}
            title={selectedSkill ? selectedSkill.name : `${skills.length} workspace skills`}
            actions={selectedSkill ? (
              <div className="flex items-center gap-2 max-sm:w-full">
                <Button className="max-sm:flex-1" variant="tertiary" onPress={onSkillClose}>Back</Button>
                <Button className="max-sm:flex-1" variant="primary" isDisabled={!skillDirty} onPress={onSave}>{isPending ? "Saving..." : "Save skill"}</Button>
              </div>
            ) : null}
          />
          <PanelBody className="grid gap-6">
            {skills.length ? (
              selectedSkill ? (
                <SkillDetailPage
                  content={skillContent}
                  fileName={selectedSkillFile}
                  skill={selectedSkill}
                  onContentChange={onContentChange}
                  onFileSelect={onFileSelect}
                />
              ) : (
                <SkillList skills={skills} selectedSkill={selectedSkill} onSkillSelect={onSkillSelect} />
              )
            ) : (
              <p className="text-sm text-muted">This agent does not have workspace skills installed.</p>
            )}
          </PanelBody>
        </Panel>
      ) : (
        <Panel>
          <PanelBody>
            <p className="text-sm text-muted">No installed skills found in OpenClaw skill folders.</p>
          </PanelBody>
        </Panel>
      )}
    </PageColumns>
  );
}

function SkillDetailPage({
  content,
  fileName,
  onContentChange,
  onFileSelect,
  skill,
}: {
  content: string;
  fileName: string;
  onContentChange: (content: string) => void;
  onFileSelect: (file: string) => void;
  skill: SkillSummary;
}) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <p className="text-sm text-muted">{skill.description || "No description in SKILL.md frontmatter."}</p>
        <div className="flex flex-wrap gap-2">
          <Chip color={skill.enabled ? "success" : "default"} size="sm" variant="soft">{skill.enabled ? "enabled" : "disabled"}</Chip>
          <Chip size="sm" variant="soft">{skill.scope}</Chip>
          <Chip size="sm" variant="soft">{skill.source}</Chip>
        </div>
      </div>
      <SkillMarkdownEditor
        content={content}
        fileName={fileName}
        skill={skill}
        onContentChange={onContentChange}
        onFileSelect={onFileSelect}
      />
    </div>
  );
}

function SkillList({ onSkillSelect, selectedSkill, skills }: { onSkillSelect: (skillId: string) => void; selectedSkill?: SkillSummary; skills: SkillSummary[] }) {
  return (
    <div className="grid divide-y divide-border border-y border-border">
      {skills.map((skill) => {
        const selected = selectedSkill?.id === skill.id;
        return (
          <button
            key={skill.id}
            className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-default max-md:grid-cols-1 ${
              selected ? "bg-default" : ""
            }`}
            type="button"
            onClick={() => onSkillSelect(skill.id)}
          >
            <span className="grid gap-1">
              <span className="font-medium">{skill.name}</span>
              <span className="line-clamp-1 text-sm text-muted">{skill.description || skill.directory}</span>
            </span>
            <span className="flex flex-wrap justify-end gap-2 max-md:justify-start">
              <Chip size="sm" variant="soft">{skill.scope}</Chip>
              <Chip color={skill.enabled ? "success" : "default"} size="sm" variant="soft">{skill.enabled ? "enabled" : "disabled"}</Chip>
              <Chip size="sm" variant="soft">{skill.files.length} files</Chip>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SkillMarkdownEditor({
  content,
  fileName,
  onContentChange,
  onFileSelect,
  skill,
}: {
  content: string;
  fileName: string;
  onContentChange: (content: string) => void;
  onFileSelect: (file: string) => void;
  skill: SkillSummary;
}) {
  return (
    <div className="grid grid-cols-[280px_minmax(0,1fr)] gap-0 overflow-hidden border-y border-border max-xl:grid-cols-1">
      <div className="border-r border-border py-3 pr-3 max-xl:border-r-0 max-xl:border-b max-xl:pr-0">
        <p className="mb-2 px-2 text-xs font-medium uppercase tracking-widest text-muted">Files</p>
        <div className="grid max-xl:max-h-[240px] gap-1 max-xl:overflow-auto">
          {skill.files.map((file) => (
            <SelectableRow
              key={file}
              isActive={fileName === file}
              onSelect={() => onFileSelect(file)}
            >
              {file}
            </SelectableRow>
          ))}
        </div>
      </div>
      <div className="grid gap-3 py-3 pl-4 max-xl:pl-0">
        <div className="flex items-end justify-between gap-3 max-md:grid">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted">Editing</p>
            <h3 className="text-sm font-semibold">{fileName}</h3>
          </div>
          <p className="min-w-0 truncate text-xs text-muted">{skill.directory}</p>
        </div>
        <TextArea
          aria-label={`${skill.name} ${fileName}`}
          className="min-h-[620px] font-mono leading-6 max-md:min-h-[420px]"
          fullWidth
          value={content}
          variant="secondary"
          onChange={(event) => onContentChange(event.target.value)}
        />
      </div>
    </div>
  );
}

function totalSkillsForAgent(agent: Agent, skills: SkillSummary[]) {
  return skills.filter((skill) => skill.installedAgents.includes(agent.id)).length;
}

const ACTIVITY_PAGE_SIZE = 12;

function ActivityFeed({ agents, events, error, updatedAt, onRefresh }: { agents: Agent[]; events: ActivityEvent[]; error: string; updatedAt: string; onRefresh: () => Promise<void> }) {
  const [selectedAgent, setSelectedAgent] = useState("all");
  const [page, setPage] = useState(1);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(() => new Set());
  const filtered = selectedAgent === "all" ? events : events.filter((event) => event.agentId === selectedAgent);
  const pageCount = Math.max(1, Math.ceil(filtered.length / ACTIVITY_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * ACTIVITY_PAGE_SIZE;
  const pageEvents = filtered.slice(pageStart, pageStart + ACTIVITY_PAGE_SIZE);
  const agentNames = new Map(agents.map((agent) => [agent.id, `${agent.identity.emoji} ${agent.identity.name}`]));

  function selectAgent(agentId: string) {
    setSelectedAgent(agentId);
    setPage(1);
    setExpandedEvents(new Set());
  }

  function toggleEvent(eventKey: string) {
    setExpandedEvents((current) => {
      const next = new Set(current);
      if (next.has(eventKey)) next.delete(eventKey);
      else next.add(eventKey);
      return next;
    });
  }

  return (
    <PageColumns>
      <SectionSidebar eyebrow="Activity" title="Agent">
        <SidebarSectionGroup title="Filter">
          <SelectableRow isActive={selectedAgent === "all"} onSelect={() => selectAgent("all")}>
            All agents
          </SelectableRow>
          <AgentRows agents={agents} selectedAgentId={selectedAgent} onSelect={selectAgent} />
        </SidebarSectionGroup>
        <Button variant="secondary" onPress={() => void onRefresh()}>Refresh activity</Button>
        {updatedAt ? <p className="text-sm text-muted">Last refresh: {new Date(updatedAt).toLocaleTimeString()}</p> : null}
        {error ? <Chip color="warning" variant="soft">{error}</Chip> : null}
      </SectionSidebar>
      <Panel>
        <PanelHeader
          eyebrow="from local OpenClaw history"
          title="Agent Activity"
          actions={<span className="text-xs text-muted">{filtered.length} events</span>}
        />
        <PanelBody className="p-0">
          {filtered.length ? (
            <>
              <div className="divide-y divide-border">
                {pageEvents.map((event) => {
                  const eventKey = `${event.source}:${event.id}`;
                  return (
                    <ActivityTimelineItem
                      key={eventKey}
                      agentName={agentNames.get(event.agentId) ?? event.agentId}
                      event={event}
                      isExpanded={expandedEvents.has(eventKey)}
                      onToggle={() => toggleEvent(eventKey)}
                    />
                  );
                })}
              </div>
              <ActivityPagination
                currentPage={currentPage}
                pageCount={pageCount}
                pageSize={ACTIVITY_PAGE_SIZE}
                total={filtered.length}
                onPageChange={(nextPage) => {
                  setPage(nextPage);
                  setExpandedEvents(new Set());
                }}
              />
            </>
          ) : (
            <p className="p-4 text-sm text-muted">No activity captured yet.</p>
          )}
        </PanelBody>
      </Panel>
    </PageColumns>
  );
}

function ActivityTimelineItem({ agentName, event, isExpanded, onToggle }: { agentName: string; event: ActivityEvent; isExpanded: boolean; onToggle: () => void }) {
  const line = activityProductionLine(event);
  return (
    <article className="grid gap-2 px-4 py-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-3 max-md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="truncate text-sm leading-6">
            <strong>{agentName}</strong>{" "}
            <span>{line}</span>
          </p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-muted">
            <Chip color={statusColor(event.status)} size="sm" variant="soft">{activityStatusLabel(event.status)}</Chip>
            <span>{event.runtime}</span>
            <span>/</span>
            <span>{activitySourceLabel(event)}</span>
            {event.details ? (
              <>
                <span>/</span>
                <span className="max-w-[680px] truncate max-md:max-w-full">{event.details}</span>
              </>
            ) : null}
          </div>
        </div>
        <time className="whitespace-nowrap text-xs text-muted max-md:hidden">{formatRelativeTime(event.timestamp)}</time>
        <Button aria-label={isExpanded ? "Hide activity details" : "Show activity details"} isIconOnly size="sm" variant="tertiary" onPress={onToggle}>
          <ChevronIcon isOpen={isExpanded} />
        </Button>
      </div>
      {isExpanded ? (
        <div className="grid gap-3 rounded-lg bg-default px-3 py-3 text-sm leading-6 text-muted">
          <p className="text-foreground">{line}</p>
          {event.message && event.message !== line ? <ActivityDetail label="Message" value={event.message} /> : null}
          {event.result && event.result !== line ? <ActivityDetail label="Result" value={event.result} /> : null}
          {event.details ? <ActivityDetail label="Source" value={event.details} /> : null}
          <ActivityDetail label="Time" value={new Date(event.timestamp).toLocaleString()} />
        </div>
      ) : null}
    </article>
  );
}

function ActivityDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-[11px] font-medium uppercase tracking-widest text-muted">{label}</span>
      <p className="whitespace-pre-wrap break-words">{value}</p>
    </div>
  );
}

function ActivityPagination({
  currentPage,
  onPageChange,
  pageCount,
  pageSize,
  total,
}: {
  currentPage: number;
  onPageChange: (page: number) => void;
  pageCount: number;
  pageSize: number;
  total: number;
}) {
  if (pageCount <= 1) return null;
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, total);
  const pages = paginationPages(currentPage, pageCount);

  return (
    <div className="border-t border-border px-4 py-3">
      <Pagination size="sm">
        <Pagination.Summary>
          {start} to {end} of {total} events
        </Pagination.Summary>
        <Pagination.Content>
          <Pagination.Item>
            <Pagination.Previous
              isDisabled={currentPage === 1}
              onPress={() => onPageChange(Math.max(1, currentPage - 1))}
            >
              <Pagination.PreviousIcon />
              Prev
            </Pagination.Previous>
          </Pagination.Item>
          {pages.map((pageItem, index) => (
            pageItem === "ellipsis" ? (
              <Pagination.Item key={`ellipsis-${index}`}>
                <Pagination.Ellipsis />
              </Pagination.Item>
            ) : (
              <Pagination.Item key={pageItem}>
                <Pagination.Link
                  isActive={pageItem === currentPage}
                  onPress={() => onPageChange(pageItem)}
                >
                  {pageItem}
                </Pagination.Link>
              </Pagination.Item>
            )
          ))}
          <Pagination.Item>
            <Pagination.Next
              isDisabled={currentPage === pageCount}
              onPress={() => onPageChange(Math.min(pageCount, currentPage + 1))}
            >
              Next
              <Pagination.NextIcon />
            </Pagination.Next>
          </Pagination.Item>
        </Pagination.Content>
      </Pagination>
    </div>
  );
}

function paginationPages(currentPage: number, pageCount: number): Array<number | "ellipsis"> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const pages = new Set([1, pageCount, currentPage - 1, currentPage, currentPage + 1]);
  const sorted = Array.from(pages)
    .filter((page) => page >= 1 && page <= pageCount)
    .sort((a, b) => a - b);
  return sorted.flatMap((page, index) => {
    const previous = sorted[index - 1];
    if (previous && page - previous > 1) return ["ellipsis" as const, page];
    return [page];
  });
}

function defaultHeartbeat(agent: Agent): Heartbeat {
  return agent.heartbeat ?? { every: "", activeHours: { start: "08:00", end: "22:00" }, model: "", target: "last" };
}

function HeartbeatEditor({ agent, onSaved }: { agent: Agent; onSaved: () => Promise<void> }) {
  const [heartbeat, setHeartbeat] = useState<Heartbeat>(() => defaultHeartbeat(agent));
  const [saving, setSaving] = useState(false);

  async function save(heartbeatValue: Heartbeat | null) {
    setSaving(true);
    const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/heartbeat`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ heartbeat: heartbeatValue }) });
    const payload = await response.json();
    if (response.ok) {
      toast.success(heartbeatValue ? "Heartbeat saved" : "Heartbeat removed");
      await onSaved();
    } else {
      toast.danger("Heartbeat update failed", { description: payload.error });
    }
    setSaving(false);
  }
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <Field label="Every" placeholder="60m" value={heartbeat.every ?? ""} onChange={(every) => setHeartbeat({ ...heartbeat, every })} />
        <Field label="Target" placeholder="last" value={heartbeat.target ?? ""} onChange={(target) => setHeartbeat({ ...heartbeat, target })} />
        <Field label="Active from" placeholder="08:00" value={heartbeat.activeHours?.start ?? ""} onChange={(start) => setHeartbeat({ ...heartbeat, activeHours: { ...(heartbeat.activeHours ?? {}), start } })} />
        <Field label="Active until" placeholder="22:00" value={heartbeat.activeHours?.end ?? ""} onChange={(end) => setHeartbeat({ ...heartbeat, activeHours: { ...(heartbeat.activeHours ?? {}), end } })} />
      </div>
      <Field label="Model override" value={heartbeat.model ?? ""} onChange={(model) => setHeartbeat({ ...heartbeat, model })} />
      <div className="flex gap-2">
        <Button variant="primary" onPress={() => void save(heartbeat)}>{saving ? "Saving..." : "Save"}</Button>
        <Button variant="danger" onPress={() => void save(null)}>Remove</Button>
      </div>
    </div>
  );
}

function HeartbeatFileEditor({ agent, onSaved }: { agent: Agent; onSaved: () => Promise<void> }) {
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/agents/${encodeURIComponent(agent.id)}/files/HEARTBEAT.md`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (response.ok) {
          setContent(payload.content);
          setDirty(false);
        } else {
          toast.danger("Failed to load HEARTBEAT.md", { description: payload.error });
        }
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        toast.danger("Failed to load HEARTBEAT.md");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [agent.id]);

  async function save() {
    setSaving(true);
    const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/files/HEARTBEAT.md`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    const payload = await response.json();
    if (response.ok) {
      setDirty(false);
      toast.success("HEARTBEAT.md saved");
      await onSaved();
    } else {
      toast.danger("Failed to save HEARTBEAT.md", { description: payload.error });
    }
    setSaving(false);
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-muted">Heartbeat text</p>
          <p className="text-sm text-muted">This is the editable HEARTBEAT.md file used by the agent.</p>
        </div>
        <Button size="sm" variant="secondary" isDisabled={!dirty || loading} onPress={() => void save()}>{saving ? "Saving..." : "Save text"}</Button>
      </div>
      <TextArea
        aria-label="HEARTBEAT.md"
        fullWidth
        variant="secondary"
        className="min-h-[260px] font-mono leading-6"
        value={content}
        onChange={(event) => {
          setContent(event.target.value);
          setDirty(true);
        }}
      />
    </div>
  );
}

function ScheduleTabs({
  agent,
  crons,
  cronForm,
  isPending,
  onCreateCron,
  onCronFormChange,
  onRefresh,
}: {
  agent: Agent;
  crons: CronJob[];
  cronForm: CronForm;
  isPending: boolean;
  onCreateCron: () => void;
  onCronFormChange: (form: CronForm) => void;
  onRefresh: () => Promise<void>;
}) {
  return (
    <Panel>
      <Tabs className="w-full" defaultSelectedKey="heartbeat" variant="secondary">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 max-sm:grid">
          <Tabs.ListContainer className="min-w-0 overflow-x-auto">
            <Tabs.List aria-label={`Schedules for ${agent.identity.name}`} className="flex-nowrap">
              <Tabs.Tab className="whitespace-nowrap" id="heartbeat">
                Heartbeat
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab className="whitespace-nowrap" id="crons">
                <Tabs.Separator />
                Crons ({crons.length})
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab className="whitespace-nowrap" id="new-cron">
                <Tabs.Separator />
                New cron
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
          <Chip color={agent.heartbeat?.every ? "success" : "default"} variant="soft">
            {agent.heartbeat?.every || "manual"}
          </Chip>
        </div>
        <Tabs.Panel id="heartbeat">
          <PanelBody className="grid gap-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-muted">Heartbeat</p>
              <h3 className="text-sm font-semibold">{agent.identity.emoji} {agent.identity.name}</h3>
            </div>
            <HeartbeatEditor key={agent.id} agent={agent} onSaved={onRefresh} />
            <HeartbeatFileEditor key={`${agent.id}:heartbeat-file`} agent={agent} onSaved={onRefresh} />
          </PanelBody>
        </Tabs.Panel>
        <Tabs.Panel id="crons">
          <PanelBody className="grid gap-4">
            <div className="flex items-center justify-between gap-3 max-sm:grid">
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-muted">Cron jobs</p>
                <h3 className="text-sm font-semibold">{crons.length} scheduled jobs</h3>
              </div>
              <Chip className="max-w-full truncate" variant="soft">{agent.id}</Chip>
            </div>
            <CronList crons={crons} onChanged={onRefresh} />
          </PanelBody>
        </Tabs.Panel>
        <Tabs.Panel id="new-cron">
          <PanelBody>
            <Form
              aria-label={`Create cron for ${agent.identity.name}`}
              className="grid gap-5"
              onSubmit={(event) => {
                event.preventDefault();
                onCreateCron();
              }}
            >
              <div>
                <p className="text-xs font-medium uppercase tracking-widest text-muted">New cron</p>
                <h3 className="text-sm font-semibold">Create for {agent.identity.name}</h3>
              </div>
              <CronFormFields form={{ ...cronForm, agent: agent.id }} onChange={(form) => onCronFormChange({ ...form, agent: agent.id })} />
              <div>
                <Button type="submit" variant="primary">{isPending ? "Creating..." : "Create cron"}</Button>
              </div>
            </Form>
          </PanelBody>
        </Tabs.Panel>
      </Tabs>
    </Panel>
  );
}

function CronList({ crons, onChanged }: { crons: CronJob[]; onChanged: () => Promise<void> }) {
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState<CronForm>(emptyCronForm);
  const [savingId, setSavingId] = useState("");
  const editingCron = crons.find((cron, index) => getCronRowId(cron, index) === editingId);

  async function toggle(cron: CronJob, enable: boolean) {
    const id = getCronId(cron);
    if (!id) return;
    const response = await fetch(`/api/crons/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(enable ? { enable: true } : { disable: true }) });
    const payload = await response.json();
    if (response.ok) {
      toast.success("Cron updated");
      await onChanged();
    } else {
      toast.danger("Cron update failed", { description: payload.error });
    }
  }
  async function remove(cron: CronJob) {
    const id = getCronId(cron);
    if (!id) return;
    const response = await fetch(`/api/crons/${encodeURIComponent(id)}`, { method: "DELETE" });
    const payload = await response.json();
    if (response.ok) {
      toast.success("Cron removed");
      if (editingId === id) setEditingId("");
      await onChanged();
    } else {
      toast.danger("Cron remove failed", { description: payload.error });
    }
  }
  async function save(cron: CronJob) {
    const id = getCronId(cron);
    if (!id) return;
    setSavingId(id);
    const response = await fetch(`/api/crons/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cleanPayload(draft)) });
    const payload = await response.json();
    if (response.ok) {
      toast.success("Cron updated");
      setEditingId("");
      await onChanged();
    } else {
      toast.danger("Cron update failed", { description: payload.error });
    }
    setSavingId("");
  }

  if (!crons.length) return <p className="text-sm text-muted">No cron jobs assigned.</p>;

  return (
    <div className="grid gap-4">
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label="Cron jobs" className="min-w-[820px]">
            <Table.Header>
              <Table.Column isRowHeader>Job</Table.Column>
              <Table.Column>Status</Table.Column>
              <Table.Column>Schedule</Table.Column>
              <Table.Column>Actions</Table.Column>
            </Table.Header>
            <Table.Body>
              {crons.map((cron, index) => {
                const id = getCronRowId(cron, index);
                const disabled = cron.disabled === true || cron.enabled === false;
                const isEditing = editingId === id;
                return (
                  <Table.Row key={id} id={id}>
                    <Table.Cell>
                      <div className="grid gap-1">
                        <strong>{String(cron.name || id)}</strong>
                        <span className="text-sm text-muted">{String(cron.description || getCronMessage(cron) || "No description")}</span>
                      </div>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip color={disabled ? "default" : "success"} size="sm" variant="soft">{disabled ? "disabled" : "active"}</Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <Chip size="sm" variant="soft">{getCronScheduleSummary(cron)}</Chip>
                    </Table.Cell>
                    <Table.Cell>
                      <div className="flex flex-wrap items-center gap-1">
                        <Button
                          size="sm"
                          variant="tertiary"
                          onPress={() => {
                            setEditingId(isEditing ? "" : id);
                            setDraft(cronToForm(cron));
                          }}
                        >
                          {isEditing ? "Close" : "Edit"}
                        </Button>
                        <Button size="sm" variant="tertiary" onPress={() => void toggle(cron, disabled)}>{disabled ? "Enable" : "Disable"}</Button>
                        <Button size="sm" variant="danger-soft" onPress={() => void remove(cron)}>Remove</Button>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
      {editingCron ? (
        <Card>
          <CardHeader>
            <div>
              <p className="text-xs font-medium uppercase tracking-widest text-muted">Edit cron</p>
              <h4 className="font-semibold">{String(editingCron.name || getCronId(editingCron))}</h4>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5">
            <CronFormFields form={draft} onChange={setDraft} />
            <div className="flex gap-2">
              <Button variant="primary" onPress={() => void save(editingCron)}>{savingId === getCronId(editingCron) ? "Saving..." : "Save changes"}</Button>
              <Button variant="tertiary" onPress={() => setEditingId("")}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function CronFormFields({ form, onChange }: { form: CronForm; onChange: (form: CronForm) => void }) {
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <Field label="Name" value={form.name} onChange={(name) => onChange({ ...form, name })} />
        <Field label="Description" value={form.description} onChange={(description) => onChange({ ...form, description })} />
      </div>
      <TextField label="What should the agent do?" value={form.message} className="min-h-[320px] text-base leading-7" onChange={(message) => onChange({ ...form, message })} />
      <MarkdownPreview content={form.message} />
      <SchedulePicker form={form} onChange={onChange} />
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <Field label="Model override" value={form.model} onChange={(model) => onChange({ ...form, model })} />
        <Field label="Timezone" value={form.tz} placeholder="Europe/Rome" helper="Used for morning and weekday schedules." onChange={(tz) => onChange({ ...form, tz })} />
      </div>
    </div>
  );
}

function SchedulePicker({ form, onChange }: { form: CronForm; onChange: (form: CronForm) => void }) {
  const selectedPreset = selectedSchedulePreset(form);
  return (
    <div className="grid gap-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted">When should it run?</p>
        <p className="text-sm text-muted">Pick a preset. Use custom fields only if the preset is not enough.</p>
      </div>
      <div className="grid overflow-hidden rounded-lg border border-border sm:grid-cols-2 lg:grid-cols-5">
        {schedulePresets.map((preset) => (
          <button
            key={preset.id}
            className={`grid min-h-14 content-center gap-0.5 border-border px-3 py-2 text-left text-sm transition-colors hover:bg-default max-lg:border-b lg:border-r lg:last:border-r-0 ${
              selectedPreset === preset.id ? "bg-default text-foreground" : "text-muted"
            }`}
            type="button"
            onClick={() => onChange(applySchedulePreset(form, preset.fields))}
          >
            <span className="font-medium">{preset.label}</span>
            <span className="text-xs text-muted">{preset.description}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        <Field label="Custom repeat" placeholder="2h, 1d, 15m" value={form.every} helper="Plain durations are easiest: 30m, 2h, 1d." onChange={(every) => onChange({ ...form, every, cron: every ? "" : form.cron, at: every ? "" : form.at })} />
        <Field label="Run once" placeholder="+2h" value={form.at} helper="Use +2h or an exact date/time." onChange={(at) => onChange({ ...form, at, every: at ? "" : form.every, cron: at ? "" : form.cron })} />
        <Field label="Advanced pattern" placeholder="0 9 * * *" value={form.cron} helper="Only use this if you know cron syntax." onChange={(cron) => onChange({ ...form, cron, every: cron ? "" : form.every, at: cron ? "" : form.at })} />
      </div>
    </div>
  );
}

function Field({ label, value, placeholder, helper, onChange }: { label: string; value: string; placeholder?: string; helper?: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium uppercase tracking-wider text-muted">{label}</span>
      <Input aria-label={label} fullWidth variant="secondary" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      {helper ? <span className="text-xs text-muted">{helper}</span> : null}
    </label>
  );
}

function TextField({ label, value, className, onChange }: { label: string; value: string; className?: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium uppercase tracking-wider text-muted">{label}</span>
      <TextArea aria-label={label} fullWidth variant="secondary" className={className} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted">Preview</p>
          <h4 className="font-semibold">Agent message</h4>
        </div>
      </CardHeader>
      <CardContent className="text-base leading-7">
        {content.trim() ? renderMarkdownLines(content) : <p className="text-muted">No message yet.</p>}
      </CardContent>
    </Card>
  );
}

function renderMarkdownLines(content: string) {
  return content.split(/\r?\n/).map((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return <div key={index} className="h-3" />;
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      return <strong key={index} className="mb-2 block text-lg">{renderInlineMarkdown(heading[2])}</strong>;
    }
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      return <p key={index} className="mb-1 pl-4">• {renderInlineMarkdown(bullet[1])}</p>;
    }
    const numbered = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (numbered) {
      return <p key={index} className="mb-1 pl-4">{numbered[1]}. {renderInlineMarkdown(numbered[2])}</p>;
    }
    return <p key={index} className="mb-2">{renderInlineMarkdown(trimmed)}</p>;
  });
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function cleanPayload(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null));
}

function applySchedulePreset(form: CronForm, fields: Partial<CronForm>) {
  return {
    ...form,
    every: "",
    cron: "",
    at: "",
    ...fields,
    tz: fields.tz ?? form.tz,
  };
}

function selectedSchedulePreset(form: CronForm) {
  const normalized = normalizeScheduleForm(form);
  return schedulePresets.find((preset) => {
    const candidate = normalizeScheduleForm({ ...emptyCronForm, ...preset.fields });
    return candidate.every === normalized.every && candidate.cron === normalized.cron && candidate.at === normalized.at;
  })?.id ?? "";
}

function normalizeScheduleForm(form: CronForm) {
  return {
    every: form.every.trim(),
    cron: form.cron.trim(),
    at: form.at.trim(),
  };
}

function cronToForm(cron: CronJob): CronForm {
  const schedule = getScheduleObject(cron);
  return {
    ...emptyCronForm,
    name: getCronString(cron, "name"),
    description: getCronString(cron, "description"),
    agent: getCronAgentId(cron),
    message: getCronMessage(cron),
    every: getCronString(cron, "every") || (schedule.kind === "interval" ? schedule.expr : ""),
    cron: getCronString(cron, "cron") || (schedule.kind === "cron" ? schedule.expr : ""),
    at: getCronString(cron, "at") || (schedule.kind === "at" || schedule.kind === "once" ? schedule.expr : ""),
    tz: getCronString(cron, "tz") || schedule.tz || "Europe/Rome",
    model: getCronString(cron, "model"),
  };
}

function getCronId(cron: CronJob) {
  return String(cron.id || cron.name || "");
}

function getCronRowId(cron: CronJob, index: number) {
  return getCronId(cron) || `cron-${index}`;
}

function getCronAgentId(cron: CronJob) {
  const direct = cron.agentId || cron.agent;
  if (typeof direct === "string") return direct;
  const payload = cron.payload;
  if (payload && typeof payload === "object") {
    const maybeAgent = (payload as { agentId?: unknown; agent?: unknown }).agentId ?? (payload as { agent?: unknown }).agent;
    if (typeof maybeAgent === "string") return maybeAgent;
  }
  return "";
}

function getCronMessage(cron: CronJob) {
  const payload = cron.payload;
  if (payload && typeof payload === "object") {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

function getCronScheduleSummary(cron: CronJob) {
  const every = getCronString(cron, "every");
  if (every) return `Every ${friendlyDuration(every)}`;
  const at = getCronString(cron, "at");
  if (at) return `Once ${at}`;
  const cronExpression = getCronString(cron, "cron");
  if (cronExpression) return friendlyCron(cronExpression, getCronString(cron, "tz"));
  const schedule = getScheduleObject(cron);
  if (schedule.kind === "interval" && schedule.expr) return `Every ${friendlyDuration(schedule.expr)}`;
  if ((schedule.kind === "at" || schedule.kind === "once") && schedule.expr) return `Once ${schedule.expr}`;
  if (schedule.kind === "cron" && schedule.expr) return friendlyCron(schedule.expr, schedule.tz);
  return "Schedule unknown";
}

function getCronString(cron: CronJob, key: string) {
  const direct = cron[key];
  if (typeof direct === "string") return direct;
  const payload = cron.payload;
  if (payload && typeof payload === "object") {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function getScheduleObject(cron: CronJob) {
  const schedule = cron.schedule;
  if (schedule && typeof schedule === "object") {
    const item = schedule as Record<string, unknown>;
    return {
      kind: typeof item.kind === "string" ? item.kind : "",
      expr: typeof item.expr === "string" ? item.expr : "",
      tz: typeof item.tz === "string" ? item.tz : "",
    };
  }
  return { kind: "", expr: "", tz: "" };
}

function friendlyDuration(value: string) {
  return value
    .replace(/^(\d+)m$/, "$1 min")
    .replace(/^(\d+)h$/, "$1 hours")
    .replace(/^(\d+)d$/, "$1 days");
}

function friendlyCron(expression: string, timezone?: string) {
  const parts = expression.trim().split(/\s+/);
  if (parts.length === 5) {
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
    const tz = timezone ? ` (${timezone})` : "";
    if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") return `Every day at ${time}${tz}`;
    if (dayOfMonth === "*" && month === "*" && dayOfWeek === "1-5") return `Weekdays at ${time}${tz}`;
  }
  return `Advanced schedule: ${expression}`;
}

function statusColor(status: string): "success" | "danger" | "warning" | "accent" | "default" {
  if (status === "succeeded" || status === "delivered" || status === "new" || status === "done") return "success";
  if (status === "failed" || status === "timed_out" || status === "lost") return "danger";
  if (status === "running" || status === "queued") return "warning";
  return "default";
}

function activitySourceLabel(event: ActivityEvent) {
  if (event.source === "workspace-memory") return "memory";
  if (event.source === "session-history") return "session history";
  if (event.source === "commands.log") return event.label;
  return event.label;
}

function activityStatusLabel(status: string) {
  if (status === "done") return "done";
  if (status === "logged") return "logged";
  if (status === "incoming") return "received";
  if (status === "replied") return "replied";
  if (status === "new") return "received";
  if (status === "reset") return "reset";
  if (status === "succeeded") return "done";
  if (status === "timed_out") return "timed out";
  return status;
}

function activityMessage(event: ActivityEvent) {
  if (event.message) return event.message;
  if (event.source === "commands.log") {
    return "Command metadata recorded. Message text was not stored in commands.log.";
  }
  return event.label;
}

function activityProductionLine(event: ActivityEvent) {
  const summary = event.result || event.summary || activityMessage(event);
  if (event.source === "workspace-memory") return summary;
  if (event.source === "session-history") {
    if (event.status === "incoming") return `received a Slack message: ${summary}`;
    if (event.status === "replied") return `replied in Slack: ${summary}`;
    return summary;
  }
  if (event.source === "commands.log") {
    if (event.status === "new") return event.message ? summary : `received a ${event.label} command. Message text was not persisted in commands.log.`;
    if (event.status === "reset") return "reset a session";
    return summary || `recorded ${event.status}`;
  }
  if (summary) return summary;
  if (event.status === "running") return `is working on ${event.label}`;
  if (event.status === "queued") return `queued ${event.label}`;
  if (event.status === "succeeded" || event.status === "delivered") return `completed ${event.label}`;
  if (event.status === "failed" || event.status === "timed_out") return `could not complete ${event.label}`;
  return `updated ${event.label}`;
}

function formatRelativeTime(timestamp: number) {
  const delta = Date.now() - timestamp;
  const minute = 60_000;
  const hour = minute * 60;
  const day = hour * 24;
  if (delta < minute) return "just now";
  if (delta < hour) return `${Math.floor(delta / minute)}m ago`;
  if (delta < day) return `${Math.floor(delta / hour)}h ago`;
  return new Date(timestamp).toLocaleString();
}
