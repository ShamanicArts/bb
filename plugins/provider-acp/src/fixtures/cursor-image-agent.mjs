import { createInterface } from "node:readline";
import updates from "./cursor-image-reads.json" with { type: "json" };
const sessionId = "recorded-cursor-image-fixture";
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    send({ id: request.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
  } else if (request.method === "session/new") {
    send({ id: request.id, result: { sessionId } });
  } else if (request.method === "session/prompt") {
    for (const update of updates) {
      send({ method: "session/update", params: { sessionId, update } });
    }
    send({ id: request.id, result: { stopReason: "end_turn" } });
  } else if (request.id !== undefined) {
    send({ id: request.id, error: { code: -32601, message: "Unsupported fixture request" } });
  }
}
