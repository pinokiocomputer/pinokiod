#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const sourcePath = process.argv[2];
const expectedSessionId = process.argv[3];

if (!sourcePath) {
  process.exit(1);
}

let payload;
try {
  const raw = fs.readFileSync(sourcePath, "utf8");
  payload = JSON.parse(raw);
} catch (error) {
  process.exit(1);
}

if (!payload || typeof payload !== "object") {
  process.exit(1);
}

const sourceSessionId = typeof payload.sessionId === "string"
  ? payload.sessionId
  : (typeof payload.session_id === "string" ? payload.session_id : "");

if (!sourceSessionId) {
  process.exit(1);
}

if (expectedSessionId && sourceSessionId !== expectedSessionId) {
  process.exit(1);
}

if (!Array.isArray(payload.messages)) {
  process.exit(1);
}

const newSessionId = typeof crypto.randomUUID === "function"
  ? crypto.randomUUID()
  : [
      Date.now().toString(16),
      Math.random().toString(16).slice(2),
      Math.random().toString(16).slice(2)
    ].join("-");

const nowIso = new Date().toISOString();
payload.sessionId = newSessionId;
if (typeof payload.session_id === "string") {
  payload.session_id = newSessionId;
}
if (typeof payload.startTime === "string") {
  payload.startTime = nowIso;
}
if (typeof payload.lastUpdated === "string") {
  payload.lastUpdated = nowIso;
}

const stamp = nowIso.replace(/[:.]/g, "-");
const filename = "session-" + stamp + "-" + newSessionId.slice(0, 8) + ".json";
const targetPath = path.join(path.dirname(path.resolve(sourcePath)), filename);
fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), "utf8");
process.stdout.write(newSessionId);
