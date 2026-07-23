import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { api, JsonObject, LoadedConfig, Page, Workspace } from "./api";
import { moveSourceToTrash, restoreSourceFromTrash } from "./source-trash";
import { LayerProduct, LayerScopeView } from "./workbench-products";

type PageName = "pipeline" | "workspaces" | "history" | "layers" | "reviews" | "context";
type PipelineStageId = "workspace" | "sources" | "normalize" | "structure" | "evidence" | "fact" | "semantic" | "project";
type WorkbenchView = "config" | "output" | "scope" | "trash" | "history" | "logs";

const nav: Array<[PageName, string, string]> = [
  ["workspaces", "工作空间", "01"], ["history", "运行历史", "02"],
  ["layers", "数据浏览", "03"], ["reviews", "审核中心", "04"],
  ["context", "Context 实验室", "05"],
];

const pageTitles: Record<PageName, string> = {
  pipeline: "流水线工作台",
  workspaces: "工作空间",
  history: "运行历史",
  layers: "数据浏览",
  reviews: "审核中心",
  context: "Context 实验室",
};

const pipelineStages: Array<{ id: PipelineStageId; label: string; buildStage: string }> = [
  { id: "workspace", label: "工作空间", buildStage: "capture" },
  { id: "sources", label: "数据源", buildStage: "capture" },
  { id: "normalize", label: "标准化", buildStage: "normalize" },
  { id: "structure", label: "结构", buildStage: "structure" },
  { id: "evidence", label: "证据", buildStage: "evidence" },
  { id: "fact", label: "事实", buildStage: "fact" },
  { id: "semantic", label: "语义", buildStage: "semantic" },
  { id: "project", label: "发布", buildStage: "project" },
];

const scopeStages: Partial<Record<PipelineStageId, { collection: string; layer: string; label: string; readOnly?: boolean }>> = {
  sources: { collection: "snapshots", layer: "source", label: "Source" },
  normalize: { collection: "normalized-sources", layer: "source", label: "Normalized Source" },
  structure: { collection: "structures", layer: "structure", label: "Structure" },
  evidence: { collection: "evidence", layer: "evidence", label: "Evidence" },
  fact: { collection: "facts", layer: "fact", label: "Fact" },
  semantic: { collection: "facts", layer: "fact", label: "Fact 范围边界", readOnly: true },
  project: { collection: "facts", layer: "fact", label: "EffectiveScope 索引", readOnly: true },
};

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState<PageName>("workspaces");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState(localStorage.getItem("context.workspace") ?? "");

  const reload = useCallback(async () => {
    const values = await api.request<Workspace[]>("/workspaces");
    setWorkspaces(values);
    setWorkspaceId((current) => values.some((value) => value.workspaceId === current) ? current : "");
  }, []);

  useEffect(() => {
    api.initialize().then(reload).then(() => setReady(true)).catch((value: Error) => setError(value.message));
  }, [reload]);
  useEffect(() => { if (workspaceId) localStorage.setItem("context.workspace", workspaceId); }, [workspaceId]);

  const selected = workspaces.find((value) => value.workspaceId === workspaceId);
  if (!ready) return <div className="boot"><span className="pulse" />{error || "正在连接本地管理服务…"}</div>;

  return <div className="shell">
    <aside>
      <div className="brand"><span className="brandmark">CC</span><div><b>Context Compiler</b><small>Project Intelligence</small></div></div>
      <nav>{nav.map(([id, label, index]) => <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}><span>{index}</span>{label}</button>)}</nav>
      <a className="api-link" href="/docs" target="_blank">OpenAPI 接口测试 ↗</a>
    </aside>
    <main>
      <header><div><span className="eyebrow">LOCAL CONTROL PLANE</span><h1>{pageTitles[page]}</h1></div>
        {selected && page !== "workspaces" && <div className="header-workspace"><span>{selected.displayName}</span>{page === "pipeline" && <button className="ghost" onClick={() => setPage("workspaces")}>返回工作空间</button>}</div>}
      </header>
      {error && <div className="error" onClick={() => setError("")}>{error}</div>}
      <section className="content">
        {page === "pipeline" && selected && <PipelineWorkbench workspaceId={workspaceId} selected={selected} fail={setError} />}
        {page === "pipeline" && !selected && <Empty title="工作空间不可用" detail="请返回工作空间列表，选择一项进入工作台。" />}
        {page === "workspaces" && <Overview workspaces={workspaces} reload={reload} enter={(id) => { setWorkspaceId(id); setPage("pipeline"); }} fail={setError} />}
        {!workspaceId && page !== "pipeline" && page !== "workspaces" && <Empty title="还没有 Workspace" detail="先在工作空间中注册一个项目文件夹。" />}
        {workspaceId && page === "history" && <Builds workspaceId={workspaceId} fail={setError} />}
        {workspaceId && page === "layers" && <Layers workspaceId={workspaceId} fail={setError} />}
        {workspaceId && page === "reviews" && <Reviews workspaceId={workspaceId} fail={setError} />}
        {workspaceId && page === "context" && <ContextLab workspaceId={workspaceId} fail={setError} />}
      </section>
    </main>
  </div>;
}

type BuildJobView = JsonObject & {
  id: string;
  status: string;
  createdAtMs: number;
  finishedAtMs?: number;
  request?: JsonObject;
  summary?: JsonObject;
  error?: string;
};

type BuildEventView = JsonObject & {
  sequence: number;
  kind: string;
  stage: string;
  message: string;
  timestampMs: number;
};

const orderedBuildStages = ["capture", "normalize", "structure", "evidence", "fact", "scope", "semantic", "project"];

function jobIncludesStage(job: BuildJobView | undefined, stage: string) {
  const request = job?.request as JsonObject | undefined;
  const from = orderedBuildStages.indexOf(String(request?.fromStage ?? "capture"));
  const to = orderedBuildStages.indexOf(String(request?.toStage ?? "project"));
  const target = orderedBuildStages.indexOf(stage);
  return target >= from && target <= to;
}

function stageResult(job: BuildJobView | undefined, stage: string) {
  const stages = job?.summary?.stages as JsonObject | undefined;
  return stages?.[stage] as JsonObject | undefined;
}

