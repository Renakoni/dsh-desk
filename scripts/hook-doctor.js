#!/usr/bin/env node

const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const eventHost = process.env.CHARA_DESK_HOST || "127.0.0.1";
const eventPort = Number(process.env.CHARA_DESK_PORT || 17321);

const checks = [];
let hasFailure = false;

function addCheck(level, label, detail) {
  if (level === "FAIL") hasFailure = true;
  checks.push({ level, label, detail });
}

function exists(relativePath) {
  return fs.existsSync(path.join(projectRoot, relativePath));
}

function readPackageJson() {
  const packagePath = path.join(projectRoot, "package.json");
  try {
    return JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    return null;
  }
}

function checkTcpPort(host, port, timeoutMs = 700) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    socket.on("connect", () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });

    socket.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function printReport() {
  console.log("DSH Desk hook doctor");
  console.log("");

  for (const check of checks) {
    console.log(`[${check.level}] ${check.label}`);
    if (check.detail) console.log(`       ${check.detail}`);
  }

  console.log("");
  console.log("Manual hook commands:");
  console.log(`  node ${path.join(projectRoot, "scripts", "hook-forwarder.js")} SessionStart`);
  console.log(`  node ${path.join(projectRoot, "scripts", "hook-forwarder.js")} UserPromptSubmit`);
  console.log(`  node ${path.join(projectRoot, "scripts", "hook-forwarder.js")} PreToolUse`);
  console.log(`  node ${path.join(projectRoot, "scripts", "hook-forwarder.js")} PostToolUse`);
  console.log(`  node ${path.join(projectRoot, "scripts", "hook-forwarder.js")} Notification`);
  console.log(`  node ${path.join(projectRoot, "scripts", "hook-forwarder.js")} Stop`);
}

async function main() {
  if (exists("scripts/hook-forwarder.js")) {
    addCheck("OK", "hook forwarder script found", "scripts/hook-forwarder.js");
  } else {
    addCheck("FAIL", "hook forwarder script missing", "scripts/hook-forwarder.js was not found");
  }

  const packageJson = readPackageJson();
  if (packageJson) {
    addCheck("OK", "package.json readable", "package.json parsed successfully");
  } else {
    addCheck("FAIL", "package.json unreadable", "Could not parse package.json");
  }

  const scripts = packageJson?.scripts || {};
  if (scripts["hook:forward"] === "node scripts/hook-forwarder.js") {
    addCheck("OK", "hook:forward script configured", scripts["hook:forward"]);
  } else {
    addCheck("FAIL", "hook:forward script missing or unexpected", "Expected: node scripts/hook-forwarder.js");
  }

  if (scripts["hook:doctor"] === "node scripts/hook-doctor.js") {
    addCheck("OK", "hook:doctor script configured", scripts["hook:doctor"]);
  } else {
    addCheck("FAIL", "hook:doctor script missing or unexpected", "Expected: node scripts/hook-doctor.js");
  }

  const portOpen = await checkTcpPort(eventHost, eventPort);
  if (portOpen) {
    addCheck("OK", "pet event server is listening", `${eventHost}:${eventPort}`);
  } else {
    addCheck("WARN", "pet event server is not listening", `Start the app before hooks: npm run start (${eventHost}:${eventPort})`);
  }

  printReport();
  process.exit(hasFailure ? 1 : 0);
}

main().catch(() => process.exit(1));
