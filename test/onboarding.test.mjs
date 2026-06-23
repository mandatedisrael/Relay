import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  WELCOME_BANNER,
  envFilePath,
  runOnboardingWizard,
  writeProjectEnv
} from "../src/onboarding.mjs";

function createOnboardingIo(responses = {}) {
  let stdout = "";
  let stderr = "";
  const maskedQueue = [...(responses.masked ?? ["sk-test-key", ""])];
  const lineQueue = [...(responses.lines ?? [])];

  return {
    io: {
      stdout: { write(chunk) { stdout += chunk; } },
      stderr: { write(chunk) { stderr += chunk; } },
      async promptMasked(_label) {
        return maskedQueue.shift() ?? "";
      },
      async promptLine(_label) {
        return lineQueue.shift() ?? "";
      }
    },
    output() {
      return { stdout, stderr };
    }
  };
}

describe("Relay onboarding", () => {
  it("prints the welcome banner with shared memory and token efficiency", () => {
    assert.match(WELCOME_BANNER, /one shared memory/i);
    assert.match(WELCOME_BANNER, /every model and CLI layer/i);
    assert.match(WELCOME_BANNER, /token efficiency/i);
    assert.match(WELCOME_BANNER, /Welcome to Relay/);
  });

  it("writes a local .env file from collected values", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-onboarding-"));

    await writeProjectEnv(projectRoot, {
      OG_INFERENCE_API_KEY: "sk-test",
      OG_STORAGE_PRIVATE_KEY: "0xabc"
    });

    const text = await readFile(envFilePath(projectRoot), "utf8");
    assert.match(text, /OG_INFERENCE_API_KEY=sk-test/);
    assert.match(text, /OG_STORAGE_PRIVATE_KEY=0xabc/);
    assert.match(text, /OG_ROUTER_BASE_URL=https:\/\/router-api\.0g\.ai\/v1/);
  });

  it("runs the onboarding wizard and opens Relay after setup", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-onboarding-"));
    const harness = createOnboardingIo({
      masked: ["sk-test-key", ""]
    });

    const result = await runOnboardingWizard(projectRoot, harness.io);
    const { stdout } = harness.output();

    assert.equal(result.skipped, false);
    assert.match(stdout, /Welcome to Relay/);
    assert.match(stdout, /✓ Locked in\./);
    assert.match(stdout, /Storage skipped/);
    assert.match(stdout, /✓ Ready\. Opening Relay/);

    const envText = await readFile(envFilePath(projectRoot), "utf8");
    assert.match(envText, /OG_INFERENCE_API_KEY=sk-test-key/);
  });

  it("skips reconfigure when an existing .env is kept", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-onboarding-"));
    await writeProjectEnv(projectRoot, {
      OG_INFERENCE_API_KEY: "sk-existing"
    });

    const harness = createOnboardingIo({
      lines: ["n"]
    });

    const result = await runOnboardingWizard(projectRoot, harness.io);
    const envText = await readFile(envFilePath(projectRoot), "utf8");

    assert.equal(result.skipped, true);
    assert.match(envText, /OG_INFERENCE_API_KEY=sk-existing/);
  });
});