function PipelineWorkbench({ workspaceId, selected, fail }: {
  workspaceId: string;
  selected: Workspace;
  fail: (value: string) => void;
}) {
  const [activeStage, setActiveStage] = useState<PipelineStageId>("workspace");
  const [view, setView] = useState<WorkbenchView>("config");
  const [jobs, setJobs] = useState<BuildJobView[]>([]);
  const [events, setEvents] = useState<BuildEventView[]>([]);
  const [running, setRunning] = useState(false);
  const { loaded } = useConfig(workspaceId, fail);

  const reloadJobs = useCallback(async () => {
    if (!workspaceId) { setJobs([]); return; }
    const values = await api.request<BuildJobView[]>(`/workspaces/${workspaceId}/builds`);
    values.sort((left, right) => Number(right.createdAtMs) - Number(left.createdAtMs));
    setJobs(values);
  }, [workspaceId]);

  useEffect(() => {
    void reloadJobs().catch((error: Error) => fail(error.message));
    if (!workspaceId) return;
    const timer = window.setInterval(() => void reloadJobs().catch(() => undefined), 2500);
    return () => window.clearInterval(timer);
  }, [workspaceId, reloadJobs, fail]);

  const latest = jobs[0];
  useEffect(() => {
    setEvents([]);
    if (!workspaceId || !latest?.id) return;
    const stream = new EventSource(`/api/v1/workspaces/${workspaceId}/builds/${latest.id}/events`);
    const receive = (event: Event) => {
      const value = JSON.parse((event as MessageEvent).data) as BuildEventView;
      setEvents((current) => current.some((item) => item.sequence === value.sequence) ? current : [...current, value]);
      if (value.kind === "result") { stream.close(); setRunning(false); void reloadJobs(); }
    };
    stream.addEventListener("build", receive);
    stream.onerror = () => { stream.close(); setRunning(false); void reloadJobs(); };
    return () => stream.close();
  }, [workspaceId, latest?.id, reloadJobs]);

  useEffect(() => {
    if (["succeeded", "succeeded_with_warnings", "partial", "failed", "cancelled", "interrupted"].includes(String(latest?.status ?? ""))) setRunning(false);
  }, [latest?.status]);

  const run = async (from: PipelineStageId, to: PipelineStageId = from, full = false, checkpoint?: NormalizationCheckpoint) => {
    if (!workspaceId) { setActiveStage("workspace"); return false; }
    const start = pipelineStages.find((value) => value.id === from)!;
    const end = pipelineStages.find((value) => value.id === to)!;
    try {
      setRunning(true);
      const job = await api.request<BuildJobView>(`/workspaces/${workspaceId}/builds`, {
        method: "POST",
        body: JSON.stringify({
          full,
          fromStage: start.buildStage,
          toStage: end.buildStage,
          ...(checkpoint ? { resumeProcessed: checkpoint.processed, resumeTotal: checkpoint.total } : {}),
        }),
      });
      setJobs((current) => [job, ...current.filter((value) => value.id !== job.id)]);
      setEvents([]);
      return true;
    } catch (error) {
      setRunning(false);
      fail((error as Error).message);
      return false;
    }
  };

  const stop = async () => {
    const job = jobs.find((value) => ["queued", "running", "cancelling"].includes(String(value.status)));
    if (!job) { setRunning(false); await reloadJobs(); return false; }
    try {
      const cancelling = await api.request<BuildJobView>(`/workspaces/${workspaceId}/builds/${job.id}/cancel`, { method: "POST" });
      setJobs((current) => current.map((value) => value.id === cancelling.id ? cancelling : value));
      return true;
    } catch (error) {
      setRunning(false);
      await reloadJobs().catch(() => undefined);
      fail((error as Error).message);
      return false;
    }
  };

  const selectedStage = pipelineStages.find((value) => value.id === activeStage)!;
  const configuredSources = (loaded?.config.sources as JsonObject[] | undefined)?.length ?? 0;
  const selectedNormalizers = configuredNormalizerIds(loaded?.config).size;
  const currentStageEvents = events.filter((event) => {
    if (activeStage === "workspace") return ["queued", "discover"].includes(event.stage);
    if (activeStage === "sources") return ["discover", "capture"].includes(event.stage);
    if (scopeStages[activeStage] && event.stage === "scope") return true;
    return event.stage === selectedStage.buildStage || (activeStage === "project" && event.stage === "complete");
  });
  const activeJob = running || ["queued", "running", "cancelling"].includes(String(latest?.status ?? ""));
  const normalizing = activeJob && jobIncludesStage(latest, "normalize");
  const structuring = activeJob && jobIncludesStage(latest, "structure");
  const lastNormalizationJob = jobs.find((job) => stageResult(job, "normalize"));
  const lastStructureJob = jobs.find((job) => stageResult(job, "structure"));

  const nodeState = (stage: typeof pipelineStages[number]) => {
    if (stage.id === "workspace") return workspaceId ? "configured" : "required";
    if (!workspaceId) return "locked";
    if (stage.id === "sources" && configuredSources === 0) return "required";
    if (stage.id === "normalize" && selectedNormalizers === 0) return "required";
    const matching = events.filter((event) => event.stage === stage.buildStage);
    if (activeJob && matching.length) return "running";
    if (matching.length) return "complete";
    return "configured";
  };

  return <div className="pipeline-workbench">
    <section className="pipeline-topbar">
      <div><span className="eyebrow">GLOBAL PIPELINE</span><h2>项目上下文发布流水线</h2><p>配置一次，增量运行；从任意节点重跑时自动校验并复用前置产物。</p></div>
      <div className="pipeline-actions"><button disabled={!workspaceId || activeJob} onClick={() => run("sources", "project")}>{activeJob ? "运行中…" : "运行流水线"}</button></div>
      <div className="run-summary"><span className={`status ${String(latest?.status ?? "idle")}`}>{latest?.status ?? "未运行"}</span><small>{latest ? new Date(Number(latest.createdAtMs)).toLocaleString() : selected.displayName}</small></div>
    </section>

    <section className="pipeline-canvas" aria-label="全局流水线">
      {pipelineStages.map((stage, index) => <div className="pipeline-node-wrap" key={stage.id}>
        <button className={`pipeline-node ${activeStage === stage.id ? "active" : ""} ${nodeState(stage)}`} disabled={!workspaceId && stage.id !== "workspace"} onClick={() => { setActiveStage(stage.id); setView("config"); }}>
          <span className="node-index">{String(index + 1).padStart(2, "0")}</span><i /><b>{stage.label}</b><em>{nodeStateLabel(nodeState(stage))}</em>
        </button>
        {index < pipelineStages.length - 1 && <span className="pipeline-arrow">→</span>}
      </div>)}
    </section>

    <div className="pipeline-detail-layout workspace-layout">
      <section className="stage-inspector" aria-label={`${selectedStage.label}节点工作区`}>
        {activeStage !== "workspace" && <div className="stage-toolbar">
          {activeStage === "sources" ? <div className="stage-tabs" role="tablist" aria-label="数据源工作区"><button className={view === "config" ? "active" : ""} onClick={() => setView("config")}>配置</button><button className={view === "scope" ? "active" : ""} onClick={() => setView("scope")}>Scope</button><button className={view === "trash" ? "active" : ""} onClick={() => setView("trash")}>回收站</button><button className={view === "logs" ? "active" : ""} onClick={() => setView("logs")}>日志</button></div> : <div className="stage-tabs" role="tablist" aria-label="节点工作区"><button className={view === "config" ? "active" : ""} onClick={() => setView("config")}>配置</button><button className={view === "output" ? "active" : ""} disabled={!workspaceId} onClick={() => setView("output")}>产物</button><button className={view === "logs" ? "active" : ""} disabled={!workspaceId} onClick={() => setView("logs")}>日志</button><button className={view === "history" ? "active" : ""} disabled={!workspaceId} onClick={() => setView("history")}>历史</button></div>}
          {!['sources', 'normalize', 'structure'].includes(activeStage) && <div className="stage-run-actions"><button className="ghost" title="复用上游产物，只执行当前节点" disabled={!workspaceId || activeJob} onClick={() => run(activeStage)}>仅运行此步</button><button className="ghost" title="从数据源开始，依次执行到当前节点" disabled={!workspaceId || activeJob} onClick={() => run("sources", activeStage)}>运行至此</button></div>}
        </div>}
        {view === "config" && activeStage === "workspace" && <WorkspaceStage selected={selected} fail={fail} />}
        {view === "config" && workspaceId && activeStage === "sources" && <Sources workspaceId={workspaceId} fail={fail} />}
        {view === "config" && workspaceId && activeStage === "normalize" && <Normalizers workspaceId={workspaceId} running={normalizing} currentJob={latest} latestJob={lastNormalizationJob} events={currentStageEvents} onRun={(full, checkpoint) => run("normalize", "normalize", full, checkpoint)} onStop={stop} openOutput={() => setView("output")} fail={fail} />}
        {view === "config" && workspaceId && activeStage === "structure" && <StructureStage workspaceId={workspaceId} running={structuring} currentJob={latest} latestJob={lastStructureJob} events={currentStageEvents} onRun={(full) => run("structure", "structure", full)} onRunTo={() => run("sources", "structure")} onStop={stop} fail={fail} />}
        {view === "config" && workspaceId && !["workspace", "sources", "normalize", "structure"].includes(activeStage) && <SystemStage stage={activeStage} open={setView} />}
        {view === "output" && workspaceId && <NodeOutput workspaceId={workspaceId} stage={activeStage} fail={fail} />}
        {view === "scope" && workspaceId && activeStage === "sources" && <LayerScopeView workspaceId={workspaceId} stage={activeStage} fail={fail} />}
        {view === "trash" && workspaceId && activeStage === "sources" && <SourceTrash workspaceId={workspaceId} fail={fail} />}
        {view === "history" && workspaceId && <Builds workspaceId={workspaceId} fail={fail} />}
        {view === "logs" && workspaceId && <NodeLogTab stage={selectedStage.label} events={currentStageEvents} />}
      </section>
    </div>
  </div>;
}

type WorkspaceFileEntry = {
  name: string;
  path: string;
  kind: "directory" | "file" | "symlink" | "other";
  sizeBytes: number;
  modifiedAtMs?: number;
};

