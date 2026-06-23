import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const STORE_DIRECTORIES = [
  "events",
  "capsules",
  "views",
  "traces"
];

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
