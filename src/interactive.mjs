import { createInterface } from "node:readline";
import { clearActiveTask, readActiveTask } from "./active-task.mjs";
import { loadConfig } from "./config.mjs";
import { publishCapsuleBundle } from "./capsule-publish.mjs";
import { initializeLocalStore, listEvents, readCapsule, readEvent, saveCapsule, saveView } from "./local-store.mjs";
import { formatModelAccessReason, probeModelAccess } from "./model-access.mjs";
import { CONTEXT_MODES } from "./protocol.mjs";
import { loadStorageConfig } from "./storage-config.mjs";
import { startTask, stepTask } from "./task-runtime.mjs";
import { buildTaskMemorySummary } from "./task-summary.mjs";
import { fetchModelCatalog } from "./zerog-router.mjs";

export const INTERACTIVE_SLASH_HELP = `Slash commands:
  /help                 Show this help
  /quit, /exit          End the session
  /to <model-id> [msg]  Hand off task memory to another 0G model (like relay task continue)
  /switch <model-id>    Alias for /to
  /model <id>           Set the next model without handing off yet
  /mode <compact|standard|deep>
                        Capsule size used when handing off to another model
  /memory               Show current task memory summary
  /status               Show active task and model
  /new [goal]           Start a fresh task (optional goal)
  /models               List models allowed for your API key
  /publish              Publish capsule to 0G Storage
`;

export function parseHandoffSlashArgument(argument) {
  const trimmed = typeof argument === "string" ? argument.trim() : "";
  if (!trimmed) {
    return { modelId: null, message: null };
  }

  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return { modelId: trimmed, message: null };
  }

  return {
    modelId: trimmed.slice(0, spaceIndex).trim(),
    message: trimmed.slice(spaceIndex + 1).trim() || null
  };
}

