import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRadar } from "./agents/orchestrator.js";
import { resetMemory } from "./agents/memoryAgent.js";
import { resetGrowthHistory } from "./agents/companyGrowthAgent.js";
import { resetCompanyCache } from "./agents/companyCacheAgent.js";
import { getPrefetchStatus, runPrefetchNow, startPrefetchScheduler } from "./jobs/prefetchJob.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const app = express();
const port = Number.parseInt(process.env.PORT, 10) || 8787;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "novapolis-lead-radar", time: new Date().toISOString() });
});

app.get("/api/radar", async (request, response) => {
  try {
    const result = await runRadar(request.query);
    response.json(result);
  } catch (error) {
    response.status(500).json({
      error: "Radar run failed",
      message: error.message
    });
  }
});

app.post("/api/memory/reset", async (_request, response) => {
  await resetMemory();
  await resetGrowthHistory();
  response.json({ ok: true });
});

app.get("/api/prefetch/status", async (_request, response) => {
  response.json(await getPrefetchStatus());
});

app.post("/api/prefetch/run", async (request, response) => {
  response.json(await runPrefetchNow({ force: request.query.force === "true" }));
});

app.post("/api/cache/reset", async (_request, response) => {
  await resetCompanyCache();
  response.json({ ok: true });
});

app.use(express.static(distDir));
app.use((request, response, next) => {
  if (request.method !== "GET" || request.path.startsWith("/api")) {
    next();
    return;
  }
  response.sendFile(path.join(distDir, "index.html"));
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Novapolis Lead Radar API listening on http://127.0.0.1:${port}`);
  startPrefetchScheduler();
});
