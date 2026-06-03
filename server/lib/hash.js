import crypto from "node:crypto";

export function stableHash(input) {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 16);
}