function WorkspaceStage({ selected, fail }: { selected: Workspace; fail: (value: string) => void }) {
  const [children, setChildren] = useState<Record<string, WorkspaceFileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [selectedEntry, setSelectedEntry] = useState<WorkspaceFileEntry>();

  const loadDirectory = useCallback(async (path: string) => {
    if (children[path]) return;
    setLoading((current) => new Set(current).add(path));
    try {
      const query = path ? `?path=${encodeURIComponent(path)}` : "";
      const values = await api.request<WorkspaceFileEntry[]>(`/workspaces/${selected.workspaceId}/files${query}`);
      setChildren((current) => ({ ...current, [path]: values }));
    } catch (error) {
      fail((error as Error).message);
    } finally {
      setLoading((current) => { const next = new Set(current); next.delete(path); return next; });
    }
  }, [children, selected.workspaceId, fail]);

  useEffect(() => {
    setChildren({}); setExpanded(new Set([""])); setSelectedEntry(undefined);
    void api.request<WorkspaceFileEntry[]>(`/workspaces/${selected.workspaceId}/files`)
      .then((values) => setChildren({ "": values }))
      .catch((error: Error) => fail(error.message));
  }, [selected.workspaceId, fail]);

  const toggle = async (entry: WorkspaceFileEntry) => {
    setSelectedEntry(entry);
    if (entry.kind !== "directory") return;
    const isExpanded = expanded.has(entry.path);
    setExpanded((current) => { const next = new Set(current); isExpanded ? next.delete(entry.path) : next.add(entry.path); return next; });
    if (!isExpanded) await loadDirectory(entry.path);
  };
  const renderEntries = (path: string, depth = 0): ReactNode => (children[path] ?? []).map((entry) => <div key={entry.path}>
    <button className={`workspace-tree-row ${selectedEntry?.path === entry.path ? "active" : ""}`} style={{ paddingLeft: `${10 + depth * 18}px` }} onClick={() => void toggle(entry)}>
      <span className="tree-toggle">{entry.kind === "directory" ? (expanded.has(entry.path) ? "⌄" : "›") : entry.kind === "file" ? "·" : "↗"}</span><b>{entry.name}</b>{entry.kind === "file" && <small>{formatBytes(entry.sizeBytes)}</small>}
    </button>
    {entry.kind === "directory" && expanded.has(entry.path) && <div>{loading.has(entry.path) ? <div className="tree-loading" style={{ paddingLeft: `${32 + depth * 18}px` }}>读取中…</div> : renderEntries(entry.path, depth + 1)}</div>}
  </div>);

  return <div className="stage-config-body"><div className="workspace-files"><section className="workspace-tree"><div className="workspace-tree-root"><span>⌄</span><b>{selected.displayName}</b><small>{children[""]?.length ?? 0} 项</small></div>{children[""] ? renderEntries("") : <div className="tree-loading">读取目录…</div>}</section><section className="workspace-file-detail">{selectedEntry ? <><span className="file-glyph">{selectedEntry.kind === "directory" ? "⌄" : selectedEntry.kind === "file" ? "◇" : "↗"}</span><h3>{selectedEntry.name}</h3><p>{selectedEntry.path}</p><dl><div><dt>类型</dt><dd>{fileKindLabel(selectedEntry.kind)}</dd></div><div><dt>相对路径</dt><dd>{selectedEntry.path}</dd></div><div><dt>绝对路径</dt><dd>{selected.root}/{selectedEntry.path}</dd></div><div><dt>大小</dt><dd>{selectedEntry.kind === "file" ? formatBytes(selectedEntry.sizeBytes) : "—"}</dd></div><div><dt>修改时间</dt><dd>{selectedEntry.modifiedAtMs ? new Date(selectedEntry.modifiedAtMs).toLocaleString() : "—"}</dd></div></dl></> : <Empty title="选择文件" detail="展开左侧文件夹，点击文件后在这里查看详情。" />}</section></div></div>;
}

type StructureParserDescriptorView = {
  id: string;
  displayName: string;
  implementationVersion: string;
};

type StructureFormatView = {
  extension: string;
  format: string;
  fileCount: number;
  selectedParserId?: string;
  compatibleParsers: StructureParserDescriptorView[];
  status: string;
};

type StructureFamilyView = {
  family: string;
  label: string;
  fileCount: number;
  formatCount: number;
  formats: StructureFormatView[];
};

type StructureRouteView = {
  extension: string;
  parserId: string;
  config: JsonObject;
};

type StructureConfigView = {
  etag: string;
  policy: { routes: StructureRouteView[] };
  families: StructureFamilyView[];
};

function conciseStructureParserName(parserId: string) {
  if (parserId.startsWith("tree-sitter")) return "tree-sitter";
  if (parserId.startsWith("markdown")) return "markdown-ast";
  return parserId;
}

