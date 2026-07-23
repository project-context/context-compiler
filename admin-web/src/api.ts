import type { components } from "./generated";

export type JsonObject = Record<string, unknown>;

type SessionResponse = components["schemas"]["SessionResponse"];
type ConfigEnvelope = components["schemas"]["ConfigEnvelope"];

export interface Workspace {
  workspaceId: string;
  displayName: string;
  root: string;
}

export interface Page<T = JsonObject> {
  items: T[];
  nextCursor?: string;
}

export interface LoadedConfig {
  config: JsonObject;
  etag: string;
  persisted: boolean;
  importedLegacy: boolean;
}

export class ApiClient {
  private csrf = "";

  async initialize(): Promise<void> {
    const session = await this.request<SessionResponse>("/session");
    this.csrf = session.csrfToken;
  }

  request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body) headers.set("content-type", "application/json");
    if (init.method && init.method !== "GET") headers.set("x-context-csrf", this.csrf);
    return fetch(`/api/v1${path}`, { ...init, headers }).then(async (response) => {
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as JsonObject;
        throw new Error(String(body.message ?? `${response.status} ${response.statusText}`));
      }
      if (response.status === 204) return undefined as T;
      return response.json() as Promise<T>;
    });
  }

  async config(workspaceId: string): Promise<LoadedConfig> {
    const response = await fetch(`/api/v1/workspaces/${workspaceId}/config`);
    if (!response.ok) throw new Error(await response.text());
    const value = (await response.json()) as ConfigEnvelope;
    return {
      config: value.config as JsonObject,
      persisted: value.persisted,
      importedLegacy: value.importedLegacy,
      etag: response.headers.get("etag") ?? value.etag,
    };
  }

  saveConfig(workspaceId: string, config: JsonObject, etag: string): Promise<{ etag: string }> {
    return this.request(`/workspaces/${workspaceId}/config`, {
      method: "PUT",
      headers: { "if-match": etag },
      body: JSON.stringify({ config }),
    });
  }
}

export const api = new ApiClient();
