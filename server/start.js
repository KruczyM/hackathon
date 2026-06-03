import { loadEnv } from "./lib/loadEnv.js";

loadEnv();
await import("./index.js");

