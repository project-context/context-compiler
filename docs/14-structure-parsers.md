# Structure Parser v1

Structure 阶段的稳定边界是：

```text
Normalized Artifact
  -> StructureParserRegistry
  -> StructureParser
  -> private Structure Artifact
  -> StructureUnit / StructureRelation
  -> StructureStore::commit_structure
  -> Resolver
```

`context-structure` 只定义对象安全协议、可扩展 kind newtype、Reader / Store 和文件族分类，不依赖 Tokio、SQLite 或物理 Artifact 路径。Parser Factory 负责 descriptor、配置 Schema、验证与实例创建；重复稳定 ID 会被 Registry 拒绝。

首批实现位于独立 crates：

- `context-structure-parser-markdown`：document、heading、paragraph、table、list item、code block，以及 contains / precedes。
- `context-structure-parser-tree-sitter-typescript`：file、function、method、condition、call，以及 contains / declares / calls。
- `context-structure-parser-test-support`：取消、进度收集和统一 fixture。

路由保存在 `context.config.json` 的 `structure.routes[]`，只保存标准化后缀、Parser ID 与已验证配置。管理端的文件族只用于压缩展示行数；语言不会因为同时用于前端和后端而重复出现。

Compiler 先用 keyset 分页统计文件数与输入字节，再逐页解析。指纹包含主 Artifact hash、Parser ID、实现版本和配置 hash。未变化的 build 直接复用；重新执行忽略复用。单文件失败产生诊断并继续其他文件，取消只在安全边界生效，只有私有 Artifact 和 canonical records 原子提交后该文件的进度才完成。

SQLite v2 迁移归档旧 Structure 及其下游派生记录，并把指向旧派生 revision 的 Scope 审核状态改为 orphaned。Doctor 在完整重建前报告 `structure_protocol_v2_rebuild_required`。
