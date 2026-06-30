import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { versions } from "node:process";
import { loadConfig } from "./config.js";
import { validateConfig, type Diagnostic } from "./configValidation.js";

const config = loadConfig();
const result = validateConfig(config);
const diagnostics = [
  nodeVersionDiagnostic(),
  envFileDiagnostic(),
  historyDirectoryDiagnostic(config.history.databasePath),
  ...result.diagnostics
].filter((diagnostic): diagnostic is Diagnostic => Boolean(diagnostic));

console.log("Song Request Corner doctor\n");
console.log(`Node.js: ${versions.node}`);
console.log(`Bot transport: ${config.botTransport}`);
console.log(`Music provider: ${config.musicProvider}`);
console.log(`Player adapter: ${config.playerAdapter}`);
console.log(`Admin page: ${config.adminServer.enabled ? `http://${config.adminServer.host}:${config.adminServer.port}` : "disabled"}`);
console.log(`History database: ${config.history.databasePath}`);
console.log("");

for (const diagnostic of diagnostics) {
  console.log(`${markerFor(diagnostic.severity)} ${diagnostic.message}`);
  if (diagnostic.hint) {
    console.log(`  Hint: ${diagnostic.hint}`);
  }
}

if (diagnostics.length === 0) {
  console.log("[OK] No issues found.");
}

const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
console.log("");
console.log(`Summary: ${errorCount} error(s), ${warningCount} warning(s).`);

if (errorCount > 0) {
  process.exitCode = 1;
}

function nodeVersionDiagnostic(): Diagnostic | undefined {
  const major = Number(versions.node.split(".")[0]);
  if (major < 22) {
    return {
      severity: "error",
      code: "node-too-old",
      message: "Node.js 22 or newer is required.",
      hint: "The play history store uses node:sqlite, which is available in Node.js 22+."
    };
  }

  return undefined;
}

function envFileDiagnostic(): Diagnostic | undefined {
  if (existsSync(".env")) {
    return undefined;
  }

  return {
    severity: "warning",
    code: "missing-env-file",
    message: ".env was not found.",
    hint: "Copy .env.example to .env and fill in your Feishu and NetEase settings."
  };
}

function historyDirectoryDiagnostic(databasePath: string): Diagnostic | undefined {
  const directory = dirname(databasePath);
  if (directory === "." || existsSync(directory)) {
    return undefined;
  }

  return {
    severity: "info",
    code: "history-directory-missing",
    message: `History database directory does not exist yet: ${directory}`,
    hint: "It will be created automatically on startup."
  };
}

function markerFor(severity: Diagnostic["severity"]): string {
  switch (severity) {
    case "error":
      return "[ERROR]";
    case "warning":
      return "[WARN]";
    case "info":
      return "[INFO]";
  }
}
