import { describe, expect, it } from "vitest";
import { readApiJson } from "./api-response";

describe("readApiJson", () => {
  it("returns a successful JSON object", async () => {
    const response = new Response(JSON.stringify({ order: { id: "order_1" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    await expect(readApiJson(response, "Could not create checkout")).resolves.toEqual({
      order: { id: "order_1" },
    });
  });

  it("uses a JSON API error without exposing response internals", async () => {
    const response = new Response(JSON.stringify({ error: "Razorpay rejected the request" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

    await expect(readApiJson(response, "Could not create checkout")).rejects.toThrow(
      "Razorpay rejected the request",
    );
  });

  it("turns an HTML upstream response into a useful checkout error", async () => {
    const response = new Response("<!DOCTYPE html><title>Bad gateway</title>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });

    const error = await readApiJson(response, "Could not create checkout").catch((caught) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("HTTP 502");
    expect((error as Error).message).not.toContain("DOCTYPE");
    expect((error as Error).message).not.toContain("Unexpected token");
  });

  it("gives recovery instructions for an expired session", async () => {
    const response = new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });

    await expect(readApiJson(response, "Could not create checkout")).rejects.toThrow(
      "Close and reopen the Telegram Mini App",
    );
  });
});
