import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readActiveTask } from "../src/active-task.mjs";
import { readCapsule } from "../src/local-store.mjs";
import { createRelayRouterProxy, defaultEventsLoader } from "../src/router-proxy.mjs";

describe("Relay router proxy", () => {
  it("proxies chat completions, captures memory, and applies handoffs", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-proxy-test-"));
    let upstreamCalls = 0;

    const proxy = createRelayRouterProxy({
      projectRoot,
      env: { OG_INFERENCE_API_KEY: "sk-test" },
      host: "127.0.0.1",
      port: 0,
      fetchImpl: async (url, options) => {
        upstreamCalls += 1;
        assert.match(String(url), /\/chat\/completions$/);
        const body = JSON.parse(options.body);
        if (upstreamCalls > 1) {
          assert.equal(body.messages.length, 2);
          assert.equal(body.messages[0].role, "system");
        }

        return {
          ok: true,
          status: 200,
          async json() {
            return {
              id: `chatcmpl_proxy_${upstreamCalls}`,
              model: body.model ?? "example/model-a",
              choices: [{ message: { role: "assistant", content: `Proxy captured response ${upstreamCalls}.` } }],
              usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
              x_0g_trace: {
                request_id: `req_proxy_${upstreamCalls}`,
                provider: "0x0000000000000000000000000000000000000001",
                billing: { total_cost: "5" }
              }
            };
          }
        };
      },
      eventsLoader: defaultEventsLoader
    });

    const listenUrl = await proxy.start();

    const first = await fetch(`${listenUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-relay-goal": "Fix checkout session bug"
      },
      body: JSON.stringify({
        model: "example/model-a",
        messages: [{ role: "user", content: "Diagnose the refresh token failure." }]
      })
    });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("x-relay-proxy"), "true");

    const second = await fetch(`${listenUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "example/model-b",
        messages: [
          { role: "user", content: "old message" },
          { role: "assistant", content: "old reply" },
          { role: "user", content: "Continue with the patch plan." }
        ]
      })
    });
    assert.equal(second.status, 200);
    assert.equal(second.headers.get("x-relay-handoff-applied"), "true");

    const activeTask = await readActiveTask(projectRoot);
    assert.ok(activeTask?.capsule_id);

    const capsule = await readCapsule(projectRoot, activeTask.capsule_id);
    assert.match(capsule.payload.task.goal, /Fix checkout session bug/);
    assert.equal(upstreamCalls, 2);

    await proxy.close();
  });
});