import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";

const originalExec = childProcess.exec;

// Vite probes mapped Windows drives with `net use` during startup. The Codex
// sandbox blocks that child process even when the project itself is local.
// Treat only that read-only probe as an empty mapping table; preserve every
// other exec call so application tests keep their normal behavior.
childProcess.exec = function exec(command, ...args) {
  if (command !== "net use") {
    return originalExec.call(this, command, ...args);
  }

  const callback = args.find((value) => typeof value === "function");
  if (callback) {
    process.nextTick(() => callback(null, "There are no entries in the list.\n", ""));
  }

  return new EventEmitter();
};

syncBuiltinESMExports();
