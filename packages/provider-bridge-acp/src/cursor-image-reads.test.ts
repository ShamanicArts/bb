import { describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import { createDeltaAssembler } from "@bb/provider-bridge-protocol/assembler";
import { createAcpDeltaTranslator } from "./delta-translation.js";
import { resolveAcpDialect } from "./dialect.js";
import {
  ACP_TURN_STARTED_METHOD,
  ACP_UPDATE_METHOD,
} from "./bridge-protocol.js";
import updates from "./fixtures/cursor-image-reads.json" with { type: "json" };

function harness(dialectId = "cursor") {
  const threadId = "cursor-image-read";
  const translator = createAcpDeltaTranslator({
    cwd: "/workspace",
    dialect: resolveAcpDialect({ dialectId, command: "node" }),
  });
  const assembler = createDeltaAssembler({
    providerId: "acp-cursor",
    entropyPrefix: "cursor-image",
    textDeltaFlushMs: 0,
  });
  function translate(method: string, params: Record<string, unknown>) {
    return assembler.assemble({
      threadId,
      deltas: translator.translateAcpEvent(
        { jsonrpc: "2.0", method, params },
        { threadId },
      ),
    });
  }
  translate(ACP_TURN_STARTED_METHOD, { threadId });
  return (update: Record<string, unknown>) =>
    translate(ACP_UPDATE_METHOD, { threadId, update });
}

function completedItems(events: ThreadEvent[]) {
  return events.flatMap((event) =>
    event.type === "item/completed" ? [event.item] : [],
  );
}

describe("Cursor image reads from installed 2026.09.18-9a7762b ACP", () => {
  it("previews the requested image after completion while retaining its item id and omitted result", () => {
    const translate = harness();
    const events = updates.flatMap((update) => translate(update));
    const started = events.find(
      (event) =>
        event.type === "item/started" &&
        event.item.type === "fileRead" &&
        event.item.path === "/workspace/sample.png",
    );
    expect(started?.type).toBe("item/started");
    const image = completedItems(events).find(
      (item) =>
        item.type === "imageView" && item.path === "/workspace/sample.png",
    );
    expect(image).toMatchObject({
      id: started?.type === "item/started" ? started.item.id : undefined,
      type: "imageView",
      presentation: {
        label: { completed: "Read image" },
        detail: "Cursor did not report a read result.",
      },
    });
    expect(
      completedItems(events).filter((item) => item.id === image?.id),
    ).toHaveLength(1);
    expect(
      completedItems(events).some(
        (item) =>
          item.type === "fileRead" && item.path === "/workspace/ordinary.txt",
      ),
    ).toBe(true);
    expect(
      completedItems(events).find(
        (item) =>
          item.type === "imageView" && item.path === "/workspace/absent.png",
      ),
    ).toMatchObject({
      presentation: { detail: "Cursor did not report a read result." },
    });
  });

  it.each(["failed", "cancelled"])(
    "keeps an explicit %s image read as fileRead",
    (status) => {
      const translate = harness();
      translate({
        sessionUpdate: "tool_call",
        toolCallId: "read",
        kind: "read",
        status: "pending",
        locations: [{ path: "/workspace/sample.png" }],
      });
      const items = completedItems(
        translate({
          sessionUpdate: "tool_call_update",
          toolCallId: "read",
          status,
        }),
      );
      expect(items).toMatchObject([
        {
          type: "fileRead",
          status: status === "cancelled" ? "interrupted" : status,
        },
      ]);
    },
  );

  it.each([
    { label: "missing path", locations: [], rawInput: {} },
    {
      label: "multiple locations",
      locations: [{ path: "a.png" }, { path: "b.png" }],
    },
    {
      label: "conflicting input",
      locations: [{ path: "a.png" }],
      rawInput: { path: "b.png" },
    },
    {
      label: "conflicting aliases",
      rawInput: { path: "a.png", filePath: "b.png" },
    },
    {
      label: "text named as image",
      rawInput: { path: "a.png" },
      rawOutput: { content: "ordinary text" },
    },
    {
      label: "reported error",
      rawInput: { path: "a.png" },
      rawOutput: { error: "File not found" },
    },
    {
      label: "reported text content",
      rawInput: { path: "a.png" },
      content: [
        { type: "content", content: { type: "text", text: "File not found" } },
      ],
    },
    {
      label: "malformed input",
      locations: [{ path: "a.png" }],
      rawInput: { path: 123 },
    },
    { label: "ordinary text", rawInput: { path: "notes.txt" } },
    { label: "title-only path", title: "Read `a.png`" },
  ])("does not preview $label", ({ label: _label, ...fields }) => {
    const translate = harness();
    const items = completedItems(
      translate({
        sessionUpdate: "tool_call",
        toolCallId: "read",
        kind: "read",
        status: "completed",
        ...fields,
      }),
    );
    expect(items.some((item) => item.type === "imageView")).toBe(false);
  });

  it.each(["acp", "opencode", "grok", "omp"])(
    "preserves %s dialect reads",
    (dialectId) => {
      const translate = harness(dialectId);
      const items = completedItems(
        updates.flatMap((update) => translate(update)),
      );
      expect(items.some((item) => item.type === "imageView")).toBe(false);
    },
  );

  it.each(["path", "filePath", "file_path", "target_file"])(
    "resolves a relative JPEG %s with the existing resolver",
    (key) => {
      const translate = harness();
      expect(
        completedItems(
          translate({
            sessionUpdate: "tool_call",
            toolCallId: "read",
            kind: "read",
            status: "completed",
            rawInput: { [key]: "shots/frame.JPEG" },
          }),
        ),
      ).toMatchObject([
        { type: "imageView", path: "/workspace/shots/frame.JPEG" },
      ]);
    },
  );

  it("accepts duplicate locations and matching relative input without previewing early", () => {
    const translate = harness();
    const started = translate({
      sessionUpdate: "tool_call",
      toolCallId: "read",
      kind: "read",
      status: "pending",
      locations: [{ path: "/workspace/a.jpg" }, { path: "/workspace/a.jpg" }],
      rawInput: { path: "a.jpg" },
    });
    expect(
      started.some(
        (event) =>
          event.type === "item/started" && event.item.type === "imageView",
      ),
    ).toBe(false);
    expect(
      translate({
        sessionUpdate: "tool_call_update",
        toolCallId: "read",
        status: "in_progress",
      }).some((event) => event.type === "item/completed"),
    ).toBe(false);
    expect(
      completedItems(
        translate({
          sessionUpdate: "tool_call_update",
          toolCallId: "read",
          status: "completed",
        }),
      ).some((item) => item.type === "imageView"),
    ).toBe(true);
  });
});
