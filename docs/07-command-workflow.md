# 编译命令和工作流

## 命名

产品和系统名仍然叫：

```txt
Context Compiler
```

用户日常使用的 CLI 建议叫：

```txt
context
```

原因：

```txt
context build
context status
context doctor
```

比：

```txt
context-compiler build
context-compiler doctor
```

更像用户在“管理当前工作空间的上下文”，而不是操作一个编译器内部实现。

但 `context` 这个名字比较通用，可能有命令冲突。因此建议：

```txt
主命令:
  context

长别名:
  context-compiler

包名或项目名:
  context-compiler
```

也就是说，用户文档默认写 `context`，实现分发时可以让 `context-compiler` 作为等价入口或 fallback。

## 命令设计原则

命令应该围绕工作流，而不是围绕内部层。

不要第一版暴露：

```txt
context build-source
context build-structure
context build-evidence
context build-fact
context build-scope
context build-semantic
```

这些是内部阶段，不应该让用户手动编排。

用户应该看到：

```txt
build
status
doctor
```

自动更新不应该是用户主命令，而应该是工作区配置：

```txt
autoUpdate.enabled = true
```

## 最小命令集

第一版建议只做这些：

```txt
context build
context status
context doctor
```

不把 `init` 放进第一版主流程。

原因：

```txt
context build 第一次运行时可以自动创建 .context 和 Agent 入口。
用户不需要先做一个空初始化。
少一个命令，少一个心智步骤。
```

### context build

执行一次完整编译，也是默认 bootstrap 命令。

如果当前目录还没有 Context Compiler 工作区，`context build` 应自动创建：

```txt
.context/sources
AGENTS.md
.claude/
.codex/
```

如果用户不想生成 Agent 入口，可以显式关闭：

```txt
context build --no-agent
```

输入：

```txt
当前目录
可选配置
本地文件、代码仓库或 repo pointer
```

输出：

```txt
canonical data
.context/sources
external store
AGENTS.md / .claude / .codex
```

内部流程：

```txt
SourceRecord / SourceSnapshot
  -> NormalizedSource
  -> Structure
  -> Evidence
  -> Fact
  -> ScopeAssignment / ScopeRelation / EffectiveScope
  -> SemanticEdge
  -> external store indexes
  -> .context/sources projection
```

可选参数：

```txt
context build
context build --full
context build --changed
context build --source <source-ref-or-path>
context build --dry-run
context build --no-agent
context build --no-auto-update
context build --portable
```

第一版可以只实现：

```txt
context build
context build --full
context build --no-agent
context build --no-auto-update
```

`--portable` 是显式可选模式，用于离线迁移、归档或 CI 复现；默认不把 store 写入 `.context`。

## 自动更新

自动更新是配置，不是 `context watch` 命令。

推荐用户可编辑配置放在工作区根目录：

```txt
context.config.json
```

manifest / health 可以作为 CLI 输出或外部 store 记录，不默认写入 `.context`。

最小配置：

```json
{
  "autoUpdate": {
    "enabled": true,
    "mode": "on_demand",
    "debounceMs": 1000
  }
}
```

默认值：

```txt
enabled: true
mode: on_demand
```

含义：

```txt
on_demand:
  不启动隐藏后台进程。
  context build 默认检测变化并增量刷新。
  context status / context doctor 可以报告 stale 和下一次 build 会更新什么。

background:
  只有当 context() runtime / MCP / Agent helper 已经在运行时，才监听文件变化并自动更新。
  不建议第一版做全局常驻 daemon。
```

所以“默认开启”的含义是：

```txt
只要 Context Compiler 有机会运行，就默认检查并更新 stale 内容。
有长运行进程时，再使用 watcher 做自动增量更新。
不悄悄启动一个长期后台服务。
```

临时关闭：

```txt
context build --no-auto-update
```

永久关闭：

```json
{
  "autoUpdate": {
    "enabled": false
  }
}
```

