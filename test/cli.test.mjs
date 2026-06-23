import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runCli } from "../src/cli.mjs";
import { DEFAULT_ROUTER_BASE_URL, loadConfig } from "../src/config.mjs";

function createIo(env = {}) {
  let stdout = "";
  let stderr = "";

  return {
    io: {
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
