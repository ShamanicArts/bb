import { basename, extname, normalize, resolve } from "node:path";
import type { AcpToolClassifier } from "@get-bb/plugin-sdk/provider-bridge/acp";
import { z } from "zod";
import { cursorImageReadPayloadSchema } from "./image-read-payload.js";

const inputPathsSchema = z
  .object({
    path: z.string().min(1).optional(),
    filePath: z.string().min(1).optional(),
    file_path: z.string().min(1).optional(),
    target_file: z.string().min(1).optional(),
  })
  .passthrough();

export const classifyCursorImageRead: AcpToolClassifier = (event, context) => {
  if (
    context.dialectId !== "cursor" ||
    event.kind !== "read" ||
    event.status === "failed" ||
    event.status === "cancelled" ||
    event.rawOutput !== undefined ||
    (event.content?.length ?? 0) > 0
  ) {
    return undefined;
  }
  const paths = (event.locations ?? []).map((location) => location.path);
  if (event.rawInput !== undefined) {
    const input = inputPathsSchema.safeParse(event.rawInput);
    if (!input.success) return undefined;
    for (const value of [
      input.data.path,
      input.data.filePath,
      input.data.file_path,
      input.data.target_file,
    ]) {
      if (value !== undefined) paths.push(value);
    }
  }
  if (
    paths.length === 0 ||
    paths.some((path) => path.trim().length === 0 || path.includes("\0"))
  ) {
    return undefined;
  }
  const canonical = paths.map((path) =>
    context.cwd && !path.startsWith("~")
      ? resolve(context.cwd, path)
      : normalize(path),
  );
  if (new Set(canonical).size !== 1) return undefined;
  const path = paths[0];
  if (
    path === undefined ||
    ![".png", ".jpg", ".jpeg"].includes(extname(path).toLowerCase())
  ) {
    return undefined;
  }
  return {
    item: {
      type: "extension",
      kind: "provider-acp/image-read",
      payload: cursorImageReadPayloadSchema.parse({ path }),
    },
    presentation: {
      label: { pending: "Reading image", completed: "Read image" },
      icon: { glyph: "Eye" },
      title: basename(path).slice(0, 160),
      detail: "Cursor did not report a read result.",
    },
  };
};
