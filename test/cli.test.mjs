import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runCli } from "../src/cli.mjs";
import { DEFAULT_ROUTER_BASE_URL, loadConfig } from "../src/config.mjs";
import { saveCapsule, saveEvent } from "../src/local-store.mjs";

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
    assert.match(stdout, /Shared task memory for multi-model work/);
    assert.match(stdout, /relay task start/);
    assert.equal(stderr, "");
  });

  it("runs local status without requiring an inference key", async () => {
    const harness = createIo();

    await runCli(["status", "--local"], harness.io);

    const { stdout, stderr } = harness.output();
    assert.match(stdout, /Relay status/);
    assert.match(stdout, /0G inference key: missing/);
    assert.match(stdout, /Local configuration checked/);
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

  it("lists models allowed for the configured API key", async () => {
    const harness = createIo({
      OG_INFERENCE_API_KEY: "sk-test"
    }, process.cwd(), async (url, options) => {
      if (String(url).endsWith("/models")) {
        return {
          ok: true,
          async json() {
            return {
              object: "list",
              data: [
                {
                  id: "example/allowed",
                  context_length: 131072,
                  provider_count: 1,
                  pricing: { prompt: "100", completion: "200" },
                  capabilities: { chat: true, tools: false, vision: false, json_mode: false }
                },
                {
                  id: "example/denied",
                  context_length: 131072,
                  provider_count: 1,
                  pricing: { prompt: "50", completion: "100" },
                  capabilities: { chat: true, tools: false, vision: false, json_mode: false }
                }
              ]
            };
          }
        };
      }

      const body = JSON.parse(options.body);
      if (body.model === "example/denied") {
        return {
          ok: false,
          async json() {
            return { error: { message: "model not allowed for this api key: example/denied" } };
          }
        };
      }

      return {
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: "ok" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 }
          };
        }
      };
    });

    await runCli(["models", "--allowed"], harness.io);

    const { stdout, stderr } = harness.output();
    assert.match(stdout, /Allowed for your API key: 1 of 2 chat models/);
    assert.match(stdout, /example\/allowed \| allowed/);
    assert.match(stdout, /example\/denied \| not allowed for API key/);
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

    await runCli(["ask", "--model", "example/model", "--goal", "Test goal via flag", "hello"], harness.io);

    const { stdout, stderr } = harness.output();
    assert.match(stdout, /--- Model response ---/);
    assert.match(stdout, /hello from 0G/);
    assert.match(stdout, /--- Relay task memory ---/);
    assert.match(stdout, /Goal: Test goal via flag/);
    assert.match(stdout, /Capsule: ctx_req_001/);
    assert.match(stdout, /Router billing: 300 neuron/);
    assert.equal(stderr, "");

    const eventFile = await stat(join(projectRoot, ".relay", "events", "evt_req_001.json"));
    assert.equal(eventFile.isFile(), true);
    const capsuleFile = await stat(join(projectRoot, ".relay", "capsules", "ctx_req_001.json"));
    assert.equal(capsuleFile.isFile(), true);
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

  it("builds a standard context view with token estimates", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-test-"));
    const harness = createIo({}, projectRoot);
    await saveCapsule(projectRoot, sampleCapsule());

    await runCli(["capsule", "view", "--mode", "standard"], harness.io);

    const { stdout, stderr } = harness.output();
    assert.match(stdout, /Context mode: standard/);
    assert.match(stdout, /Estimated handoff: /);
    assert.match(stdout, /Full event history: /);
    assert.match(stdout, /Sections: /);
    assert.match(stdout, /--- Handoff preview ---/);
    assert.match(stdout, /Test Relay capsule inspection/);
    assert.equal(stderr, "");

    const viewFile = await stat(join(projectRoot, ".relay", "views", "view_test_001_standard.json"));
    assert.equal(viewFile.isFile(), true);
  });

  it("returns JSON output for capsule handoff when requested", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-test-"));
    const harness = createIo({}, projectRoot);
    await saveCapsule(projectRoot, sampleCapsule());

    await runCli(["capsule", "view", "--mode", "compact", "--json"], harness.io);

    const { stdout, stderr } = harness.output();
    const payload = JSON.parse(stdout);
    assert.equal(payload.view.mode, "compact");
    assert.equal(payload.view.source_capsule_id, "ctx_test_001");
    assert.ok(payload.estimates.viewTokens >= 0);
    assert.match(payload.handoff, /Relay Context Capsule/);
    assert.equal(stderr, "");
  });

  it("switches to another model using a transcript-independent capsule handoff", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-test-"));
    const harness = createIo({
      OG_INFERENCE_API_KEY: "sk-test"
    }, projectRoot, async () => ({
      ok: true,
      async json() {
        return {
          id: "chatcmpl_switch_001",
          model: "example/model-b",
          choices: [
            {
              message: {
                role: "assistant",
                content: "Continuing from the capsule: patch checkout/session.ts next."
              }
            }
          ],
          x_0g_trace: {
            request_id: "req_switch_001",
            provider: "0x0000000000000000000000000000000000000001",
            billing: {
              total_cost: "45"
            }
          }
        };
      }
    }));

    await saveCapsule(projectRoot, sampleCapsule());
    await saveEvent(projectRoot, sampleSwitchEvent());

    await runCli([
      "switch",
      "--to",
      "example/model-b",
      "--mode",
      "standard",
      "--message",
      "Continue from the capsule"
    ], harness.io);

    const { stdout, stderr } = harness.output();
    assert.match(stdout, /Continuing from the capsule/);
    assert.match(stdout, /--- Relay task memory ---/);
    assert.match(stdout, /Transcript replay avoided: yes/);
    assert.match(stdout, /Capsule: ctx_test_001/);
    assert.match(stdout, /Active model: example\/model-b/);
    assert.equal(stderr, "");

    const eventFile = await stat(join(projectRoot, ".relay", "events", "evt_req_switch_001.json"));
    assert.equal(eventFile.isFile(), true);
  });

  it("extends an active task with relay task step", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-test-"));
    const harness = createIo({
      OG_INFERENCE_API_KEY: "sk-test"
    }, projectRoot);
    let calls = 0;
    harness.io.fetch = async () => {
      calls += 1;
      return {
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: calls === 1 ? "First step" : "Second step" } }],
            x_0g_trace: {
              request_id: `req_${calls}`,
              provider: "0x0000000000000000000000000000000000000001",
              billing: { total_cost: String(calls) }
            }
          };
        }
      };
    };

    await runCli([
      "task",
      "start",
      "--model",
      "example/model-a",
      "--goal",
      "Ship feature",
      "--message",
      "Start"
    ], harness.io);
    await runCli(["task", "step", "--message", "Continue on same task"], harness.io);

    const { stdout } = harness.output();
    assert.match(stdout, /Second step/);
    assert.match(stdout, /Goal: Ship feature/);
    assert.match(stdout, /Transcript replay avoided: yes/);
  });

  it("publishes a capsule through the CLI with mocked 0G Storage", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-test-"));
    const rootHash = `0x${"f".repeat(64)}`;
    const harness = createIo({
      OG_STORAGE_PRIVATE_KEY: "0x" + "2".repeat(64),
      OG_STORAGE_NETWORK: "testnet"
    }, projectRoot);
    harness.io.storageDeps = {
      uploadEncryptedBytes: async () => ({
        rootHash,
        txHash: "0xtx_cli_publish"
      })
    };

    await saveCapsule(projectRoot, sampleCapsule());

    await runCli(["capsule", "publish", "--mode", "compact"], harness.io);

    const { stdout, stderr } = harness.output();
    assert.match(stdout, /Published encrypted Context Capsule/);
    assert.match(stdout, new RegExp(`Relay URL: relay://0g-storage/testnet/${rootHash}`));
    assert.match(stdout, /Decryption key: 0x/);
    assert.match(stdout, /Capsule ID: ctx_test_001/);
    assert.equal(stderr, "");
  });

  it("fetches a published capsule through the CLI with mocked 0G Storage", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-test-"));
    const rootHash = `0x${"e".repeat(64)}`;
    const harness = createIo({}, projectRoot);
    const bundle = {
      schema: "relay.capsule-bundle.v1",
      manifest: {
        bundle_schema: "relay.capsule-bundle.v1",
        created_at: "2026-06-23T10:01:00.000Z",
        capsule_id: "ctx_test_001",
        files: ["capsule.json", "events.jsonl", "handoff.md", "traces/"],
        event_count: 0,
        trace_count: 0,
        content_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      capsule: sampleCapsule(),
      events: [],
      traces: [],
      handoff: "# Relay Context Capsule"
    };

    const { canonicalJson, sha256Digest } = await import("../src/hash.mjs");
    bundle.manifest.content_hash = sha256Digest(canonicalJson({
      capsule: bundle.capsule,
      events: bundle.events,
      traces: bundle.traces,
      handoff: bundle.handoff
    }));

    harness.io.storageDeps = {
      peekEncryptionHeader: async () => ({ version: 1 }),
      downloadEncryptedBytes: async () => Buffer.from(canonicalJson(bundle), "utf8")
    };

    const { savePublishKey } = await import("../src/publish-keys.mjs");
    await savePublishKey(projectRoot, {
      root_hash: rootHash,
      encryption: "aes256",
      key_hex: "0x" + "3".repeat(64),
      network: "testnet",
      mode: "turbo",
      relay_url: `relay://0g-storage/testnet/${rootHash}`,
      capsule_id: "ctx_test_001"
    });

    await runCli(["capsule", "fetch", `relay://0g-storage/testnet/${rootHash}`], harness.io);

    const { stdout, stderr } = harness.output();
    assert.match(stdout, /Fetched and validated encrypted Context Capsule/);
    assert.match(stdout, /Proof verified: yes/);
    assert.match(stdout, /Capsule ID: ctx_test_001/);
    assert.equal(stderr, "");
  });

  it("runs live status checks by default", async () => {
    const harness = createIo({}, process.cwd(), async (url) => ({
      ok: true,
      async json() {
        if (String(url).includes("/models")) {
          return {
            object: "list",
            data: [{
              id: "example/model",
              pricing: { prompt: "1", completion: "1" },
              capabilities: { chat: true, json_mode: true }
            }]
          };
        }
        return {};
      }
    }));

    await runCli(["status"], harness.io);

    const { stdout, stderr } = harness.output();
    assert.match(stdout, /Live checks:/);
    assert.match(stdout, /router_catalog/);
    assert.equal(stderr, "");
  });

  it("runs relay demo with mocked integrations", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-test-"));
    const harness = createIo({ OG_INFERENCE_API_KEY: "sk-proof" }, projectRoot);
    let calls = 0;
    harness.io.fetch = async (url) => {
      if (String(url).includes("/models")) {
        return {
          ok: true,
          async json() {
            return {
              object: "list",
              data: [{
                id: "example/model-a",
                pricing: { prompt: "1", completion: "1" },
                capabilities: { chat: true, json_mode: true }
              }]
            };
          }
        };
      }
      calls += 1;
      return {
        ok: true,
        async json() {
          return {
            id: `chatcmpl_${calls}`,
            model: calls === 1 ? "example/model-a" : "example/model-b",
            choices: [{ message: { role: "assistant", content: "proof response" } }],
            x_0g_trace: {
              request_id: `req_${calls}`,
              provider: "0x0000000000000000000000000000000000000000",
              billing: { total_cost: "1" }
            }
          };
        }
      };
    };

    await runCli([
      "demo",
      "--skip-storage",
      "--model-a",
      "example/model-a",
      "--model-b",
      "example/model-b"
    ], harness.io);

    const { stdout, stderr } = harness.output();
    assert.match(stdout, /Relay end-to-end demo/);
    assert.match(stdout, /Result: PASS/);
    assert.equal(stderr, "");
  });

  it("fails clearly when publish is missing a storage private key", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-test-"));
    const harness = createIo({}, projectRoot);
    await saveCapsule(projectRoot, sampleCapsule());

    await assert.rejects(
      () => runCli(["capsule", "publish"], harness.io),
      /OG_STORAGE_PRIVATE_KEY/
    );
  });

  it("fails clearly when task continue is missing --to", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-test-"));
    const harness = createIo({ OG_INFERENCE_API_KEY: "sk-test" }, projectRoot);
    await saveCapsule(projectRoot, sampleCapsule());

    await assert.rejects(
      () => runCli(["task", "continue", "--mode", "standard"], harness.io),
      /--to is required/
    );
  });

  it("fails clearly when task continue is missing an inference key", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-test-"));
    const harness = createIo({}, projectRoot);
    await saveCapsule(projectRoot, sampleCapsule());

    await assert.rejects(
      () => runCli(["task", "continue", "--to", "example/model-b", "--mode", "standard"], harness.io),
      /OG_INFERENCE_API_KEY/
    );
  });

  it("accepts legacy command aliases", async () => {
    const harness = createIo();

    await runCli(["doctor", "--local"], harness.io);

    const { stdout } = harness.output();
    assert.match(stdout, /Relay status/);
    assert.match(stdout, /Local configuration checked/);
  });

  it("fails clearly when capsule handoff is missing --mode", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-test-"));
    const harness = createIo({}, projectRoot);
    await saveCapsule(projectRoot, sampleCapsule());

    await assert.rejects(
      () => runCli(["capsule", "view"], harness.io),
      /--mode is required/
    );
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

function sampleSwitchEvent() {
  return {
    schema: "relay.event.v1",
    event_id: "evt_001",
    timestamp: "2026-06-23T10:01:00.000Z",
    kind: "model.response",
    source: {
      runtime: "0g-router",
      model_id: "example/model-a",
      provider: "0x0000000000000000000000000000000000000000",
      request_id: "req_001"
    },
    trace: {
      model_id: "example/model-a",
      provider: "0x0000000000000000000000000000000000000000",
      request_id: "req_001",
      input_tokens: 100,
      output_tokens: 50,
      billing: {
        currency: "neuron",
        input_cost: "10",
        output_cost: "20",
        total_cost: "30"
      },
      tee_verified: null
    },
    payload: {
      prompt: "This full transcript prompt must never be replayed during model switching.",
      response: "This full transcript response must never be replayed during model switching."
    },
    content_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  };
}

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
