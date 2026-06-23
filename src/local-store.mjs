import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson, sha256Digest } from "./hash.mjs";

const STORE_DIRECTORIES = [
  "events",
  "capsules",
  "views",
  "traces"
];

const COLLECTIONS = Object.freeze({
  event: "events",
  capsule: "capsules",
  view: "views",
  trace: "traces"
});

export async function initializeLocalStore(projectRoot) {
  const root = join(projectRoot, ".relay");

  await mkdir(root, { recursive: true });

  await Promise.all(
    STORE_DIRECTORIES.map((directory) => mkdir(join(root, directory), { recursive: true }))
  );

  return {
    root,
    directories: STORE_DIRECTORIES.map((directory) => join(root, directory))
  };
}

export async function saveEvent(projectRoot, event) {
  return writeRecord(projectRoot, "event", event.event_id, event);
}

export async function saveCapsule(projectRoot, capsule) {
  return writeRecord(projectRoot, "capsule", capsule.capsule_id, capsule);
}

export async function saveView(projectRoot, view) {
  return writeRecord(projectRoot, "view", view.view_id, view);
}

export async function saveTrace(projectRoot, trace) {
  return writeRecord(projectRoot, "trace", trace.request_id, trace);
}

export async function listCapsules(projectRoot) {
  return listRecords(projectRoot, "capsule");
}

export async function listEvents(projectRoot) {
  return listRecords(projectRoot, "event");
}

export async function readEvent(projectRoot, eventId) {
  return readRecord(projectRoot, "event", eventId);
}

export async function readCapsule(projectRoot, capsuleId = "latest") {
  if (capsuleId === "latest") {
    const capsules = await listCapsules(projectRoot);
    if (capsules.length === 0) return null;
    return readRecord(projectRoot, "capsule", capsules.at(-1).id);
  }

  return readRecord(projectRoot, "capsule", capsuleId);
}

async function writeRecord(projectRoot, collectionName, id, payload) {
  const directory = await ensureCollection(projectRoot, collectionName);
  const body = canonicalJson(payload);
  const record = {
    id,
    collection: collectionName,
    saved_at: new Date().toISOString(),
    content_hash: sha256Digest(body),
    payload
  };

  await writeFile(join(directory, `${id}.json`), canonicalJson(record), "utf8");
  return record;
}

async function listRecords(projectRoot, collectionName) {
  const directory = await ensureCollection(projectRoot, collectionName);
  const entries = await readdir(directory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => ({
      id: entry.name.slice(0, -".json".length),
      path: join(directory, entry.name)
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function readRecord(projectRoot, collectionName, id) {
  const directory = await ensureCollection(projectRoot, collectionName);
  const contents = await readFile(join(directory, `${id}.json`), "utf8");
  return JSON.parse(contents);
}

async function ensureCollection(projectRoot, collectionName) {
  const directoryName = COLLECTIONS[collectionName];
  if (!directoryName) {
    throw new Error(`Unknown Relay collection: ${collectionName}`);
  }

  const root = join(projectRoot, ".relay");
  const directory = join(root, directoryName);
  await mkdir(directory, { recursive: true });
  return directory;
}