function StructureStage({ workspaceId, running, currentJob, latestJob, events, onRun, onRunTo, onStop, fail }: {
  workspaceId: string;
  running: boolean;
  currentJob?: BuildJobView;
  latestJob?: BuildJobView;
  events: BuildEventView[];
  onRun: (full: boolean) => Promise<boolean>;
  onRunTo: () => Promise<boolean>;
  onStop: () => Promise<boolean>;
  fail: (value: string) => void;
}) {
  const [config, setConfig] = useState<StructureConfigView>();
  const [routes, setRoutes] = useState<StructureRouteView[]>([]);
  const [saving, setSaving] = useState(false);
  const [requested, setRequested] = useState(false);

  const reload = useCallback(async () => {
    const value = await api.request<StructureConfigView>(`/workspaces/${workspaceId}/structure/config`);
    setConfig(value);
    setRoutes(value.policy.routes.map((route) => ({ ...route, config: { ...(route.config ?? {}) } })));
  }, [workspaceId]);

  useEffect(() => {
    void reload().catch((error: Error) => fail(error.message));
  }, [reload, fail]);

  const routeFor = (extension: string) => routes.find((route) => route.extension.replace(/^\./, "") === extension.replace(/^\./, ""));
  const choose = (extension: string, parserId: string) => {
    setRoutes((current) => {
      const normalized = extension.replace(/^\./, "");
      const existing = current.find((route) => route.extension.replace(/^\./, "") === normalized);
      return existing
        ? current.map((route) => route === existing ? { ...route, parserId, config: {} } : route)
        : [...current, { extension: normalized, parserId, config: {} }];
    });
  };
  const dirty = Boolean(config) && JSON.stringify(routes) !== JSON.stringify(config?.policy.routes ?? []);
  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      const value = await api.request<StructureConfigView>(`/workspaces/${workspaceId}/structure/config`, {
        method: "PUT",
        headers: { "if-match": config.etag },
        body: JSON.stringify({ policy: { routes } }),
      });
      setConfig(value);
      setRoutes(value.policy.routes);
    } catch (error) {
      fail((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const jobStatus = String(currentJob?.status ?? "");
  const recoverable = ["cancelled", "interrupted", "failed"].includes(jobStatus) && jobIncludesStage(currentJob, "structure");
  const result = stageResult(latestJob, "structure");
  const progressEvent = [...events].reverse().find((event) => {
    const data = buildEventData(event);
    return event.stage === "structure" && data && Number.isFinite(Number(data.percent));
  });
  const progressData = buildEventData(progressEvent);
  const succeeded = ["succeeded", "succeeded_with_warnings", "partial"].includes(jobStatus);
  const percent = running
    ? Math.max(0, Math.min(99, Number(progressData?.percent ?? 0)))
    : requested && succeeded
      ? 100
      : Math.max(0, Math.min(100, Number(progressData?.percent ?? (result ? 100 : 0))));
  const completedFiles = Number(progressData?.completedFiles ?? 0);
  const totalFiles = Number(progressData?.totalFiles ?? 0);
  const generated = Number(progressData?.generatedUnits ?? result?.records ?? 0);
  const taskEvents = events
    .filter((event) => event.stage === "structure" && buildEventData(event)?.currentFile)
    .slice(-9);
  const execute = async () => {
    setRequested(true);
    if (!await onRun(false)) setRequested(false);
  };

  if (!config) return <Loading />;
  return <div className="structure-console">
    <section className="structure-hero">
      <div><span className="eyebrow">PLUGGABLE STRUCTURE PARSING</span><h3>自动结构解析</h3><p>按标准化输出格式自动选择解析器。分组只用于管理展示，每个后缀仍只命中一个已保存的 Parser。</p></div>
      <div className="structure-actions">
        {running ? <button className="stop-action" onClick={() => void onStop()}>停止</button> : <>
          <button disabled={dirty} title={dirty ? "请先保存解析器配置" : "复用标准化产物，只运行结构节点"} onClick={() => void execute()}>运行</button>
          <button className="ghost" disabled={dirty} title="从数据源开始运行到结构节点" onClick={() => void onRunTo()}>运行至此</button>
        </>}
      </div>
    </section>

    <section className="structure-routing-head"><div><b>文件类型与解析器</b><p>按文件族集中管理；每种后缀选择一个解析器，保存后参与执行。</p></div><div><button className="ghost" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "保存中…" : dirty ? "保存配置" : "已保存"}</button></div></section>
    <div className="structure-family-list">
      {config.families.map((family) => <section className="structure-family" key={family.family}>
        <header><b>{family.label}</b></header>
        <div className="structure-format-chips">{family.formats.map((format) => {
          const selectedId = routeFor(format.extension)?.parserId;
          const unavailable = format.compatibleParsers.length === 0;
          return <label className={`structure-format-row ${unavailable ? "unavailable" : ""}`} key={format.extension}>
            <code>{format.extension}</code>
            <select aria-label={`${format.extension} 解析器`} value={selectedId ?? ""} disabled={unavailable} onChange={(event) => choose(format.extension, event.target.value)}>
              {!selectedId && !unavailable && <option value="">未配置</option>}
              {unavailable
                ? <option value="">暂无解析器</option>
                : format.compatibleParsers.map((parser) => <option value={parser.id} key={parser.id}>{conciseStructureParserName(parser.id)}</option>)}
            </select>
          </label>;
        })}</div>
      </section>)}
    </div>

    {(requested || running || recoverable || result) && <section className="normalization-progress-panel visible structure-progress-panel">
      <div className="normalization-progress-head"><b>{running ? "正在解析文件结构" : recoverable ? "任务已停止，可继续或重新执行" : "结构解析完成"}</b><span>{completedFiles}/{totalFiles || "—"} 文件 · {generated} 条目</span></div>
      <div className="normalization-progress-row"><div className="normalization-progress"><span className="normalization-progress-fill" style={{ width: `${percent}%` }} /><i className="normalization-progress-value" style={{ left: `${percent}%` }}>{percent}%</i></div></div>
      <div className="normalization-phases"><span>读取 Artifact</span><span>选择 Parser</span><span>生成节点与关系</span><span>原子提交</span></div>
      <div className="normalization-stream-head"><b>最近解析明细</b><span>高速任务仅保留最新记录</span></div>
      <div className="normalization-task-stream">{taskEvents.length ? taskEvents.map((event) => { const data = buildEventData(event)!; return <div className="normalization-task-line" key={event.sequence}><span className="task-action done">{String(data.phase ?? "解析")}</span><b>{String(data.currentFile)}</b><code>{String(data.parserId ?? "Parser")} · {Number(data.generatedUnits ?? 0)} 条</code></div>; }) : <div className="normalization-task-empty">执行后会高速显示：文件、Parser、解析阶段、生成条目与提交结果。</div>}</div>
    </section>}
  </div>;
}

function SystemStage({ stage, open }: { stage: PipelineStageId; open: (view: WorkbenchView) => void }) {
  const settings: Record<string, Array<[string, string]>> = {
    structure: [["Processor Registry", "Markdown + TypeScript（自动匹配）"], ["稳定键", "标题路径 / 符号路径"]],
    evidence: [["定位策略", "Normalized span → Original Locator"], ["Lineage", "保留全部父级修订"]],
    fact: [["修订策略", "Append-only revisions"], ["证据要求", "至少一个 EvidenceRef"]],
    semantic: [["推断策略", "基于 Fact 与 EffectiveScope 自动生成"], ["对称关系", "规范化端点去重"]],
    project: [["Agent 文件", ".context/sources"], ["索引", "SQLite FTS5 + Context View"]],
  };
  return <div className="system-settings"><div className="fixed-policy"><span>自动推断策略</span><p>Scope 与语义关系由编译流水线自动推断、继承并记录来源，不要求用户逐条处理细粒度对象。</p></div>{(settings[stage] ?? []).map(([label, value]) => <label key={label}>{label}<div className="readonly-field">{value}<span>LOCKED</span></div></label>)}<button className="ghost" onClick={() => open("output")}>查看节点产物</button></div>;
}

function NodeOutput({ workspaceId, stage, fail }: { workspaceId: string; stage: PipelineStageId; fail: (value: string) => void }) {
  return <LayerProduct workspaceId={workspaceId} stage={stage} fail={fail} />;
}

function NodeLogTab({ stage, events }: { stage: string; events: BuildEventView[] }) {
  return <section className="stage-log-tab"><div className="stage-log-head"><div><span className="console-light" /><b>{stage}日志</b></div><span>{events.length} 条事件</span></div><div className="history-console">{events.length ? events.map((event) => <div className="console-line" key={event.sequence}><time>{new Date(Number(event.timestampMs)).toLocaleTimeString()}</time><span>{event.stage}</span><p>{event.message}</p></div>) : <div className="console-empty">尚无 {stage} 节点日志。运行流水线后，事件会显示在这里。</div>}</div></section>;
}

function nodeStateLabel(state: string) {
  return ({ required: "待配置", locked: "未解锁", configured: "已配置", running: "运行中", complete: "已完成" } as Record<string, string>)[state] ?? state;
}

function configuredNormalizerIds(config?: JsonObject) {
  const ids = new Set<string>();
  const normalization = config?.normalization as JsonObject | undefined;
  for (const rule of (normalization?.defaults as JsonObject[] | undefined) ?? []) if (rule.enabled !== false) ids.add(String(rule.normalizerId));
  for (const source of (normalization?.sourceOverrides as JsonObject[] | undefined) ?? []) for (const rule of (source.rules as JsonObject[] | undefined) ?? []) if (rule.enabled !== false) ids.add(String(rule.normalizerId));
  for (const path of (normalization?.pathOverrides as JsonObject[] | undefined) ?? []) { const rule = path.rule as JsonObject | undefined; if (rule && rule.enabled !== false) ids.add(String(rule.normalizerId)); }
  return ids;
}

function Overview({ workspaces, reload, enter, fail }: { workspaces: Workspace[]; reload: () => Promise<void>; enter: (id: string) => void; fail: (value: string) => void }) {
  const [root, setRoot] = useState("");
  const [doctor, setDoctor] = useState<{ workspaceId: string; value: JsonObject }>();
  const register = async (event: FormEvent) => { event.preventDefault(); try { await api.request<Workspace>("/workspaces", { method: "POST", body: JSON.stringify({ root }) }); await reload(); setRoot(""); } catch (error) { fail((error as Error).message); } };
  const diagnose = async (workspaceId: string) => { try { setDoctor({ workspaceId, value: await api.request(`/workspaces/${workspaceId}/doctor`) }); } catch (error) { fail((error as Error).message); } };
  return <div className="workspace-page"><section className="workspace-page-head"><div><span className="eyebrow">WORKSPACES</span><h2>项目工作空间</h2><p>从这里注册项目，并进入它的上下文流水线。工作台只从列表进入。</p></div><strong>{workspaces.length.toString().padStart(2, "0")}</strong></section><article className="workspace-register"><form onSubmit={register}><div><b>新增工作空间</b><p>填写项目文件夹绝对路径；不会复制、移动或删除项目文件。</p></div><input value={root} onChange={(event) => setRoot(event.target.value)} placeholder="/absolute/path/to/project" required /><button>新增</button></form></article><article className="workspace-catalog"><div className="workspace-catalog-head"><b>工作空间列表</b><span>{workspaces.length} 项</span></div>{workspaces.length ? <div className="workspace-list">{workspaces.map((workspace) => <div className="workspace-list-item" key={workspace.workspaceId}><div className="workspace-list-main"><span className="workspace-avatar">{workspace.displayName.slice(0, 1).toUpperCase()}</span><div><b>{workspace.displayName}</b><code>{workspace.root}</code><small>{workspace.workspaceId}</small></div></div><div className="workspace-list-actions"><button className="ghost" onClick={() => void diagnose(workspace.workspaceId)}>Doctor</button><button onClick={() => enter(workspace.workspaceId)}>进入工作台</button></div>{doctor?.workspaceId === workspace.workspaceId && <pre className="workspace-doctor">{JSON.stringify(doctor.value, null, 2)}</pre>}</div>)}</div> : <Empty title="还没有工作空间" detail="在上方新增一个项目文件夹后，它会出现在这里。" />}</article></div>;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function fileKindLabel(kind: WorkspaceFileEntry["kind"]) {
  return ({ directory: "文件夹", file: "文件", symlink: "符号链接", other: "其他" })[kind];
}

function useConfig(workspaceId: string, fail: (value: string) => void) {
  const [loaded, setLoaded] = useState<LoadedConfig>();
  const reload = useCallback(async () => {
    if (!workspaceId) { setLoaded(undefined); return; }
    await api.config(workspaceId).then(setLoaded).catch((e: Error) => fail(e.message));
  }, [workspaceId, fail]);
  useEffect(() => { void reload(); }, [reload]);
  return { loaded, reload };
}

function Sources({ workspaceId, fail }: { workspaceId: string; fail: (value: string) => void }) {
  const { loaded, reload } = useConfig(workspaceId, fail);
  const [kind, setKind] = useState("local"); const [id, setId] = useState(""); const [location, setLocation] = useState("");
  const [adding, setAdding] = useState(false); const [selectedSourceId, setSelectedSourceId] = useState(""); const [discovery, setDiscovery] = useState<ConnectorObjectView[]>([]); const [discovering, setDiscovering] = useState(false); const [syncingSourceId, setSyncingSourceId] = useState("");
  const sources = (loaded?.config.sources as JsonObject[] | undefined) ?? [];
  const save = async (config: JsonObject) => { if (!loaded) return false; try { await api.saveConfig(workspaceId, config, loaded.etag); await reload(); return true; } catch (e) { fail((e as Error).message); return false; } };
  const add = async (event: FormEvent) => { event.preventDefault(); const source = { id, connectorId: kind, displayName: id, enabled: true, config: kind === "local" ? { root: location, include: ["**/*"], exclude: [".git/**", ".context/**", "target/**"] } : { repository: location, include: ["**/*"], exclude: [".git/**", "target/**"] }, secretRefs: [] }; if (!await save({ ...loaded!.config, sources: [...sources, source] })) return; setId(""); setLocation(""); setKind("local"); setAdding(false); };
  const remove = async (sourceId: string) => { if (!confirm(`将数据源 ${sourceId} 移入回收站？历史 revision 和配置都会保留。`)) return; const deletedAtMs = Date.now(); const config = moveSourceToTrash(loaded!.config, sourceId, deletedAtMs, `${sourceId}:${deletedAtMs}:${crypto.randomUUID()}`); if (!await save(config)) return; if (selectedSourceId === sourceId) { setSelectedSourceId(""); setDiscovery([]); } };
  const discover = async (sourceId: string) => { setSelectedSourceId(sourceId); setDiscovery([]); setDiscovering(true); try { setDiscovery(await discoverAll(workspaceId, sourceId)); } catch (e) { fail((e as Error).message); } finally { setDiscovering(false); } };
  const sync = async (sourceId: string) => { setSyncingSourceId(sourceId); try { const job = await api.request<BuildJobView>(`/workspaces/${workspaceId}/builds`, { method: "POST", body: JSON.stringify({ full: false, sourceIds: [sourceId], fromStage: "capture", toStage: "capture" }) }); let current = job; while (!["succeeded", "succeeded_with_warnings", "partial", "failed", "cancelled", "interrupted"].includes(current.status)) { await new Promise((resolve) => window.setTimeout(resolve, 700)); current = await api.request<BuildJobView>(`/workspaces/${workspaceId}/builds/${job.id}`); } if (!["succeeded", "succeeded_with_warnings", "partial"].includes(current.status)) throw new Error(current.error ? String(current.error) : `同步失败：${current.status}`); await discover(sourceId); } catch (e) { fail((e as Error).message); } finally { setSyncingSourceId(""); } };
  if (!loaded) return <Loading />;
  const selectedSource = sources.find((source) => String(source.id) === selectedSourceId);
  return <div className="source-config"><div className="source-config-head"><div><b>数据源</b><p>配置 Connector，并查看每个数据源实际发现的文件结构。</p></div><button onClick={() => setAdding(true)}>新增数据源</button></div><div className="source-config-layout"><section className="source-list"><div className="source-list-head"><span>已配置</span><small>{sources.length} 个数据源</small></div>{sources.length ? sources.map((source) => { const sourceId = String(source.id); const syncing = syncingSourceId === sourceId; return <div className={`source-list-row ${selectedSourceId === sourceId ? "active" : ""}`} key={sourceId}><div className="source-list-identity"><span className="badge">{String(source.connectorId)}</span><b>{String(source.displayName ?? sourceId)}</b></div><div className="source-row-actions"><button className="source-action" disabled={syncing} onClick={() => void discover(sourceId)}>查看</button><button className="source-action" disabled={Boolean(syncingSourceId)} onClick={() => void sync(sourceId)}>{syncing ? "同步中…" : "同步"}</button><button className="source-action source-delete" disabled={syncing} onClick={() => void remove(sourceId)}>删除</button></div></div>; }) : <Empty title="还没有数据源" detail="点击右上角“新增数据源”开始配置。" />}</section><section className="source-file-panel"><div className="source-file-head"><div><b>{selectedSource ? String(selectedSource.displayName ?? selectedSource.id) : "文件结构"}</b><p>{selectedSource ? String(selectedSource.connectorId) : "选择一个数据源查看发现结果"}</p></div>{selectedSource && <span>{discovering ? "读取中…" : `${discovery.length} 个文件`}</span>}</div>{discovering ? <Loading /> : selectedSource ? discovery.length ? <ConnectorFileTree objects={discovery} /> : <Empty title="暂无文件" detail="该数据源没有发现符合 include/exclude 规则的文件。" /> : <Empty title="选择数据源" detail="点击列表中的“查看”，文件树会在这里展开。" />}</section></div>{adding && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAdding(false); }}><section className="source-modal" role="dialog" aria-modal="true" aria-labelledby="source-modal-title"><div className="source-modal-head"><div><span className="eyebrow">SOURCE CONNECTOR</span><h3 id="source-modal-title">新增数据源</h3><p>Local 与 Git 使用同一 Connector 契约。</p></div><button className="text-button" aria-label="关闭新增数据源" onClick={() => setAdding(false)}>×</button></div><form onSubmit={add} className="source-modal-form"><label>类型<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="local">Local</option><option value="git">Git</option></select></label><label>唯一 ID<input value={id} onChange={(event) => setId(event.target.value)} placeholder="例如 docs" required autoFocus /></label><label className="span2">{kind === "local" ? "根目录" : "仓库 URL / 本地仓库"}<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder={kind === "local" ? "/absolute/path/to/source" : "https://… 或本地路径"} required /></label><div className="source-modal-actions"><button type="button" className="ghost" onClick={() => setAdding(false)}>取消</button><button>确定</button></div></form></section></div>}</div>;
}

