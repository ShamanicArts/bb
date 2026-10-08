import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { experimental_createAcpProviderBridge } from "@get-bb/plugin-sdk/provider-bridge/acp";
import {
  experimental_assembleCapturedThreadEvents,
  experimental_createBridgeJsonRpcTestHarness,
} from "@get-bb/plugin-sdk/provider-bridge/testing";
import { classifyCursorImageRead } from "./image-read.js";

const execution = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
};

describe("captured Cursor updates through the public ACP bridge", () => {
  it("emits stable plugin extensions, normal text reads and unconfirmed missing-file reads", async () => {
    const bridge = experimental_createAcpProviderBridge({
      experimental_classifyToolCall: classifyCursorImageRead,
    });
    const capture = experimental_createBridgeJsonRpcTestHarness(
      bridge.handleLine,
    );
    try {
      capture.sendRequest(1, "thread/start", {
        threadId: "captured-cursor-images",
        cwd: fileURLToPath(new URL("./fixtures", import.meta.url)),
        instructionMode: "append",
        options: {
          ...execution,
          providerOptions: {
            acpDialect: "cursor",
            acpLaunchSpec: {
              displayName: "Recorded Cursor fixture",
              command: process.execPath,
              args: [
                fileURLToPath(
                  new URL("./fixtures/cursor-image-agent.mjs", import.meta.url),
                ),
              ],
              env: {},
            },
          },
        },
      });
      const response = await capture.waitForResponse(1);
      expect(response.error).toBeUndefined();
      const { providerThreadId } = z
        .object({ providerThreadId: z.string() })
        .parse(response.result);
      capture.sendRequest(2, "turn/start", {
        threadId: "captured-cursor-images",
        providerThreadId,
        clientRequestId: "creq_abcdefghjk",
        options: execution,
        input: [
          { type: "text", text: "replay recorded updates", mentions: [] },
        ],
      });
      expect((await capture.waitForResponse(2)).error).toBeUndefined();
      await expect
        .poll(() =>
          experimental_assembleCapturedThreadEvents(
            capture.messages,
            "acp-cursor",
          ).some((event) => event.type === "turn/completed"),
        )
        .toBe(true);
      const events = experimental_assembleCapturedThreadEvents(
        capture.messages,
        "acp-cursor",
      );
      const completed = events.flatMap((event) =>
        event.type === "item/completed" ? [event.item] : [],
      );
      const opened = events.flatMap((event) =>
        event.type === "item/started" ? [event.item] : [],
      );
      expect(completed.map((item) => item.type)).toEqual([
        "fileRead",
        "extension",
        "extension",
      ]);
      for (const path of ["/workspace/sample.png", "/workspace/absent.png"]) {
        const item = completed.find(
          (item) =>
            item.type === "extension" &&
            item.payload !== null &&
            typeof item.payload === "object" &&
            !Array.isArray(item.payload) &&
            item.payload.path === path,
        );
        expect(item).toMatchObject({
          type: "extension",
          kind: "provider-acp/image-read",
          status: "completed",
          presentation: { detail: "Cursor did not report a read result." },
        });
        expect(opened.find((started) => started.id === item?.id)?.type).toBe(
          "extension",
        );
      }
      expect(completed[0]).toMatchObject({
        type: "fileRead",
        path: "/workspace/ordinary.txt",
      });
    } finally {
      bridge.onClose?.();
      capture.restore();
    }
  });
});
