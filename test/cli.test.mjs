import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runCli } from "../src/cli.mjs";
import { DEFAULT_ROUTER_BASE_URL, loadConfig } from "../src/config.mjs";
import { saveCapsule } from "../src/local-store.mjs";

function createIo(env = {}, cwd = process.cwd(), fetchImpl = undefined) {
  let stdout = "";
  let stderr = "";

  return {
    io: {
      cwd,
      env,
      fetch: fetchImpl,
      stdout: {
        write(chunk) {
          stdout += chunk;
        }
      },
      stderr: {
        write(chunk) {
          stderr += chunk;
        }
      }
    },
    output() {
      return { stdout, stderr };
    }
  };
}

describe("Relay CLI", () => {
  it("prints help without requiring secrets", async () => {
    const harness = createIo();

    await runCli(["--help"], harness.io);

    const { stdout, stderr } = harness.output();
    assert.match(stdout, /Shared task context for 0G models/);
    assert.match(stdout, /relay doctor/);
    assert.equal(stderr, "");
  });

  it("runs doctor without requiring an inference key", async () => {
    const harness = createIo();

    await runCli(["doctor"], harness.io);

    const { stdout, stderr } = harness.output();
    assert.match(stdout, /0G inference key: missing/);
    assert.match(stdout, /Local checks passed/);
    assert.equal(stderr, "");
  });

  it("lists 0G Router models", async () => {
    const harness = createIo({}, process.cwd(), async () => ({
      ok: true,
      async json() {
        return {
          object: "list",
          data: [
            {
              id: "example/model",
              context_length: 262144,
              provider_count: 2,
              pricing: {
                prompt: "100",
                completion: "200"
              },
              capabilities: {
                chat: true,
                tools: true,
                vision: false,
                json_mode: true
              }
            }
          ]
        };
      }
    }));

    await runCli(["models"], harness.io);

    const { stdout, stderr } = harness.output();
    assert.match(stdout, /0G Router models \(1\)/);
    assert.match(stdout, /example\/model \| 262144 ctx \| 2 providers/);
    assert.match(stdout, /chat, tools, json/);
    assert.equal(stderr, "");
  });

  it("fails clearly when ask is missing an inference key", async () => {
    const harness = createIo();

    await assert.rejects(
      () => runCli(["ask", "--model", "example/model", "hello"], harness.io),
      /OG_INFERENCE_API_KEY/
    );
  });

  it("sends an ask request through the Router client", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-test-"));
    const harness = createIo({
      OG_INFERENCE_API_KEY: "sk-test"
    }, projectRoot, async () => ({
      ok: true,
      async json() {
        return {
          id: "chatcmpl_001",
          model: "example/model",
          choices: [
            {
              message: {
                role: "assistant",
                content: "hello from 0G"
              }
            }
          ],
          x_0g_trace: {
            request_id: "req_001",
            provider: "0x0000000000000000000000000000000000000000",
            billing: {
              total_cost: "300"
            }
          }
        };
      }
    }));

    await runCli(["ask", "--model", "example/model", "hello"], harness.io);

    const { stdout, stderr } = harness.output();
    assert.match(stdout, /hello from 0G/);
    assert.match(stdout, /event_id: evt_req_001/);
    assert.match(stdout, /event_hash: sha256:/);
    assert.match(stdout, /request_id: req_001/);
    assert.match(stdout, /total_cost: 300 neuron/);
    assert.equal(stderr, "");

    const eventFile = await stat(join(projectRoot, ".relay", "events", "evt_req_001.json"));
    assert.equal(eventFile.isFile(), true);
  });

  it("initializes local Relay runtime folders", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-test-"));
    const harness = createIo({}, projectRoot);

    await runCli(["init"], harness.io);

    const { stdout, stderr } = harness.output();
    assert.match(stdout, /Relay initialized at/);
    assert.equal(stderr, "");

    for (const directory of ["events", "capsules", "views", "traces"]) {
      const folder = await stat(join(projectRoot, ".relay", directory));
      assert.equal(folder.isDirectory(), true);
    }
  });

  it("lists local Context Capsules", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-test-"));
    const harness = createIo({}, projectRoot);
    await saveCapsule(projectRoot, sampleCapsule());

    await runCli(["capsule", "list"], harness.io);

    const { stdout, stderr } = harness.output();
    assert.match(stdout, /ctx_test_001/);
    assert.equal(stderr, "");
  });

  it("inspects the latest local Context Capsule", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-test-"));
    const harness = createIo({}, projectRoot);
    await saveCapsule(projectRoot, sampleCapsule());

    await runCli(["capsule", "inspect"], harness.io);

    const { stdout, stderr } = harness.output();
    assert.match(stdout, /Context Capsule: ctx_test_001/);
    assert.match(stdout, /Goal: Test Relay capsule inspection/);
    assert.match(stdout, /Verified facts: 1/);
    assert.equal(stderr, "");
  });

  it("loads config from environment with safe defaults", () => {
    assert.deepEqual(loadConfig({}), {
      routerBaseUrl: DEFAULT_ROUTER_BASE_URL,
      inferenceApiKey: "",
      hasInferenceKey: false
    });

    assert.deepEqual(loadConfig({
      OG_ROUTER_BASE_URL: "https://example.invalid",
      OG_INFERENCE_API_KEY: "sk-test"
    }), {
      routerBaseUrl: "https://example.invalid",
      inferenceApiKey: "sk-test",
      hasInferenceKey: true
    });
  });
});

function sampleCapsule() {
  return {
    schema: "relay.context.v1",
    capsule_id: "ctx_test_001",
    parent_capsule_id: null,
    created_at: "2026-06-23T10:01:00.000Z",
    task: {
      goal: "Test Relay capsule inspection"
    },
    state: {
      status: "in_progress",
      next_action: "Continue testing",
      blockers: []
    },
    facts: [
      {
        id: "fact_001",
        text: "The capsule exists",
        truth_state: "verified",
        evidence: ["ev_001"]
      }
    ],
    claims: [],
    decisions: [],
    evidence: [
      {
        id: "ev_001",
        kind: "model_output",
        source_event: "evt_001",
        hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    ],
    model_trace: [],
    routing: {
      last_model: null,
      recommended_next_step: "testing",
      recommended_mode: "compact"
    },
    storage: {}
  };
}