function SourceTrash({ workspaceId, fail }: { workspaceId: string; fail: (value: string) => void }) {
  const { loaded, reload } = useConfig(workspaceId, fail);
  const [restoring, setRestoring] = useState("");
  if (!loaded) return <Loading />;
  const sources = (loaded.config.sources as JsonObject[] | undefined) ?? [];
  const entries = ((loaded.config.sourceTrash as JsonObject[] | undefined) ?? []).slice().sort((left, right) => Number(right.deletedAtMs) - Number(left.deletedAtMs));
  const activeIds = new Set(sources.map((source) => String(source.id)));
  const restore = async (entry: JsonObject) => {
    const source = entry.source as JsonObject;
    const sourceId = String(source.id);
    const trashId = String(entry.trashId);
    if (activeIds.has(sourceId)) { fail(`无法还原 ${sourceId}：当前已存在同名数据源。`); return; }
    setRestoring(trashId);
    try {
      await api.saveConfig(workspaceId, restoreSourceFromTrash(loaded.config, trashId), loaded.etag);
      await reload();
    } catch (error) {
      fail((error as Error).message);
    } finally {
      setRestoring("");
    }
  };
  return <div className="source-trash"><div className="source-trash-head"><div><b>回收站</b><p>删除只会停用数据源；配置、历史 revision 与审核记录仍会保留。</p></div><span>{entries.length} 条记录</span></div>{entries.length ? <div className="source-trash-list">{entries.map((entry) => { const source = entry.source as JsonObject; const sourceId = String(source.id); const connectorConfig = (source.config as JsonObject | undefined) ?? {}; const location = String(connectorConfig.root ?? connectorConfig.repository ?? ""); const conflict = activeIds.has(sourceId); return <div className="source-trash-row" key={String(entry.trashId)}><div className="source-trash-main"><span className="badge">{String(source.connectorId)}</span><div><b>{String(source.displayName ?? sourceId)}</b><small>{location || sourceId}</small></div></div><time>{new Date(Number(entry.deletedAtMs)).toLocaleString()}</time><button className="source-action source-restore" disabled={Boolean(restoring) || conflict} title={conflict ? "当前存在同名数据源" : "恢复到数据源列表"} onClick={() => void restore(entry)}>{restoring === entry.trashId ? "还原中…" : conflict ? "名称冲突" : "还原"}</button></div>; })}</div> : <Empty title="回收站为空" detail="删除的数据源会保留在这里，并可随时还原。" />}</div>;
}

type ConnectorObjectView = { stableKey: string; uri: string; title: string; mediaType: string; extension?: string; sizeBytes: number; modifiedAt?: number };
type ConnectorTreeNode = { name: string; path: string; children: ConnectorTreeNode[]; object?: ConnectorObjectView };

async function discoverAll(workspaceId: string, sourceId: string) {
  const objects: ConnectorObjectView[] = [];
  let cursor = "";
  do {
    const query = new URLSearchParams({ limit: "10000" });
    if (cursor) query.set("cursor", cursor);
    const page = await api.request<{ objects: ConnectorObjectView[]; nextCursor?: string }>(`/workspaces/${workspaceId}/sources/${sourceId}/discover?${query}`);
    objects.push(...page.objects); cursor = page.nextCursor ?? "";
  } while (cursor);
  return objects;
}

function buildConnectorTree(objects: ConnectorObjectView[]) {
  const root: ConnectorTreeNode = { name: "", path: "", children: [] };
  for (const object of objects) {
    const segments = object.stableKey.replace(/^\/+/, "").split("/").filter(Boolean);
    let current = root;
    segments.forEach((name, index) => {
      const path = segments.slice(0, index + 1).join("/");
      let child = current.children.find((value) => value.name === name);
      if (!child) { child = { name, path, children: [] }; current.children.push(child); }
      current = child;
    });
    current.object = object;
  }
  const sort = (nodes: ConnectorTreeNode[]) => { nodes.sort((left, right) => Number(Boolean(left.object)) - Number(Boolean(right.object)) || left.name.localeCompare(right.name)); nodes.forEach((node) => sort(node.children)); };
  sort(root.children);
  return root.children;
}

function ConnectorFileTree({ objects }: { objects: ConnectorObjectView[] }) {
  const tree = useMemo(() => buildConnectorTree(objects), [objects]);
  return <div className="connector-tree">{tree.map((node) => <ConnectorTreeBranch node={node} depth={0} key={node.path} />)}</div>;
}

function ConnectorTreeBranch({ node, depth }: { node: ConnectorTreeNode; depth: number }) {
  const [open, setOpen] = useState(false);
  if (node.children.length) return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary style={{ paddingLeft: `${10 + depth * 16}px` }}><span>{open ? "⌄" : "›"}</span><b>{node.name}</b><small>{countConnectorFiles(node)} 项</small></summary>{open && <>{node.object && <ConnectorTreeFile object={node.object} depth={depth + 1} />}{node.children.map((child) => <ConnectorTreeBranch node={child} depth={depth + 1} key={child.path} />)}</>}</details>;
  return node.object ? <ConnectorTreeFile object={node.object} depth={depth} /> : null;
}

function ConnectorTreeFile({ object, depth }: { object: ConnectorObjectView; depth: number }) {
  return <div className="connector-tree-file" style={{ paddingLeft: `${15 + depth * 16}px` }}><span>·</span><b>{object.stableKey.split("/").pop()}</b><small>{formatBytes(object.sizeBytes)}</small></div>;
}

function countConnectorFiles(node: ConnectorTreeNode): number {
  return Number(Boolean(node.object)) + node.children.reduce((total, child) => total + countConnectorFiles(child), 0);
}

type NormalizationTaskLine = {
  id: string;
  action: "准备执行" | "执行完成" | "复用完成" | "批次完成";
  file: string;
  rule: string;
};

