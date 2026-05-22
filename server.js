import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4000;
const STATE_FILE = path.join(__dirname, "data", "state.json");

// ─── State ──────────────────────────────────────────────────────────────────
const defaultState = {
  hackers: [],          // [{ fullName, github? }, ...]
  stageIndex: null,     // index into hackers, or null
  timer: {
    state: "idle",      // "idle" | "running" | "stopped"
    endsAt: null,       // ISO string while running
    remainingSeconds: null, // integer while stopped/idle
  },
};

let state = structuredClone(defaultState);

async function loadState() {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    state = { ...defaultState, ...JSON.parse(raw) };
  } catch {
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
    await saveState();
  }
}

async function saveState() {
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── App ────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.static(__dirname));       // iframes/, assets/, logos at root
app.use("/admin", express.static(path.join(__dirname, "admin")));

// ─── Live API (shape mirrors the Platanus endpoint) ─────────────────────────
app.get("/api/live", (_req, res) => {
  const onStage = state.stageIndex != null ? state.hackers[state.stageIndex] : null;

  const presenting = onStage
    ? {
        project: { name: onStage.fullName, oneliner: null },
        team: {
          slug: `hacker-${state.stageIndex + 1}`,
          members: [{ fullName: onStage.fullName, github: onStage.github ?? null }],
        },
        track: null,
        mentor: null,
      }
    : null;

  res.json({
    event: { slug: "local" },
    stage: { slug: "main", name: "Main Stage" },
    presenting,
    timer: {
      ...state.timer,
      serverNow: new Date().toISOString(),
    },
  });
});

// ─── Admin endpoints ────────────────────────────────────────────────────────
app.get("/api/state", (_req, res) => res.json(state));

app.post("/api/hackers", async (req, res) => {
  const list = Array.isArray(req.body?.hackers) ? req.body.hackers : null;
  if (!list) return res.status(400).json({ error: "expected { hackers: [...] }" });
  state.hackers = list
    .map((h) => (typeof h === "string" ? { fullName: h } : h))
    .filter((h) => h.fullName);
  state.stageIndex = null;
  await saveState();
  res.json({ ok: true, count: state.hackers.length });
});

app.post("/api/stage", async (req, res) => {
  const idx = req.body?.index;
  if (idx === null || idx === undefined) {
    state.stageIndex = null;
  } else {
    const i = Number(idx);
    if (!Number.isInteger(i) || i < 0 || i >= state.hackers.length) {
      return res.status(400).json({ error: "invalid index" });
    }
    state.stageIndex = i;
  }
  await saveState();
  res.json({ ok: true, stageIndex: state.stageIndex });
});

app.post("/api/timer/start", async (req, res) => {
  const seconds = Number(req.body?.seconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return res.status(400).json({ error: "invalid seconds" });
  }
  state.timer = {
    state: "running",
    endsAt: new Date(Date.now() + seconds * 1000).toISOString(),
    remainingSeconds: null,
  };
  await saveState();
  res.json({ ok: true, timer: state.timer });
});

app.post("/api/timer/pause", async (_req, res) => {
  if (state.timer.state === "running" && state.timer.endsAt) {
    const remaining = Math.max(0, Math.round((new Date(state.timer.endsAt).getTime() - Date.now()) / 1000));
    state.timer = { state: "stopped", endsAt: null, remainingSeconds: remaining };
    await saveState();
  }
  res.json({ ok: true, timer: state.timer });
});

app.post("/api/timer/resume", async (_req, res) => {
  if (state.timer.state === "stopped" && state.timer.remainingSeconds != null) {
    state.timer = {
      state: "running",
      endsAt: new Date(Date.now() + state.timer.remainingSeconds * 1000).toISOString(),
      remainingSeconds: null,
    };
    await saveState();
  }
  res.json({ ok: true, timer: state.timer });
});

app.post("/api/timer/reset", async (_req, res) => {
  state.timer = { state: "idle", endsAt: null, remainingSeconds: null };
  await saveState();
  res.json({ ok: true, timer: state.timer });
});

// ─── Boot ───────────────────────────────────────────────────────────────────
await loadState();
app.listen(PORT, () => {
  console.log(`\n  Admin:    http://localhost:${PORT}/admin`);
  console.log(`  Iframes:  http://localhost:${PORT}/iframes/<name>.html`);
  console.log(`  Live API: http://localhost:${PORT}/api/live\n`);
});
