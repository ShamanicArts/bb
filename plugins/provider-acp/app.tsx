import { useEffect, useState } from "react";
import {
  definePluginApp,
  experimental_FileLink as FileLink,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import type {
  PluginTimelineRendererProps,
  ExperimentalLiveFileTarget,
} from "@get-bb/plugin-sdk/app";
import { cursorImageReadPayloadSchema } from "./src/image-read-payload.js";

function CursorImagePreview({
  path,
  threadId,
}: {
  path: string;
  threadId: string;
}) {
  const sdk = useSdk();
  const [preview, setPreview] = useState<{
    src: string;
    target: ExperimentalLiveFileTarget;
  } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await sdk.threads.get({
          threadId,
          include: "environment,host",
          signal: controller.signal,
        });
        const environment = "environment" in result ? result.environment : null;
        const host = "host" in result ? result.host : null;
        const hostId = environment?.hostId ?? host?.id;
        if (!hostId) throw new Error("Image host unavailable");
        const file = await sdk.files.read({
          hostId,
          rootPath: environment?.path ?? undefined,
          path,
          signal: controller.signal,
        });
        if (
          file.contentEncoding !== "base64" ||
          !["image/png", "image/jpeg"].includes(file.mimeType ?? "")
        ) {
          throw new Error("Image preview unavailable");
        }
        if (controller.signal.aborted) return;
        setPreview({
          src: `data:${file.mimeType};base64,${file.content}`,
          target: environment
            ? { kind: "workspace", environmentId: environment.id, path }
            : { kind: "host", hostId, path },
        });
      } catch {
        if (!controller.signal.aborted) setUnavailable(true);
      }
    })();
    return () => controller.abort();
  }, [path, sdk, threadId]);
  return (
    <>
      {preview && (
        <FileLink target={preview.target} aria-label={`Open ${path}`}>
          <img
            src={preview.src}
            alt={path}
            onError={() => {
              setPreview(null);
              setUnavailable(true);
            }}
            style={{
              display: "block",
              maxWidth: "100%",
              maxHeight: 384,
              objectFit: "contain",
              borderRadius: "var(--radius)",
            }}
          />
        </FileLink>
      )}
      {unavailable && <div role="status">Image preview unavailable.</div>}
    </>
  );
}

function CursorImageRead({
  row,
  payload,
  thread,
  Original,
}: PluginTimelineRendererProps) {
  const parsed = cursorImageReadPayloadSchema.safeParse(payload);
  const path = parsed.success ? parsed.data.path : undefined;
  return (
    <>
      <Original />
      {thread.providerId === "acp-cursor" &&
        row.status === "completed" &&
        path !== undefined && (
          <CursorImagePreview
            key={JSON.stringify([thread.id, path])}
            path={path}
            threadId={thread.id}
          />
        )}
    </>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_timelineRenderer({
    kind: "provider-acp/image-read",
    component: CursorImageRead,
  });
});
