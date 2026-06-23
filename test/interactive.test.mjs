import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runCli } from "../src/cli.mjs";
import {
  isInteractiveLaunch,
  parseHandoffSlashArgument,
  parseInteractiveLaunchArgs,
  runInteractiveSession
} from "../src/interactive.mjs";

function createMockReadline(lines) {
  const queue = [...lines];

  return {
    question(_prompt, callback) {
      const line = queue.shift();
      if (line === undefined) {
        callback(null);
        return;
      }
      callback(line);
    },
    close() {},
    on() {
      return this;
    }
  };
}

function createFetchMock() {
  return async (url, options) => {
    if (String(url).endsWith("/models")) {
      return {
        ok: true,
        async json() {
          return {
            object: "list",
            data: [
              {
                id: "example/model",
                context_length: 131072,
                provider_count: 1,
                pricing: { prompt: "100", completion: "200" },
                capabilities: { chat: true, tools: false, vision: false, json_mode: false }
              }
            ]
          };
        }
      };
    }

    const body = JSON.parse(options.body);
    const responseText = body.model === "example/strong"
      ? "Strong model review"
      : "Hello from Relay";

    if (body.stream) {
      const encoder = new TextEncoder();
      const chunks = [
        `data: {\"choices\":[{\"delta\":{\"content\":\"${responseText.slice(0, 4)}\"}}]}\n\n`,
        `data: {\"choices\":[{\"delta\":{\"content\":\"${responseText.slice(4)}\"}}],\"model\":\"${body.model}\",\"x_0g_trace\":{\"request_id\":\"req_stream\",\"provider\":\"0xabc\",\"billing\":{\"total_cost\":\"10\"}}}\n\n`,
        "data: [DONE]\n\n"
      ];

      return {
        ok: true,
        body: {
          async *[Symbol.asyncIterator]() {
            for (const chunk of chunks) {
              yield encoder.encode(chunk);
            }
          }
        }
      };
    }

    return {
      ok: true,
      async json() {
        return {
          id: "chatcmpl_001",
          model: "example/model",
          choices: [{ message: { role: "assistant", content: responseText } }],
          usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
          x_0g_trace: {
            request_id: "req_001",
            provider: "0xabc",
            billing: { total_cost: "12" }
          }
        };
      }
    };
  };
}

function createIo({ env = {}, cwd, fetchImpl, lines = [], isTTY = true } = {}) {
  let stdout = "";
  let stderr = "";

  return {
    io: {
      cwd,
      env: {
        OG_INFERENCE_API_KEY: "sk-test",
        ...env
      },
      fetch: fetchImpl,
      isTTY,
      stdin: {},
      stdout: {
        write(chunk) {
          stdout += chunk;
        }
      },
      stderr: {
        write(chunk) {
          stderr += chunk;
        }
      },
      createInterface() {
        return createMockReadline(lines);
      }
    },
    output() {
      return { stdout, stderr };
    }
  };
}

describe("interactive launch parsing", () => {
  it("parses handoff slash arguments", () => {
    assert.deepEqual(parseHandoffSlashArgument("example/strong review the fix"), {
      modelId: "example/strong",
      message: "review the fix"
    });
    assert.deepEqual(parseHandoffSlashArgument("glm-5.1"), {
      modelId: "glm-5.1",
      message: null
    });
  });

  it("detects print and resume flags", () => {
    assert.deepEqual(parseInteractiveLaunchArgs(["-p", "--model", "glm", "hello"]), {
      print: true,
      resume: false,
      model: "glm",
      mode: "standard",
      goal: null,
      message: "hello"
    });

    assert.equal(isInteractiveLaunch(["-c"]), true);
    assert.equal(isInteractiveLaunch(["status"]), true);
  });
});

describe("Relay interactive session", () => {
  it("runs a multi-turn interactive session with streaming output", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-interactive-"));
    const harness = createIo({
      cwd: projectRoot,
      fetchImpl: createFetchMock(),
      lines: ["what is failing?", "/memory", "/quit"]
    });

    await runInteractiveSession({
      print: false,
      resume: false,
      model: "example/model",
      mode: "compact",
      goal: null,
      message: null
    }, harness.io);

    const { stdout } = harness.output();
    assert.match(stdout, /Relay interactive session/);
    assert.match(stdout, /\[example\/model\]/);
    assert.match(stdout, /Hello/);
    assert.match(stdout, /Relay task memory/);
    assert.match(stdout, /what is failing/);
  });

  it("starts interactive mode from relay with an initial prompt", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-interactive-"));
    const harness = createIo({
      cwd: projectRoot,
      fetchImpl: createFetchMock(),
      lines: ["/quit"]
    });

    await runCli(["--model", "example/model", "fix checkout"], harness.io);

    const { stdout } = harness.output();
    assert.match(stdout, /Relay interactive session/);
    assert.match(stdout, /fix checkout/);
    assert.match(stdout, /Relay task memory/);
  });

  it("supports one-shot print mode", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-interactive-"));
    const harness = createIo({
      cwd: projectRoot,
      fetchImpl: createFetchMock()
    });

    await runCli(["-p", "--model", "example/model", "summarize the failure"], harness.io);

    const { stdout } = harness.output();
    assert.match(stdout, /Hello from Relay/);
    assert.match(stdout, /Relay task memory/);
    assert.doesNotMatch(stdout, /relay>/);
  });

  it("hands off to another model with /to", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-interactive-"));
    const harness = createIo({
      cwd: projectRoot,
      fetchImpl: createFetchMock(),
      lines: [
        "start with a cheap diagnosis",
        "/to example/strong review the patch",
        "/quit"
      ]
    });

    await runInteractiveSession({
      print: false,
      resume: false,
      model: "example/model",
      mode: "compact",
      goal: null,
      message: null
    }, harness.io);

    const { stdout } = harness.output();
    assert.match(stdout, /Handing off to example\/strong/);
    assert.match(stdout, /\[example\/strong\]/);
    assert.match(stdout, /Strong model review/);
    assert.match(stdout, /Transcript replay avoided: yes/);
  });

  it("prints help when invoked without a TTY", async () => {
    const harness = createIo({ isTTY: false });

    await runCli([], harness.io);

    const { stdout } = harness.output();
    assert.match(stdout, /Interactive session \(default\)/);
    assert.match(stdout, /relay task start/);
  });
});