type NormalizationCheckpoint = {
  processed: number;
  total: number;
  completedFiles: number;
  totalFiles: number;
};

function buildEventData(event: BuildEventView | undefined): JsonObject | undefined {
  return event?.data && typeof event.data === "object" ? event.data as JsonObject : undefined;
}

function Normalizers({ workspaceId, running, currentJob, latestJob, events, onRun, onStop, openOutput, fail }: { workspaceId: string; running: boolean; currentJob?: BuildJobView; latestJob?: BuildJobView; events: BuildEventView[]; onRun: (full: boolean, checkpoint?: NormalizationCheckpoint) => Promise<boolean>; onStop: () => Promise<boolean>; openOutput: () => void; fail: (value: string) => void }) {
  const { loaded } = useConfig(workspaceId, fail);
  const [requested, setRequested] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [runStartSequence, setRunStartSequence] = useState(0);
  const [lastProgressSequence, setLastProgressSequence] = useState(0);
  const [taskLines, setTaskLines] = useState<NormalizationTaskLine[]>([]);
  const [resumeCheckpoint, setResumeCheckpoint] = useState<NormalizationCheckpoint>();
  const result = stageResult(latestJob, "normalize");
  const built = Number(result?.built ?? 0);
  const skipped = Number(result?.skipped ?? 0);
  const stale = Number(result?.staleRevisions ?? 0);
  const diagnostics = ((latestJob?.summary?.diagnostics as unknown[] | undefined) ?? []).length;
  const sources = (loaded?.config.sources as JsonObject[] | undefined) ?? [];
  const jobStatus = String(currentJob?.status ?? "");
  const isCancelling = jobStatus === "cancelling";
  const recoverable = ["cancelled", "interrupted", "failed"].includes(jobStatus) && jobIncludesStage(currentJob, "normalize");
  const succeeded = ["succeeded", "succeeded_with_warnings", "partial"].includes(jobStatus);
  const showProgress = requested || running || recoverable;
  const completed = requested && hasStarted && !running && succeeded;
  const progressEvent = [...events].reverse().find((event) => {
    const data = buildEventData(event);
    return event.sequence > runStartSequence && event.stage === "normalize" && data && Number.isFinite(Number(data.processed)) && Number.isFinite(Number(data.total));
  });
  const progressData = buildEventData(progressEvent);
  const progressTotal = Number(progressData?.total ?? resumeCheckpoint?.total ?? 0);
  const progressProcessed = Number(progressData?.processed ?? resumeCheckpoint?.processed ?? 0);
  const progressCompletedFiles = Number(progressData?.completedFiles ?? resumeCheckpoint?.completedFiles ?? progressData?.processed ?? 0);
  const progressTotalFiles = Number(progressData?.totalFiles ?? resumeCheckpoint?.totalFiles ?? progressData?.total ?? 0);
  const progressPercent = completed ? 100 : Math.max(0, Math.min(100, Number(progressData?.percent ?? (progressTotal ? Math.floor(progressProcessed * 100 / progressTotal) : 0))));

  useEffect(() => {
    if (requested && running) setHasStarted(true);
  }, [requested, running]);

  useEffect(() => {
    if (!completed) return;
    setTaskLines((current) => [...current, {
      id: `batch-${Date.now()}`,
      action: "批次完成" as const,
      file: `${progressCompletedFiles || built + skipped} 个文件已处理`,
      rule: diagnostics ? `${diagnostics} 条诊断` : "全部完成",
    }].slice(-8));
  }, [built, completed, diagnostics, progressCompletedFiles, skipped]);

  useEffect(() => {
    if (!showProgress) return;
    const updates = events.filter((event) => event.sequence > lastProgressSequence && buildEventData(event)?.currentFile);
    if (!updates.length) return;
    setTaskLines((current) => [...current, ...updates.map((event): NormalizationTaskLine => {
      const data = buildEventData(event)!;
      const reused = String(data.outcome) === "reused";
      return {
        id: `progress-${event.sequence}`,
        action: reused ? "复用完成" : "执行完成",
        file: String(data.currentFile),
        rule: String(data.normalizerId ?? "自动路由"),
      };
    })].slice(-8));
    setLastProgressSequence(Math.max(...updates.map((event) => event.sequence)));
  }, [events, lastProgressSequence, showProgress]);

  const execute = async (full = false, resume = false) => {
    const sequence = events.reduce((maximum, event) => Math.max(maximum, event.sequence), 0);
    const checkpoint = resume && progressProcessed > 0 && progressTotal > 0
      ? { processed: progressProcessed, total: progressTotal, completedFiles: progressCompletedFiles, totalFiles: progressTotalFiles }
      : undefined;
    setHasStarted(false);
    setRunStartSequence(sequence);
    setLastProgressSequence(sequence);
    setResumeCheckpoint(checkpoint);
    setTaskLines([{ id: `prepare-${Date.now()}`, action: "准备执行", file: `${sources.length} 个数据源`, rule: checkpoint ? `从 ${Math.floor(checkpoint.processed * 100 / checkpoint.total)}% 检查点继续` : "等待真实进度" }]);
    setRequested(true);
    if (!await onRun(full, checkpoint)) setRequested(false);
  };

  const progressTitle = running ? isCancelling ? "正在安全停止" : "正在识别并转换文件" : recoverable ? jobStatus === "interrupted" ? "服务重启，任务已中断" : jobStatus === "failed" ? "执行失败" : "执行已停止" : "标准化完成";

  if (!loaded) return <Loading />;
  return <div className="normalization-console">
    <section className="normalization-hero">
      <div><span className="eyebrow">AUTO NORMALIZATION</span><h3>自动标准化</h3><p>系统按 MIME、扩展名、路径规则与下游兼容性批量匹配转换路线，无需逐文件选择转换器。</p></div>
      <div className="normalization-actions">
        {running ? <button className="stop-action" disabled={isCancelling} onClick={() => void onStop()}>{isCancelling ? "停止中…" : "停止"}</button> : recoverable ? <><button onClick={() => void execute(false, true)}>继续</button><button className="ghost" onClick={() => void execute(true)}>重新执行</button></> : <button disabled={sources.length === 0} onClick={() => void execute(false)}>{result ? "再次执行" : "执行标准化"}</button>}
        {result && <button className="ghost" onClick={openOutput}>查看产物</button>}
      </div>
    </section>
    <section className="normalization-metrics" aria-label="标准化概况">
      <div><span>输入范围</span><b>{sources.length} 个数据源</b><small>自动增量扫描</small></div>
      <div><span>路由方式</span><b>智能匹配</b><small>MIME · 扩展名 · 路径</small></div>
      <div><span>最近处理</span><b>{result ? built + skipped : "—"}</b><small>{result ? `转换 ${built} · 复用 ${skipped}` : "等待首次执行"}</small></div>
      <div><span>异常</span><b>{result ? diagnostics : "—"}</b><small>{stale ? `${stale} 个旧修订已失效` : "保持完整追溯"}</small></div>
    </section>
    <section className={`normalization-progress-panel ${showProgress ? "visible" : ""}`} aria-live="polite">
      <div className="normalization-progress-head"><b>{progressTitle}</b><span>{running ? `${progressCompletedFiles} / ${progressTotalFiles || "—"} 个文件${resumeCheckpoint ? " · 检查点续跑" : ""}` : recoverable ? "可从当前进度继续，或重新执行全部文件" : "产物已写入服务端存储"}</span></div>
      <div className="normalization-progress-row">
        <div className={`normalization-progress ${completed ? "complete" : ""}`} role="progressbar" aria-label="标准化真实进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
          <span className="normalization-progress-fill" style={{ width: `${progressPercent}%` }} />
          <strong className="normalization-progress-value" style={{ left: `clamp(18px, ${progressPercent}%, calc(100% - 18px))` }}>{progressPercent}%</strong>
        </div>
      </div>
      <div className="normalization-phases"><span>读取输入</span><span>识别格式</span><span>执行转换</span><span>写入产物</span></div>
      <div className="normalization-stream-head"><b>最近处理明细</b><span>高频任务仅展示最新记录</span></div>
      <div className="normalization-task-stream" aria-live="off">
        {taskLines.length ? taskLines.map((line) => <div className="normalization-task-line" key={line.id}>
          <span className={`task-action ${line.action === "执行完成" || line.action === "批次完成" ? "done" : ""}`}>{line.action}</span>
          <b title={line.file}>{line.file}</b>
          <code>{line.rule}</code>
        </div>) : <div className="normalization-task-empty">暂无可恢复的文件明细；可以继续增量校验，或重新执行全部文件。</div>}
      </div>
    </section>
    {!showProgress && <section className="normalization-last-run"><span className={`status ${String(latestJob?.status ?? "idle")}`}>{latestJob?.status ?? "未执行"}</span><p>{latestJob ? `${new Date(Number(latestJob.finishedAtMs ?? latestJob.createdAtMs)).toLocaleString()} · 结果可在“产物”中查看` : "执行后会生成适合 Agent Read、检索和下游解析的标准文件。"}</p></section>}
  </div>;
}

