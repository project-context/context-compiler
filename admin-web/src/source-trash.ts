import type { JsonObject } from "./api";

export type SourceTrashEntry = JsonObject & {
  trashId: string;
  deletedAtMs: number;
  source: JsonObject;
};

export function moveSourceToTrash(config: JsonObject, sourceId: string, deletedAtMs: number, trashId: string): JsonObject {
  const sources = (config.sources as JsonObject[] | undefined) ?? [];
  const source = sources.find((value) => String(value.id) === sourceId);
  if (!source) throw new Error(`数据源不存在：${sourceId}`);
  const sourceTrash = (config.sourceTrash as SourceTrashEntry[] | undefined) ?? [];
  const entry: SourceTrashEntry = { trashId, deletedAtMs, source };
  return {
    ...config,
    sources: sources.filter((value) => String(value.id) !== sourceId),
    sourceTrash: [entry, ...sourceTrash],
  };
}

export function restoreSourceFromTrash(config: JsonObject, trashId: string): JsonObject {
  const sources = (config.sources as JsonObject[] | undefined) ?? [];
  const sourceTrash = (config.sourceTrash as SourceTrashEntry[] | undefined) ?? [];
  const entry = sourceTrash.find((value) => String(value.trashId) === trashId);
  if (!entry) throw new Error(`回收站记录不存在：${trashId}`);
  const sourceId = String(entry.source.id);
  if (sources.some((source) => String(source.id) === sourceId)) {
    throw new Error(`无法还原 ${sourceId}：当前已存在同名数据源。`);
  }
  return {
    ...config,
    sources: [...sources, entry.source],
    sourceTrash: sourceTrash.filter((value) => String(value.trashId) !== trashId),
  };
}
