/**
 * Protocolo stdio hermético: handshake, tools/list e um error path que passa
 * no zod mas falha no service (sem credenciais → isError, sem rede).
 * Nunca toca na API — cobertura live fica em live.test.ts.
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIST = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/index.js",
);

const EXPECTED_TOOLS = [
  "search_products",
  "get_product",
  "get_item",
  "get_items",
  "get_seller_items",
  "get_own_items",
];

function send(child: ReturnType<typeof spawn>, obj: unknown): void {
  child.stdin!.write(JSON.stringify(obj) + "\n");
}

describe("stdio protocol", () => {
  it("handshake + tools/list + error path", async () => {
    const child = spawn("node", [DIST], {
      stdio: ["pipe", "pipe", "pipe"],
      // Sem ML_*: tools falham com isError sem sair do processo.
      env: { ...process.env, ML_CLIENT_ID: "", ML_CLIENT_SECRET: "", ML_REFRESH_TOKEN: "" },
    });
    const responses = new Map<number, Record<string, unknown>>();
    let stdout = "";
    const done = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timeout esperando respostas stdio")),
        30_000,
      );
      child.stdout!.on("data", (d: Buffer) => {
        stdout += d.toString();
        for (const line of stdout.split("\n")) {
          try {
            const msg = JSON.parse(line) as Record<string, unknown>;
            if (typeof msg.id === "number" && !responses.has(msg.id)) {
              responses.set(msg.id, msg);
              if (responses.has(1) && responses.has(2) && responses.has(3)) {
                clearTimeout(timer);
                resolve();
              }
            }
          } catch {
            /* linha parcial */
          }
        }
      });
      child.on("error", reject);
    });

    send(child, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    });
    send(child, { jsonrpc: "2.0", method: "notifications/initialized" });
    send(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    // Passa no zod (string válida), falha no service (sem credenciais).
    send(child, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "search_products", arguments: { q: "camiseta" } },
    });

    await done;
    child.kill("SIGKILL");

    const list = responses.get(2)!.result as {
      tools: { name: string }[];
    };
    expect(list.tools.map((t) => t.name).sort()).toEqual(
      [...EXPECTED_TOOLS].sort(),
    );
    const errCall = responses.get(3)!.result as {
      isError: boolean;
      content: { text: string }[];
    };
    expect(errCall.isError).toBe(true);
    expect(errCall.content[0].text).toMatch(/Error:/);
  }, 40_000);
});
