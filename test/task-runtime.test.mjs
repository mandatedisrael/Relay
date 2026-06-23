import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readActiveTask } from "../src/active-task.mjs";
import { startTask, stepTask } from "../src/task-runtime.mjs";

describe("Relay task runtime", () => {
  it("starts a task, tracks active memory, and returns a task summary", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-task-test-"));
    const result = await startTask({
      projectRoot,
      model: "example/model-a",
      goal: "Fix checkout",
      message: "Find the first diagnostic step",
      baseUrl: "https://router-api.0g.ai/v1",
      apiKey: "sk-test",
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return {
            id: "chatcmpl_start",
            model: "example/model-a",
            choices: [{ message: { role: "assistant", content: "Check session refresh handling." } }],
            usage: { prompt_tokens: 10, completion_tokens: 8 },
            x_0g_trace: {
              request_id: "req_start",
              provider: "0x0000000000000000000000000000000000000001",
              billing: { total_cost: "10" }
            }
          };
        }
      })
    });

    assert.match(result.summary.text, /Relay task memory/);
    assert.match(result.summary.text, /Goal: Fix checkout/);
    assert.equal(result.capsule.task.goal, "Fix checkout");

    const activeTask = await readActiveTask(projectRoot);
    assert.equal(activeTask.capsule_id, result.capsule.capsule_id);
    assert.equal(activeTask.last_model, "example/model-a");

    const savedCapsule = JSON.parse(
      await readFile(join(projectRoot, ".relay", "capsules", `${result.capsule.capsule_id}.json`), "utf8")
    );
    assert.equal(savedCapsule.payload.task.goal, "Fix checkout");
  });

  it("extends the active task with a transcript-independent step", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "relay-task-test-"));
    const started = await startTask({
      projectRoot,
      model: "example/model-a",
      goal: "Fix checkout",
      message: "Start",
      baseUrl: "https://router-api.0g.ai/v1",
      apiKey: "sk-test",
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: "Step one" } }],
            x_0g_trace: {
              request_id: "req_1",
              provider: "0x0000000000000000000000000000000000000001",
              billing: { total_cost: "1" }
            }
          };
        }
      })
    });

    const events = [started.event];
    const stepped = await stepTask({
      projectRoot,
      capsule: started.capsule,
      events,
      model: "example/model-a",
      message: "Add the next step",
      mode: "compact",
      baseUrl: "https://router-api.0g.ai/v1",
      apiKey: "sk-test",
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: "Step two" } }],
            x_0g_trace: {
              request_id: "req_2",
              provider: "0x0000000000000000000000000000000000000001",
              billing: { total_cost: "2" }
            }
          };
        }
      })
    });

    assert.match(stepped.summary.text, /Transcript replay avoided: yes/);
    assert.equal(stepped.updatedCapsule.capsule_id, started.capsule.capsule_id);
  });
});