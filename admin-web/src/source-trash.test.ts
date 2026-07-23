import { describe, expect, it } from "vitest";
import { moveSourceToTrash, restoreSourceFromTrash } from "./source-trash";

const source = { id: "docs", connectorId: "local", displayName: "Docs", config: { root: "docs" } };

describe("source recycle bin", () => {
  it("moves the complete source definition into persistent trash", () => {
    const config = moveSourceToTrash({ schemaVersion: 1, sources: [source], sourceTrash: [] }, "docs", 123, "trash-1");
    expect(config.sources).toEqual([]);
    expect(config.sourceTrash).toEqual([{ trashId: "trash-1", deletedAtMs: 123, source }]);
  });

  it("restores a source without losing its connector configuration", () => {
    const trashed = moveSourceToTrash({ schemaVersion: 1, sources: [source] }, "docs", 123, "trash-1");
    const restored = restoreSourceFromTrash(trashed, "trash-1");
    expect(restored.sources).toEqual([source]);
    expect(restored.sourceTrash).toEqual([]);
  });

  it("rejects restore when an active source already uses the same id", () => {
    const config = { sources: [source], sourceTrash: [{ trashId: "trash-1", deletedAtMs: 123, source }] };
    expect(() => restoreSourceFromTrash(config, "trash-1")).toThrow("当前已存在同名数据源");
  });
});