type RevisionRefView = { entity: { layer: string; id: string }; revision: string };
type ScopeContextView = {
  target: RevisionRefView;
  directAssignments: JsonObject[];
  effective: { values: JsonObject[]; conflicts: JsonObject[] };
  scopes: JsonObject[];
};

function ScopeCrosscutPanel({ workspaceId, stage, fail }: { workspaceId: string; stage: PipelineStageId; fail: (value: string) => void }) {
  const definition = scopeStages[stage]!;
  const [records, setRecords] = useState<JsonObject[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [context, setContext] = useState<ScopeContextView>();
  const [editing, setEditing] = useState(false);
  const [dimension, setDimension] = useState("system");
  const [label, setLabel] = useState("");
  const [scopeKey, setScopeKey] = useState("");
  const [propagation, setPropagation] = useState("inherit");

  const loadRecords = useCallback(async () => {
    try {
      const page = await api.request<Page>(`/workspaces/${workspaceId}/layers/${definition.collection}?limit=200`);
      setRecords(page.items);
      setSelectedKey((current) => page.items.some((item) => revisionKey(revisionRefOf(item)) === current) ? current : revisionKey(revisionRefOf(page.items[0])));
    } catch (error) { fail((error as Error).message); }
  }, [workspaceId, definition.collection, fail]);
  useEffect(() => { setContext(undefined); setSelectedKey(""); void loadRecords(); }, [loadRecords]);

  const selectedRecord = records.find((item) => revisionKey(revisionRefOf(item)) === selectedKey);
  const target = revisionRefOf(selectedRecord);
  const loadContext = useCallback(async () => {
    if (!target) { setContext(undefined); return; }
    try {
      const query = new URLSearchParams({ layer: target.entity.layer, entityId: target.entity.id, revision: target.revision });
      setContext(await api.request<ScopeContextView>(`/workspaces/${workspaceId}/scope/context?${query}`));
    } catch (error) { fail((error as Error).message); }
  }, [workspaceId, selectedKey, fail]);
  useEffect(() => { void loadContext(); }, [loadContext]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!target) return;
    try {
      await api.request(`/workspaces/${workspaceId}/scope/assignments`, {
        method: "POST",
        body: JSON.stringify({ target, dimension, scopeKey: scopeKey || label, label, propagation }),
      });
      setLabel(""); setScopeKey(""); setEditing(false); await loadContext();
    } catch (error) { fail((error as Error).message); }
  };

  const direct = context?.directAssignments ?? [];
  const manual = direct.filter((assignment) => String((((assignment.trace as JsonObject | undefined)?.producer as JsonObject | undefined)?.name) ?? "") === "context-admin-manual");
  const inferred = direct.filter((assignment) => !manual.includes(assignment));
  const inherited = (context?.effective.values ?? []).filter((value) => revisionKey(value.assignedAt as RevisionRefView | undefined) !== selectedKey);
  const conflicts = context?.effective.conflicts ?? [];
  const scopes = new Map((context?.scopes ?? []).map((scope) => [String((scope.scopeRef as JsonObject).id), scope]));
  const scopeTitle = (reference: unknown) => { const id = String((reference as JsonObject | undefined)?.id ?? reference ?? "—"); return String(scopes.get(id)?.label ?? id); };

  return <article className="scope-crosscut">
    <div className="scope-crosscut-head"><div><b>Scope</b><p>横切 {definition.label} · 当前归属、自动候选与继承结果</p></div><div className="scope-counts"><span>人工 {manual.length}</span><span>自动 {inferred.length}</span><span>继承 {inherited.length}</span></div></div>
    {records.length ? <>
      <div className="scope-target-row"><label>查看对象<select value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)}>{records.map((record) => { const reference = revisionRefOf(record); const key = revisionKey(reference); return <option key={key} value={key}>{recordName(record)} · {reference?.revision.slice(0, 8)}</option>; })}</select></label>{!definition.readOnly && <button className="ghost" onClick={() => setEditing((value) => !value)}>{editing ? "收起" : "人工设置"}</button>} {definition.readOnly && <span className="scope-readonly">读取 Fact EffectiveScope</span>}</div>
      {editing && target && <form className="scope-manual-form" onSubmit={save}><label>维度<input list="scope-dimensions" value={dimension} onChange={(event) => setDimension(event.target.value)} required /><datalist id="scope-dimensions"><option value="system" /><option value="service" /><option value="team" /><option value="capability" /><option value="version" /></datalist></label><label>范围名称<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：A 电商平台" required /></label><label>稳定键<input value={scopeKey} onChange={(event) => setScopeKey(event.target.value)} placeholder="留空则从名称生成" /></label><label>传播<select value={propagation} onChange={(event) => setPropagation(event.target.value)}><option value="inherit">向下继承</option><option value="local_only">仅当前对象</option></select></label><button>保存人工 Scope</button></form>}
      <div className="scope-board"><section><h4>当前层</h4><ScopeItems title="人工设置" items={manual} empty="尚未人工设置" render={(item) => ({ title: scopeTitle(item.scopeRef), meta: `${String(item.propagation)} · confirmed` })} /><ScopeItems title="自动推断" items={inferred} empty="暂无 ScopeProposer 候选" render={(item) => ({ title: scopeTitle(item.scopeRef), meta: `${String(item.reviewStatus)} · ${String(item.propagation)}` })} /></section><section><h4>继承的 EffectiveScope</h4><ScopeItems title="Lineage" items={inherited} empty={definition.layer === "source" ? "Source 是继承起点" : "上游暂无可继承的 confirmed Scope"} render={(item) => { const assignedAt = item.assignedAt as RevisionRefView; const path = ((item.scopePath as JsonObject[] | undefined) ?? []).map((reference) => scopeTitle(reference)).join(" → "); return { title: scopeTitle(item.scopeRef), meta: `继承自 ${assignedAt.entity.layer} · ${path || "direct"}` }; }} />{conflicts.length > 0 && <div className="scope-conflicts"><b>冲突</b>{conflicts.map((conflict, index) => <p key={index}>{String(conflict.dimension)}：{((conflict.values as JsonObject[] | undefined) ?? []).map(scopeTitle).join(" / ")}</p>)}</div>}</section></div>
    </> : <><div className="scope-empty">运行到 {definition.label} 后即可选择具体对象；ScopeAssignment 不复制进业务记录，而是通过标准引用横切该层。</div><div className="scope-board"><section><h4>当前层</h4><ScopeItems title="人工设置" items={[]} empty="构建出对象后可人工设置" render={() => ({ title: "", meta: "" })} /><ScopeItems title="自动推断" items={[]} empty="ScopeProposer 候选将在这里出现" render={() => ({ title: "", meta: "" })} /></section><section><h4>继承的 EffectiveScope</h4><ScopeItems title="Lineage" items={[]} empty="上游 confirmed + inherit 会沿完整 lineage 展示在这里" render={() => ({ title: "", meta: "" })} /></section></div></>}
  </article>;
}

function ScopeItems({ title, items, empty, render }: { title: string; items: JsonObject[]; empty: string; render: (item: JsonObject) => { title: string; meta: string } }) {
  return <div className="scope-group"><span>{title}</span>{items.length ? <div className="scope-values">{items.map((item, index) => { const value = render(item); return <div className="scope-value" key={String(item.id ?? index)}><b>{value.title}</b><small>{value.meta}</small></div>; })}</div> : <p>{empty}</p>}</div>;
}

function revisionRefOf(record?: JsonObject): RevisionRefView | undefined {
  return (record?.revisionRef ?? record?.currentSnapshot) as RevisionRefView | undefined;
}

function revisionKey(reference?: RevisionRefView) {
  return reference ? `${reference.entity.layer}:${reference.entity.id}@${reference.revision}` : "";
}

