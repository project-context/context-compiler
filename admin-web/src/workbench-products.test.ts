import { describe, expect, it } from "vitest";
import {
  buildFileTree,
  buildGraphModel,
  buildStructureGraph,
  FileDescriptor,
  isFileContentStructureUnit,
  primaryArtifactUri,
  splitContentByByteRange,
} from "./workbench-products";
import { JsonObject } from "./api";

const ref = (layer: string, id: string, revision: string) => ({ entity: { layer, id }, revision });

describe("layer product models", () => {
  it("resolves the canonical primary Artifact used by the content preview", () => {
    expect(primaryArtifactUri({ primary: { artifact: { uri: "artifact:sha256:abc" } } })).toBe("artifact:sha256:abc");
    expect(primaryArtifactUri({})).toBe("");
  });

  it("builds a deterministic file-system tree", () => {
    const files: FileDescriptor[] = [
      { id: "readme", sourceId: "local", path: "README.md", title: "README" },
      { id: "api", sourceId: "local", path: "docs/api.md", title: "API" },
      { id: "guide", sourceId: "local", path: "docs/guide/start.md", title: "Start" },
    ];

    const tree = buildFileTree(files);

    expect(tree.map((node) => node.name)).toEqual(["docs", "README.md"]);
    expect(tree[0].children.map((node) => node.name)).toEqual(["guide", "api.md"]);
    expect(tree[0].children[0].children[0].file?.id).toBe("guide");
  });

  it("links evidence nodes from every referenced structure revision", () => {
    const structureA = { revisionRef: ref("structure", "heading", "1"), kind: "heading", stableKey: "Refund" };
    const structureB = { revisionRef: ref("structure", "paragraph", "1"), kind: "paragraph", stableKey: "Rules" };
    const evidence = {
      revisionRef: ref("evidence", "refund-rule", "1"),
      kind: "quote",
      excerpt: "七天内可退款",
      structureRefs: [structureA.revisionRef, structureB.revisionRef],
    };

    const graph = buildGraphModel("evidence", sampleFile(), [evidence], { structures: [structureA, structureB] }, {});

    expect(graph.edges).toEqual([
      { from: "structure:heading@1", to: "evidence:refund-rule@1", label: "evidence_from" },
      { from: "structure:paragraph@1", to: "evidence:refund-rule@1", label: "evidence_from" },
    ]);
    expect(graph.nodes).toHaveLength(3);
  });

  it("links fact nodes from every evidence reference and preserves roles", () => {
    const upstream = { revisionRef: ref("evidence", "refund-rule", "1"), excerpt: "七天内可退款" };
    const fact = {
      revisionRef: ref("fact", "refund-window", "2"),
      statement: "退款期限为七天",
      evidence: [{ evidenceRef: upstream.revisionRef, role: "supports" }],
    };

    const graph = buildGraphModel("fact", sampleFile(), [fact], { evidence: [upstream] }, {});

    expect(graph.edges).toEqual([
      { from: "evidence:refund-rule@1", to: "fact:refund-window@2", label: "supports" },
    ]);
    expect(graph.nodes.map((node) => node.label)).toEqual(["退款期限为七天", "七天内可退款"]);
  });

  it("keeps only real content ranges from the selected normalized artifact", () => {
    const artifact = { uri: "artifact:sha256:selected" };
    const heading = {
      revisionRef: ref("structure", "heading", "1"),
      kind: "heading",
      label: "退款规则",
      locator: { type: "byte_range", artifact, start: 0, end: 12 },
    };
    const syntheticDocument = {
      revisionRef: ref("structure", "document", "1"),
      kind: "document",
      label: "README.md",
      locator: { type: "byte_range", artifact, start: 0, end: 50 },
    };
    const foreign = {
      revisionRef: ref("structure", "foreign", "1"),
      kind: "paragraph",
      label: "其他文件内容",
      locator: { type: "byte_range", artifact: { uri: "artifact:sha256:other" }, start: 0, end: 12 },
    };

    expect(isFileContentStructureUnit(heading, artifact.uri)).toBe(true);
    expect(isFileContentStructureUnit(syntheticDocument, artifact.uri)).toBe(false);
    expect(isFileContentStructureUnit(foreign, artifact.uri)).toBe(false);

    const graph = buildStructureGraph([heading], [], {});
    expect(graph.nodes.map((node) => node.label)).toEqual(["退款规则"]);
    expect(graph.edges).toEqual([]);
  });

  it("maps UTF-8 byte locators to the exact original-content highlight", () => {
    const content = "标题\n退款规则";
    const selected = new TextEncoder().encode("标题\n").length;
    expect(splitContentByByteRange(content, selected, new TextEncoder().encode(content).length)).toEqual({
      before: "标题\n",
      selected: "退款规则",
      after: "",
    });
  });
});

function sampleFile(): FileDescriptor {
  const normalized: JsonObject = { revisionRef: ref("source", "normalized:refund", "1") };
  return { id: "source:normalized:refund@1", sourceId: "local", path: "docs/refund.md", title: "Refund", normalized };
}
