import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { canonicalJson, sha256Digest } from "../src/hash.mjs";
import {
  initializeLocalStore,
  listCapsules,
  readCapsule,
  saveCapsule,
  saveEvent,
  saveTrace,
  saveView
} from "../src/local-store.mjs";

async function tempProject() {
  return mkdtemp(join(tmpdir(), "relay-store-test-"));
}

async function readFixture(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("Relay local store", () => {
  it("initializes the expected runtime folders", async () => {
    const projectRoot = await tempProject();

    const result = await initializeLocalStore(projectRoot);

    assert.equal(result.root, join(projectRoot, ".relay"));
    assert.equal(result.directories.length, 4);
  });

  it("saves and lists capsules with deterministic content hashes", async () => {
    const projectRoot = await tempProject();
    const capsule = await readFixture("protocol/fixtures/valid-capsule.json");

    const record = await saveCapsule(projectRoot, capsule);
    const listed = await listCapsules(projectRoot);
    const latest = await readCapsule(projectRoot);

    assert.equal(record.id, capsule.capsule_id);
    assert.equal(record.content_hash, sha256Digest(canonicalJson(capsule)));
    assert.deepEqual(listed.map((entry) => entry.id), [capsule.capsule_id]);
    assert.equal(latest.payload.capsule_id, capsule.capsule_id);
  });

  it("saves events, views, and traces", async () => {
    const projectRoot = await tempProject();
    const event = await readFixture("protocol/fixtures/valid-event.json");
    const view = await readFixture("protocol/fixtures/valid-view.json");
    const capsule = await readFixture("protocol/fixtures/valid-capsule.json");
    const trace = capsule.model_trace[0];

    const eventRecord = await saveEvent(projectRoot, event);
    const viewRecord = await saveView(projectRoot, view);
    const traceRecord = await saveTrace(projectRoot, trace);

    assert.equal(eventRecord.collection, "event");
    assert.equal(viewRecord.collection, "view");
    assert.equal(traceRecord.collection, "trace");
  });
});
