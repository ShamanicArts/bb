import { describe, expect, it, vi } from "vitest";
import {
  createAcpDeltaTranslator,
  type AcpToolClassifier,
} from "./delta-translation.js";
import { resolveAcpDialect } from "./dialect.js";
import {
  ACP_UPDATE_METHOD,
} from "./bridge-protocol.js";
import { createDeltaAssembler } from "@bb/provider-bridge-protocol/assembler";
import type { AcpToolCallUpdateEvent } from "./wire.js";
import type { AcpClassifiedToolCall } from "./tool-classification.js";

const presentation = {
  label: { pending: "Reading image", completed: "Read image" },
  icon: { glyph: "Eye" },
  detail: "Read outcome unconfirmed.",
};
const update: AcpToolCallUpdateEvent = {
  sessionUpdate: "tool_call",
  toolCallId: "image-1",
  kind: "read",
  status: "pending",
  rawInput: { path: "sample.png" },
  locations: [{ path: "sample.png" }],
};
const custom: AcpClassifiedToolCall = {
  item: {
    type: "extension",
    kind: "provider-acp/image-read",
    payload: { path: "/workspace/sample.png" },
  },
  presentation,
};

function harness(classifier?: AcpToolClassifier, dialectId = "cursor") {
  const translator = createAcpDeltaTranslator({
    cwd: "/workspace",
    dialect: resolveAcpDialect({ dialectId, command: "agent" }),
    experimental_classifyToolCall: classifier,
  });
  return (event: AcpToolCallUpdateEvent) =>
    translator.translateAcpEvent(
      {
        jsonrpc: "2.0",
        method: ACP_UPDATE_METHOD,
        params: { threadId: "thread-1", update: event },
      },
      { threadId: "thread-1" },
    );
}

describe("per-bridge ACP tool classification", () => {
  it("selects once before opening and retains the same extension through cumulative updates", () => {
    const classifier = vi.fn<AcpToolClassifier>(() => custom);
    const translate = harness(classifier);
    const opened = translate(update);
    const progress = translate({
      sessionUpdate: "tool_call_update",
      toolCallId: "image-1",
      status: "in_progress",
    });
    const closed = translate({
      sessionUpdate: "tool_call_update",
      toolCallId: "image-1",
      status: "completed",
    });
    expect(classifier).toHaveBeenCalledTimes(1);
    expect(classifier.mock.calls[0]).toEqual([
      update,
      { dialectId: "cursor", cwd: "/workspace" },
    ]);
    expect(opened.find((delta) => delta.kind === "item.open")).toMatchObject({
      item: custom.item,
      presentation,
    });
    expect(closed).toMatchObject([
      {
        kind: "item.close",
        status: "completed",
        item: custom.item,
        presentation,
      },
    ]);
    const assembler = createDeltaAssembler({
      providerId: "acp-cursor",
      entropyPrefix: "test",
      textDeltaFlushMs: 0,
    });
    assembler.assemble({
      threadId: "thread-1",
      deltas: [{ kind: "turn.open" }],
    });
    const events = assembler.assemble({
      threadId: "thread-1",
      deltas: [...opened, ...progress, ...closed],
    });
    const terminal = events.filter((event) => event.type === "item/completed");
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({
      item: {
        type: "extension",
        kind: "provider-acp/image-read",
        status: "completed",
      },
    });
  });

  it.each(["generic", "cursor", "grok"])(
    "preserves %s classification when the hook returns undefined",
    (dialectId) => {
      const classifier = vi.fn<AcpToolClassifier>(() => undefined);
      const unchanged = harness(undefined, dialectId);
      const hooked = harness(classifier, dialectId);
      for (const event of [
        update,
        {
          ...update,
          sessionUpdate: "tool_call_update",
          status: "completed",
        } satisfies AcpToolCallUpdateEvent,
      ]) {
        expect(hooked(event)).toEqual(unchanged(event));
      }
      expect(classifier).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["throw", "invalid"])(
    "isolates a %s hook failure and falls back once",
    (failure) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const classifier = vi.fn<AcpToolClassifier>(() => {
          if (failure === "throw") throw new Error("broken plugin");
          return {
            ...custom,
            presentation: { ...presentation, icon: { glyph: "" } },
          };
        });
        const translate = harness(classifier);
        expect(
          translate(update).find((delta) => delta.kind === "item.open"),
        ).toMatchObject({
          item: { type: "fileRead", path: "/workspace/sample.png" },
        });
        expect(
          translate({
            ...update,
            sessionUpdate: "tool_call_update",
            status: "completed",
          }),
        ).toMatchObject([{ kind: "item.close", item: { type: "fileRead" } }]);
        expect(classifier).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledTimes(1);
      } finally {
        warn.mockRestore();
      }
    },
  );

  it("isolates raw snapshots and returned classifications from plugin mutation", () => {
    const result = structuredClone(custom);
    const translate = harness((event) => {
      if (event.locations?.[0]) event.locations[0].path = "changed.png";
      return result;
    });
    translate(update);
    expect(update.locations?.[0]?.path).toBe("sample.png");
    result.presentation.label.completed = "Changed";
    expect(
      translate({
        ...update,
        sessionUpdate: "tool_call_update",
        status: "completed",
      })[0],
    ).toMatchObject({ presentation });
  });

  it.each([
    ["failed", "failed"],
    ["cancelled", "interrupted"],
  ] as const)("preserves provider %s status", (status, mapped) => {
    const translate = harness(() => custom);
    translate(update);
    expect(
      translate({ ...update, sessionUpdate: "tool_call_update", status })[0],
    ).toMatchObject({ kind: "item.close", status: mapped, item: custom.item });
  });

  it("isolates classifications between translators with identical thread/tool IDs", () => {
    const first = harness(() => custom);
    const second = harness();
    expect(
      first(update).find((delta) => delta.kind === "item.open"),
    ).toMatchObject({ item: { type: "extension" } });
    expect(
      second(update).find((delta) => delta.kind === "item.open"),
    ).toMatchObject({ item: { type: "fileRead" } });
  });
});
