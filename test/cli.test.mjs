import assert from "node:assert/strict";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runCli } from "../src/cli.mjs";
import { DEFAULT_ROUTER_BASE_URL, loadConfig } from "../src/config.mjs";
import { saveCapsule } from "../src/local-store.mjs";

function createIo(env = {}, cwd = process.cwd()) {
  let stdout = "";
  let stderr = "";

  return {
    io: {
      cwd,
      env,
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
      hasInferenceKey: false
    });

    assert.deepEqual(loadConfig({
      OG_ROUTER_BASE_URL: "https://example.invalid",
      OG_INFERENCE_API_KEY: "sk-test"
    }), {
      routerBaseUrl: "https://example.invalid",
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