function Builds({ workspaceId, fail }: { workspaceId: string; fail: (value: string) => void }) {
  const [jobs, setJobs] = useState<BuildJobView[]>([]); const [selectedId, setSelectedId] = useState(""); const [events, setEvents] = useState<BuildEventView[]>([]);
  const reload = useCallback(async () => { try { const values = await api.request<BuildJobView[]>(`/workspaces/${workspaceId}/builds`); values.sort((a, b) => Number(b.createdAtMs) - Number(a.createdAtMs)); setJobs(values); setSelectedId((current) => current || values[0]?.id || ""); } catch (error) { fail((error as Error).message); } }, [workspaceId, fail]);
  useEffect(() => { void reload(); const timer = window.setInterval(() => void reload(), 2500); return () => clearInterval(timer); }, [reload]);
  useEffect(() => { setEvents([]); if (!selectedId) return; const stream = new EventSource(`/api/v1/workspaces/${workspaceId}/builds/${selectedId}/events`); const receive = (event: Event) => { const value = JSON.parse((event as MessageEvent).data) as BuildEventView; setEvents((current) => current.some((item) => item.sequence === value.sequence) ? current : [...current, value]); if (value.kind === "result") stream.close(); }; stream.addEventListener("build", receive); stream.onerror = () => stream.close(); return () => stream.close(); }, [workspaceId, selectedId]);
  const build = async () => { try { const job = await api.request<BuildJobView>(`/workspaces/${workspaceId}/builds`, { method: "POST", body: JSON.stringify({ full: false, fromStage: "capture", toStage: "project" }) }); setJobs((values) => [job, ...values]); setSelectedId(job.id); } catch (error) { fail((error as Error).message); } };
  const cancel = async () => { if (!selectedId) return; try { await api.request(`/workspaces/${workspaceId}/builds/${selectedId}/cancel`, { method: "POST" }); await reload(); } catch (error) { fail((error as Error).message); } };
  const selected = jobs.find((job) => job.id === selectedId);
  const active = selected && ["queued", "running", "cancelling"].includes(String(selected.status));
  return <div className="history-layout"><article className="card history-list"><CardTitle title="流水线运行历史" subtitle={`${jobs.length} 次运行 · 事件与结果永久保留`} /><div className="history-toolbar"><button onClick={build}>运行流水线</button></div><div className="run-list">{jobs.map((job) => { const request = job.request as JsonObject | undefined; const from = String(request?.fromStage ?? "capture"); const to = String(request?.toStage ?? "project"); return <button className={`run-row ${selectedId === job.id ? "active" : ""}`} key={job.id} onClick={() => setSelectedId(job.id)}><span className={`status ${job.status}`}>{job.status}</span><div><b>{from === to ? `${from} 单步` : `${from} → ${to}`}</b><small>{new Date(Number(job.createdAtMs)).toLocaleString()} · {job.request?.full ? "FULL" : "INCREMENTAL"}</small></div><code>{job.id.slice(-8)}</code></button>; })}</div></article><article className="card run-detail"><div className="run-detail-head"><CardTitle title="运行日志" subtitle={selected ? selected.id : "选择一条历史记录"} />{active && <button className="danger" onClick={cancel}>取消运行</button>}</div>{selected && <div className="run-facts"><span>状态 <b>{selected.status}</b></span><span>范围 <b>{String((selected.request as JsonObject | undefined)?.fromStage ?? "capture")} → {String((selected.request as JsonObject | undefined)?.toStage ?? "project")}</b></span><span>模式 <b>{selected.request?.full ? "完整" : "增量"}</b></span></div>}<div className="history-console">{events.length ? events.map((event) => <div className="console-line" key={event.sequence}><time>{new Date(Number(event.timestampMs)).toLocaleTimeString()}</time><span>{event.stage}</span><p>{event.message}</p></div>) : <div className="console-empty">选择一次运行后显示持久化节点日志。</div>}</div>{selected?.summary && <details className="summary-json"><summary>运行结果 JSON</summary><pre>{JSON.stringify(selected.summary, null, 2)}</pre></details>}</article></div>;
}

const collections = ["sources", "snapshots", "normalized-sources", "structures", "evidence", "facts", "scope-dimensions", "scopes", "scope-assignments", "scope-blocks", "scope-relations", "scope-decisions", "semantic-edges"];
function Layers({ workspaceId, fail, initialCollection = "sources" }: { workspaceId: string; fail: (value: string) => void; initialCollection?: string }) {
  const [collection, setCollection] = useState(initialCollection); const [text, setText] = useState(""); const [page, setPage] = useState<Page>(); const [selected, setSelected] = useState<JsonObject>();
  useEffect(() => { setCollection(initialCollection); setSelected(undefined); }, [initialCollection]);
  const load = useCallback((cursor = "") => api.request<Page>(`/workspaces/${workspaceId}/layers/${collection}?limit=50&text=${encodeURIComponent(text)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`).then(setPage).catch((e: Error) => fail(e.message)), [workspaceId, collection, text, fail]);
  useEffect(() => { void load(); }, [load]);
  return <div className="layer-layout"><article className="card layer-list"><CardTitle title="Canonical Records" subtitle="默认只显示 current revisions" /><div className="toolbar"><select value={collection} onChange={(e) => setCollection(e.target.value)}>{collections.map((value) => <option key={value}>{value}</option>)}</select><input value={text} onChange={(e) => setText(e.target.value)} placeholder="检索文本" /><button onClick={() => load()}>查询</button></div><div className="table"><div className="tr head"><span>记录</span><span>状态</span></div>{page?.items.map((item, index) => <button className="tr" key={index} onClick={() => setSelected(item)}><span>{recordName(item)}</span><span>{String(item.freshness ?? item.reviewStatus ?? item.accessStatus ?? "—")}</span></button>)}</div>{page?.nextCursor && <button className="ghost more" onClick={() => load(page.nextCursor)}>下一页</button>}</article><article className="card detail"><CardTitle title="记录详情" subtitle="公开 DTO / Locator / Trace" />{selected ? <pre>{JSON.stringify(selected, null, 2)}</pre> : <Empty title="选择一条记录" detail="详情只来自各层 Reader API。" />}</article></div>;
}

function Reviews({ workspaceId, fail }: { workspaceId: string; fail: (value: string) => void }) {
  const reviewLayers: Array<[string, string]> = [["scope-assignments", "scope_assignment"], ["scope-blocks", "scope_block"], ["scope-relations", "scope_relation"], ["semantic-edges", "semantic_edge"]];
  const [items, setItems] = useState<Array<JsonObject & { subject: string }>>([]); const [selected, setSelected] = useState<Set<string>>(new Set()); const [rationale, setRationale] = useState("");
  const reload = useCallback(async () => { try { const pages = await Promise.all(reviewLayers.map(([layer, subject]) => api.request<Page>(`/workspaces/${workspaceId}/layers/${layer}?limit=200&reviewStatus=candidate`).then((page) => page.items.map((item) => ({ ...item, subject }))))); setItems(pages.flat()); } catch (e) { fail((e as Error).message); } }, [workspaceId, fail]);
  useEffect(() => { void reload(); }, [reload]);
  const decide = async (status: "confirmed" | "rejected") => { try { const decisions = items.filter((item) => selected.has(String(item.id))).map((item) => ({ subject: item.subject, id: item.id, expectedStatus: "candidate", status, rationale })); await api.request(`/workspaces/${workspaceId}/reviews/decide`, { method: "POST", body: JSON.stringify({ decisions }) }); setSelected(new Set()); setRationale(""); await reload(); } catch (e) { fail((e as Error).message); } };
  return <article className="card"><CardTitle title="候选审核队列" subtitle="只允许 candidate → confirmed / rejected" /><div className="review-actions"><input value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="审核理由（必填）" /><button disabled={!selected.size || !rationale} onClick={() => decide("confirmed")}>确认 {selected.size || ""}</button><button className="danger" disabled={!selected.size || !rationale} onClick={() => decide("rejected")}>拒绝</button></div><div className="table"><div className="tr head"><span>候选</span><span>类型</span></div>{items.map((item) => <label className="tr" key={`${item.subject}:${String(item.id)}`}><span><input type="checkbox" checked={selected.has(String(item.id))} onChange={() => setSelected((old) => { const next = new Set(old); next.has(String(item.id)) ? next.delete(String(item.id)) : next.add(String(item.id)); return next; })} /> {recordName(item)}</span><span>{item.subject}</span></label>)}</div></article>;
}

function ContextLab({ workspaceId, fail }: { workspaceId: string; fail: (value: string) => void }) {
  const [mode, setMode] = useState("explore"); const [terms, setTerms] = useState(""); const [result, setResult] = useState<JsonObject>();
  const payload = useMemo(() => mode === "manifest" ? { type: "manifest" } : { type: "explore", terms: terms.split(/[,\n]/).map((v) => v.trim()).filter(Boolean), filters: { factKinds: [], scopeRefs: [], limit: 50 } }, [mode, terms]);
  const run = async () => { try { setResult(await api.request(`/workspaces/${workspaceId}/context`, { method: "POST", body: JSON.stringify(payload) })); } catch (e) { fail((e as Error).message); } };
  return <div className="playground"><article className="card"><CardTitle title="context() Request" subtitle="与 MCP 使用同一个判别联合" /><label>模式<select value={mode} onChange={(e) => setMode(e.target.value)}><option value="explore">Explore</option><option value="manifest">Manifest</option></select></label><label>检索词<textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={8} placeholder="refund, policy" disabled={mode === "manifest"} /></label><button onClick={run}>运行查询</button><pre>{JSON.stringify(payload, null, 2)}</pre></article><article className="card result"><CardTitle title="Context View" subtitle={result ? String(result.freshness) : "等待查询"} />{result ? <><div className="markdown">{String(result.markdown)}</div><details><summary>原始 JSON</summary><pre>{JSON.stringify(result, null, 2)}</pre></details></> : <Empty title="暂无结果" detail="运行 Manifest 或 Explore 请求。" />}</article></div>;
}

function CardTitle({ title, subtitle }: { title: string; subtitle: string }) { return <div className="card-title"><div><h3>{title}</h3><p>{subtitle}</p></div><span>•••</span></div>; }
function Empty({ title, detail }: { title: string; detail: string }) { return <div className="empty"><span>◇</span><b>{title}</b><p>{detail}</p></div>; }
function Loading() { return <div className="boot"><span className="pulse" />加载中…</div>; }
function recordName(item: JsonObject) { const ref = (item.revisionRef ?? item.entityRef ?? item.scopeRef) as JsonObject | undefined; return String(item.title ?? item.label ?? item.statement ?? item.excerpt ?? item.id ?? ref?.id ?? "record"); }
