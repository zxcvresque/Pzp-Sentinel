import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createOpenRouterApiKey, getOpenRouterWorkspaces, openRouterKeyHash } from "./openrouter";

afterEach(() => vi.unstubAllGlobals());

describe("openRouterKeyHash", () => {
  it("produces the API-compatible SHA-256 key hash without retaining the key", () => {
    const key = "sk-or-v1-test-value";
    expect(openRouterKeyHash(key)).toBe(createHash("sha256").update(key).digest("hex"));
    expect(openRouterKeyHash(key)).not.toContain(key);
  });
});

describe("createOpenRouterApiKey", () => {
  it("sends the enforceable limit controls to the management API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { hash: "hash-1", limit: 25, limit_reset: "weekly" }, key: "sk-or-created" }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await createOpenRouterApiKey("management-key", {
      name: "Dev key",
      limit: 25,
      limit_reset: "weekly",
      include_byok_in_limit: true,
      workspace_id: "workspace-1",
      expires_at: "2027-01-01T00:00:00.000Z",
      creator_user_id: "user-1",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://openrouter.ai/api/v1/keys", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "Dev key", limit: 25, limit_reset: "weekly", include_byok_in_limit: true, workspace_id: "workspace-1", expires_at: "2027-01-01T00:00:00.000Z", creator_user_id: "user-1" }),
    }));
  });
});

describe("getOpenRouterWorkspaces", () => {
  it("discovers selectable workspaces with the management key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "workspace-1", name: "Production", slug: "production" }], total_count: 1 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getOpenRouterWorkspaces("management-key")).resolves.toEqual([
      { id: "workspace-1", name: "Production", slug: "production" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith("https://openrouter.ai/api/v1/workspaces?limit=100", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer management-key" }),
      cache: "no-store",
    }));
  });
});