### context status

给人和 Agent 看当前工作空间状态。

应显示：

```txt
是否存在 .context
外部 store 位置
上次 build 时间
source 数量
normalized source 数量
fact 数量
scope assignment 数量
semantic edge 数量
autoUpdate 是否开启
是否有 stale / error
```

`status` 是日常命令，输出简洁。

### context doctor

诊断命令。

比 `status` 更深入。

检查：

```txt
.context/sources 目录是否完整
AGENTS.md / .claude / .codex 是否与 .context 同级
source.json 是否缺字段
NormalizedSource 是否能映射回 SourceSnapshot
EvidenceRef 是否能追到原文
Fact 是否都有 Evidence
ScopeAssignment 是否有 basis
SemanticEdge 是否只有 FactRef -> FactRef
外部 store 是否能通过当前工作区路径定位
context() 是否能返回证据路径
```

`doctor` 可以给出修复建议，但不要自动改动，除非用户显式加 `--fix`。

## 后续命令

下面这些命令有价值，但不进入最小第一版。

### context clean

清理生成物。

建议分级：

```txt
context clean --store-cache
  清理外部 store 中可重建的 runtime / indexes。

context clean --portable-store
  清理 .context/.store，仅 portable 模式存在。

context clean --all
  清理 .context/sources 和外部 store 中可重建内容，但保留用户确认记录。
```

`clean` 不是第一版必需命令。

用户第一版可以直接删除 `.context` 后重新运行：

```txt
context build
```

## 工作流

### 纯问答工作空间

用户有一批资料，只想问答。

```txt
context build
context status
```

生成：

```txt
workspace-root/
  .context/
    sources/
  AGENTS.md
  .claude/
  .codex/
```

如果用户不需要 Coding Agent 自动发现入口，可以：

```txt
context build --no-agent
```

只生成：

```txt
workspace-root/
  .context/
    sources/
```

### 代码项目工作空间

用户要让 Agent 在代码项目里写代码。

在代码项目根目录执行：

```txt
context build
```

生成：

```txt
repo-root/
  src/
  package.json
  .context/
    sources/
  AGENTS.md
  .claude/
  .codex/
```

之后 Claude Code / Codex 直接打开 `repo-root`，它会看到根目录的 Agent 入口，并被引导用 `context()` 查关联、读 `.context/sources` 取证。

这是 coding 场景最推荐的形态。

### 多仓库聚合工作空间

用户资料覆盖多个 repo 或业务线。

推荐：

```txt
context-workspace/
  .context/
    sources/
  AGENTS.md
  .claude/
  .codex/
  repos/
    repo-a/
    repo-b/
```

或者 `.context/sources/gitlab/...` 中只保存 repo pointer。

问答时在聚合工作空间工作。

真正要改某个 repo 时，再进入 repo 根目录生成局部工作空间：

```txt
cd repos/repo-a
context build
```

## 命令和 context() 的关系

CLI 命令 `context` 和动态查询工具 `context()` 是两件事：

```txt
context build
  本地 CLI 编译命令。

context()
  Agent 动态关联查询工具。
```

名字相同不冲突，因为场景不同。

但文档里要写清楚：

```txt
CLI:
  context build

MCP/tool:
  context({ terms, target, filters })
```

## 不做什么

第一版不要做：

```txt
init 脚手架命令
clean 清理子命令
复杂插件安装系统
复杂多 profile 配置
远程云同步
Studio UI
多用户权限系统
全量后台监听优化
按内部层手动执行 build
```

第一版只需要跑通：

```txt
build
status
doctor
```

## 一句话

```txt
产品叫 Context Compiler。
命令叫 context。
context-compiler 作为长别名和项目名保留。
第一版不需要 init；context build 首次运行自动 bootstrap 工作空间。
自动更新默认开启，但作为配置存在，不作为 context watch 命令。
```
