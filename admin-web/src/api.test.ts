import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "./api";

describe("ApiClient", () => {
  it("adds the server-issued CSRF token to writes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ csrfToken: "test-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient();
    await client.initialize();
    await client.request("/workspaces", { method: "POST", body: "{}" });
    const init = fetchMock.mock.calls[1][1] as RequestInit;
    expect(new Headers(init.headers).get("x-context-csrf")).toBe("test-token");
  });
});
