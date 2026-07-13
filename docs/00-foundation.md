# 架构基础

## 不绑定实现

本文档只定义系统形态，不定义工程包结构。

实现可以采用：

```txt
Rust
TypeScript
Rust + TypeScript
其他组合
```

目录、crate、package、进程边界都应该在架构稳定后再设计。

## 目标形态

Context Compiler 编译的是“项目上下文”，不是“答案”。

它接收：

```txt
代码仓库
Markdown
PDF
PPT
DOC
Excel
图片
接口文档
测试资料
会议纪要
运行日志
数据库元数据
配置中心
链路和监控数据
```

输出：

```txt
可追溯的事实
可计算的范围
可跳转的语义关系
可读取的 cleaned source 工作区
动态查询视图
```

## 三种产物

### Canonical Data

权威数据。

包含：

```txt
Source
Structure
Evidence
Fact
Scope Graph
Semantic Graph
Index
State
Correction
Governance
```

这些数据可以存数据库、文件、图存储或混合存储。文档不提前规定。

### .context Workspace

面向 Agent 原生工具的 cleaned source 工作区。

Agent 应该能用：

```txt
Read
Grep
Glob
Bash
```

直接读取 `.context/sources` 中的规范化原文和原始资料投影。

`.context` 默认不保存事实、证据、Scope、语义关系、索引、数据库或 runtime 缓存。

### context()

动态关联查询入口。

用于查询外部 store 中的关联上下文：

```txt
事实、证据、Scope、语义关系
临时组合多个范围
权限受控展开
运行时数据查询
复杂歧义诊断
逐步打开某个视图中的锚点
```

## 核心原则

### 先保真，再推理

先保存来源、结构、证据和局部事实，再做 Scope 和语义推断。

没有证据的结论不能直接进入事实层或语义层。

### 低层多态，高层统一

Markdown、PDF、代码、Excel 的解析方式可以完全不同。

但对外必须提供统一能力：

```txt
可引用
可追溯
可失效
可展开
```

### Scope 横切

Scope 不是只给 Fact 打标签。

Scope 可以挂在：

```txt
Source
Structure
Evidence
Fact
```

查询时根据引用链计算有效 Scope。

### Semantic 独立

语义层不是 Scope 层的子集。

语义层连接 FactRef 和 FactRef，表达事实之间的业务或工程含义。

### 原文静态，关联动态

默认不要把规范化原文封进 MCP 黑盒。

Agent 自带读文件、搜索、执行命令的能力，Context Compiler 应该让 cleaned sources 直接可读。

但事实、证据、Scope、语义关系和索引不默认导出成大量 Markdown。

这些关联内容通过 `context()` 从外部 store 渐进查询。
