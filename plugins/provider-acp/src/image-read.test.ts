import { z } from "zod";
import { describe, expect, it } from "vitest";
import type { AcpToolCallUpdateEvent } from "@get-bb/plugin-sdk/provider-bridge/acp";
import { classifyCursorImageRead } from "./image-read.js";
import updates from "./fixtures/cursor-image-reads.json" with { type: "json" };

const context = { dialectId: "cursor", cwd: "/workspace" };
const image: AcpToolCallUpdateEvent = {
  sessionUpdate: "tool_call",
  toolCallId: "image-1",
  kind: "read",
  status: "pending",
  rawInput: { path: "sample.png" },
  locations: [{ path: "/workspace/sample.png" }],
};

describe("Cursor requested-image classification", () => {
  it("recognizes the captured successful and missing image requests without inventing outcomes", () => {
    const classified = updates
      .filter((event) => event.sessionUpdate === "tool_call")
      .map((event) =>
        classifyCursorImageRead(
          {
            ...event,
            sessionUpdate: "tool_call",
            kind: z.literal("read").parse(event.kind),
            status: z.literal("pending").parse(event.status),
          },
          context,
        ),
      );
    expect(classified.map((result) => result?.item.type)).toEqual([
      "extension",
      undefined,
      "extension",
    ]);
    expect(classified[0]).toMatchObject({
      item: {
        kind: "provider-acp/image-read",
        payload: { path: "/workspace/sample.png" },
      },
      presentation: {
        label: { completed: "Read image" },
        detail: "Cursor did not report a read result.",
      },
    });
  });

  it.each([".png", ".PNG", ".jpg", ".jpeg"])(
    "supports observed PNG/JPEG images %s",
    (suffix) => {
      expect(
        classifyCursorImageRead(
          { ...image, locations: [], rawInput: { path: `sample${suffix}` } },
          context,
        )?.item.type,
      ).toBe("extension");
    },
  );

  it.each(["acp", "generic", "grok", "opencode", "omp"])(
    "leaves %s behavior unchanged",
    (dialectId) => {
      expect(
        classifyCursorImageRead(image, { ...context, dialectId }),
      ).toBeUndefined();
    },
  );

  it.each(["failed", "cancelled"] as const)(
    "does not preview a reported %s read",
    (status) => {
      expect(
        classifyCursorImageRead({ ...image, status }, context),
      ).toBeUndefined();
    },
  );

  it.each([
    { locations: [], rawInput: {} },
    {
      locations: [{ path: "sample.png" }, { path: "other.png" }],
      rawInput: {},
    },
    { locations: [{ path: "sample.png" }], rawInput: { path: "other.png" } },
    { locations: [], rawInput: { path: "sample.png", filePath: "other.png" } },
    { locations: [{ path: "sample.png" }], rawInput: { path: 42 } },
    { locations: [{ path: "" }], rawInput: { path: "sample.png" } },
    { locations: [], rawInput: { path: "\0sample.png" } },
    { locations: [], rawInput: { path: "ordinary.txt" } },
    { locations: [], rawInput: { path: "unobserved.gif" } },
    { kind: "edit" as const },
    { rawOutput: { content: "Error reading file" } },
    { rawOutput: { success: false } },
    {
      content: [
        {
          type: "content" as const,
          content: { type: "text", text: "ordinary text" },
        },
      ],
    },
  ])(
    "retains the normal classification for missing, ambiguous, text or reported results %#",
    (override) => {
      expect(
        classifyCursorImageRead({ ...image, ...override }, context),
      ).toBeUndefined();
    },
  );

  it.each(["path", "filePath", "file_path", "target_file"])(
    "accepts a single supported %s path",
    (key) => {
      expect(
        classifyCursorImageRead(
          { ...image, locations: [], rawInput: { [key]: "sample.png" } },
          context,
        )?.item,
      ).toMatchObject({ payload: { path: "sample.png" } });
    },
  );

  it("retains home-relative paths for the existing host resolver", () => {
    expect(
      classifyCursorImageRead(
        { ...image, locations: [], rawInput: { path: "~/sample.png" } },
        context,
      )?.item,
    ).toMatchObject({ payload: { path: "~/sample.png" } });
  });
});