export function parseInteractiveLaunchArgs(args) {
  let print = false;
  let resume = false;
  let model = null;
  let mode = "standard";
  let goal = null;
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "-p" || arg === "--print") {
      print = true;
      continue;
    }

    if (arg === "-c" || arg === "--continue") {
      resume = true;
      continue;
    }

    if (arg === "--model") {
      model = args[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (arg === "--mode") {
      mode = args[index + 1] ?? mode;
      index += 1;
      continue;
    }

    if (arg === "--goal") {
      goal = args[index + 1] ?? null;
      index += 1;
      continue;
    }

    if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  return {
    print,
    resume,
    model,
    mode,
    goal,
    message: positional.join(" ").trim() || null
  };
}

export function isInteractiveLaunch(args) {
  if (args.includes("-p") || args.includes("--print")) {
    return true;
  }

  if (args.includes("-c") || args.includes("--continue")) {
    return true;
  }

  if (args.some((arg) => arg === "--model" || arg === "--mode" || arg === "--goal")) {
    return true;
  }

  if (args.length > 0 && !args[0].startsWith("-")) {
    return true;
  }

  return false;
}

export async function runPrintCommand(launch, io) {
  const projectRoot = io.cwd ?? process.cwd();
  const config = loadConfig(io.env);

  if (!config.hasInferenceKey) {
    throw new Error("OG_INFERENCE_API_KEY is required. Set it in .env or your environment.");
  }

  if (!launch.message) {
    throw new Error("A message is required for print mode. Example: relay -p \"explain this error\"");
  }

  if (!CONTEXT_MODES.includes(launch.mode)) {
    throw new Error(`Invalid context mode "${launch.mode}". Choose one of: ${CONTEXT_MODES.join(", ")}.`);
  }

  await initializeLocalStore(projectRoot);

  const state = {
    model: launch.model,
    mode: launch.mode,
    goal: launch.goal
  };

  await resolveSessionModel(state, { projectRoot, config, io, resume: launch.resume });

  const result = await submitInteractiveMessage({
    projectRoot,
    config,
    io,
    state,
    message: launch.message,
    stream: false
  });

  writeInteractionFooter(io, result, { compact: false });
}

export async function runInteractiveSession(launch, io) {
  const projectRoot = io.cwd ?? process.cwd();
  const config = loadConfig(io.env);

  if (!config.hasInferenceKey) {
    throw new Error("OG_INFERENCE_API_KEY is required. Set it in .env or your environment.");
  }

  if (!CONTEXT_MODES.includes(launch.mode)) {
    throw new Error(`Invalid context mode "${launch.mode}". Choose one of: ${CONTEXT_MODES.join(", ")}.`);
  }

  await initializeLocalStore(projectRoot);

  const state = {
    model: launch.model,
    mode: launch.mode,
    goal: launch.goal
  };

  await resolveSessionModel(state, { projectRoot, config, io, resume: launch.resume });

  if (launch.quietStart) {
    io.stdout.write("relay>  What are we working on? 👋\n\n");
  } else {
    writeSessionBanner(io, state, projectRoot);
  }

  const rl = createInteractiveInterface(io);
  let closed = false;

  const close = () => {
    if (!closed) {
      closed = true;
      rl.close();
    }
  };

  try {
    if (launch.message) {
      await handleInteractiveLine({
        projectRoot,
        config,
        io,
        state,
        line: launch.message
      });
    }

    while (!closed) {
      const line = await question(rl, "relay> ");
      if (line === null) {
        break;
      }

      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      if (trimmed === "/quit" || trimmed === "/exit") {
        break;
      }

      await handleInteractiveLine({
        projectRoot,
        config,
        io,
        state,
        line: trimmed
      });
    }
  } finally {
    close();
  }
}

async function handleInteractiveLine({ projectRoot, config, io, state, line }) {
  if (line.startsWith("/")) {
    await handleSlashCommand({ projectRoot, config, io, state, line });
    return;
  }

  try {
    const result = await submitInteractiveMessage({
      projectRoot,
      config,
      io,
      state,
      message: line,
      stream: true
    });
    writeInteractionFooter(io, result, { compact: true });
  } catch (error) {
    io.stderr.write(`\n${error.message}\n`);
  }
}

async function handleSlashCommand({ projectRoot, config, io, state, line }) {
  const [command, ...rest] = line.slice(1).trim().split(/\s+/);
  const argument = rest.join(" ").trim();

  switch (command) {
    case "help":
      io.stdout.write(`\n${INTERACTIVE_SLASH_HELP}`);
      return;

    case "to":
    case "switch":
    case "continue":
      await runModelHandoff({
        projectRoot,
        config,
        io,
        state,
        argument
      });
      return;

    case "model": {
      if (!argument) {
        io.stderr.write("Usage: /model <model-id>\n");
        return;
      }
      state.model = argument;
      io.stdout.write(`\nNext model: ${state.model} (send a message to hand off)\n`);
      return;
    }

    case "mode": {
      if (!argument || !CONTEXT_MODES.includes(argument)) {
        io.stderr.write(`Usage: /mode <${CONTEXT_MODES.join("|")}>\n`);
        return;
      }
      state.mode = argument;
      io.stdout.write(`\nHandoff mode: ${state.mode}\n`);
      return;
    }

    case "memory":
    case "status":
      await writeSessionStatus({ projectRoot, io, state });
      return;

    case "new": {
      await clearActiveTask(projectRoot);
      state.goal = argument || null;
      io.stdout.write("\nStarted a fresh task. Your next message begins a new capsule.\n");
      if (state.goal) {
        io.stdout.write(`Goal: ${state.goal}\n`);
      }
      return;
    }

    case "models":
      await writeAllowedModels({ config, io });
      return;

    case "publish":
      await publishActiveCapsule({ projectRoot, io, state });
      return;

    default:
      io.stderr.write(`Unknown command: /${command}. Type /help for available commands.\n`);
  }
}

async function runModelHandoff({ projectRoot, config, io, state, argument }) {
  const { modelId, message } = parseHandoffSlashArgument(argument);

  if (!modelId) {
    io.stderr.write("Usage: /to <model-id> [message]\n");
    io.stderr.write("Example: /to 0gm-1.0-35b-a3b review the fix with a stronger model\n");
    return;
  }

  const activeTask = await readActiveTask(projectRoot);
  if (!activeTask) {
    state.model = modelId;
    io.stdout.write(`\nNext model: ${state.model}\n`);
    io.stdout.write("No task memory yet. Send a message first, then /to can hand off to another model.\n");
    return;
  }

  const previousModel = state.model;
  state.model = modelId;

  io.stdout.write(`\n⇄ Handing off to ${state.model} (${state.mode} capsule view)`);
  if (previousModel && previousModel !== state.model) {
    io.stdout.write(` from ${previousModel}`);
  }
  io.stdout.write("...\n");

  try {
    const result = await submitInteractiveMessage({
      projectRoot,
      config,
      io,
      state,
      message: message ?? "Continue the task from the Relay capsule above.",
      stream: true
    });
    writeInteractionFooter(io, result, { compact: true });
  } catch (error) {
    if (previousModel) {
      state.model = previousModel;
    }
    io.stderr.write(`\n${error.message}\n`);
  }
}

async function submitInteractiveMessage({ projectRoot, config, io, state, message, stream }) {
  if (!state.model) {
    throw new Error("No model selected. Use /model <model-id> or relay --model <model-id>.");
  }

  let wroteHeader = false;
  const onDelta = stream
    ? (delta) => {
      if (!wroteHeader) {
        io.stdout.write(`\n[${state.model}]\n`);
        wroteHeader = true;
      }
      io.stdout.write(delta);
    }
    : undefined;

  const activeTask = await readActiveTask(projectRoot);

  if (!activeTask) {
    const result = await startTask({
      projectRoot,
      model: state.model,
      goal: state.goal ?? message,
      message,
      baseUrl: config.routerBaseUrl,
      apiKey: config.inferenceApiKey,
      fetchImpl: io.fetch,
      stream,
      onDelta
    });
    state.goal = result.capsule.task.goal;
    return result;
  }

  const record = await readCapsule(projectRoot, activeTask.capsule_id);
  if (!record) {
    throw new Error(`Active task capsule not found: ${activeTask.capsule_id}`);
  }

  const events = await loadEventPayloads(projectRoot);
  return stepTask({
    projectRoot,
    capsule: record.payload,
    events,
    model: state.model,
    message,
    mode: state.mode,
    baseUrl: config.routerBaseUrl,
    apiKey: config.inferenceApiKey,
    fetchImpl: io.fetch,
    stream,
    onDelta
  });
}

async function resolveSessionModel(state, { projectRoot, config, io, resume }) {
  if (resume) {
    const activeTask = await readActiveTask(projectRoot);
    if (activeTask?.last_model && !state.model) {
      state.model = activeTask.last_model;
    }
    if (activeTask?.goal && !state.goal) {
      state.goal = activeTask.goal;
    }
  }

  if (state.model) {
    return;
  }

  if (!config.hasInferenceKey) {
    return;
  }

  const catalog = await fetchModelCatalog({ baseUrl: config.routerBaseUrl, fetchImpl: io.fetch });
  const access = await probeModelAccess({
    baseUrl: config.routerBaseUrl,
    apiKey: config.inferenceApiKey,
    models: catalog,
    fetchImpl: io.fetch
  });

  const firstAllowed = access.summary.allowedModels[0];
  if (firstAllowed) {
    state.model = firstAllowed.id;
    return;
  }

  const firstChat = catalog.find((model) => model.capabilities.chat);
  if (firstChat) {
    state.model = firstChat.id;
  }
}

function writeSessionBanner(io, state, projectRoot) {
  io.stdout.write("\nRelay interactive session ⚡\n");
  io.stdout.write("Shared task memory for 0G models. Type /help for commands, /quit to exit.\n");
  io.stdout.write("Switch models in-session: /to <model-id>\n");
  io.stdout.write(`Project: ${projectRoot}\n`);
  io.stdout.write(`Model: ${state.model ?? "not set — use /model <id>"}\n`);
  io.stdout.write(`Handoff mode: ${state.mode}\n`);

  if (state.goal) {
    io.stdout.write(`Goal: ${state.goal}\n`);
  }

  io.stdout.write("\n");
}

async function writeSessionStatus({ projectRoot, io, state }) {
  const activeTask = await readActiveTask(projectRoot);

  if (!activeTask) {
    io.stdout.write("\nNo active task yet. Send a message to start one.\n");
    io.stdout.write(`Model: ${state.model ?? "not set"}\n`);
    io.stdout.write(`Handoff mode: ${state.mode}\n`);
    return;
  }

  const record = await readCapsule(projectRoot, activeTask.capsule_id);
  if (!record) {
    io.stdout.write(`\nActive task capsule is missing: ${activeTask.capsule_id}\n`);
    return;
  }

  const events = await loadEventPayloads(projectRoot);
  const summary = buildTaskMemorySummary({
    capsule: record.payload,
    events,
    mode: state.mode,
    model: state.model ?? activeTask.last_model,
    transcriptIndependent: true
  });

  io.stdout.write(`\n${summary.text}\n`);
}

async function writeAllowedModels({ config, io }) {
  const catalog = await fetchModelCatalog({ baseUrl: config.routerBaseUrl, fetchImpl: io.fetch });
  const access = await probeModelAccess({
    baseUrl: config.routerBaseUrl,
    apiKey: config.inferenceApiKey,
    models: catalog,
    fetchImpl: io.fetch
  });

  io.stdout.write(`\nAllowed models (${access.summary.allowedModels.length}/${catalog.length})\n`);
  for (const model of access.summary.allowedModels) {
    io.stdout.write(`${model.id} — ${formatModelAccessReason(model.reason)}\n`);
  }
}

async function publishActiveCapsule({ projectRoot, io, state }) {
  const activeTask = await readActiveTask(projectRoot);
  if (!activeTask) {
    io.stderr.write("No active task to publish. Send a message first.\n");
    return;
  }

  const record = await readCapsule(projectRoot, activeTask.capsule_id);
  if (!record) {
    io.stderr.write(`Active task capsule not found: ${activeTask.capsule_id}\n`);
    return;
  }

  const storageConfig = loadStorageConfig(io.env);
  if (!storageConfig.hasPrivateKey) {
    io.stderr.write("OG_STORAGE_PRIVATE_KEY is required to publish capsules to 0G Storage.\n");
    return;
  }

  const events = await loadEventPayloads(projectRoot);
  const result = await publishCapsuleBundle({
    projectRoot,
    capsule: record.payload,
    events,
    mode: state.mode,
    storageConfig,
    deps: io.storageDeps
  });

  await saveCapsule(projectRoot, result.updatedCapsule);
  await saveView(projectRoot, result.view);

  io.stdout.write("\n✓ Published encrypted Context Capsule to 0G Storage.\n");
  io.stdout.write(`Relay URL: ${result.relayUrl}\n`);
  io.stdout.write(`Decryption key: ${result.keyHex}\n`);
}

function writeInteractionFooter(io, result, { compact }) {
  if (!compact) {
    io.stdout.write(`${result.completion.content}\n\n`);
  } else {
    io.stdout.write("\n\n");
  }

  const summary = buildCompactSummary(result.summary);
  io.stdout.write(`${summary}\n`);

  if (result.completion.trace.billing.totalCost) {
    io.stdout.write(`Router billing: ${result.completion.trace.billing.totalCost} neuron\n`);
  }

  io.stdout.write("\n");
}

function buildCompactSummary(summary) {
  const lines = summary.text.split("\n");
  const compactLines = lines.filter((line) => !line.startsWith("Switch models with:"));
  return compactLines.join("\n");
}

function createInteractiveInterface(io) {
  if (typeof io.createInterface === "function") {
    return io.createInterface();
  }

  return createInterface({
    input: io.stdin ?? process.stdin,
    output: io.stdout ?? process.stdout,
    terminal: io.isTTY !== false
  });
}

function question(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer));
  });
}

async function loadEventPayloads(projectRoot) {
  const listed = await listEvents(projectRoot);
  const records = await Promise.all(
    listed.map((entry) => readEvent(projectRoot, entry.id))
  );
  return records.map((record) => record.payload);
}