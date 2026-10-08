// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  PluginBrowserBbSdk,
  PluginTimelineRendererProps,
} from "@get-bb/plugin-sdk/app";

const app = await loadPluginApp(() => import("./app.js"));
const registration = app.timelineRenderers[0]!;
const props: PluginTimelineRendererProps = {
  row: {
    id: "image-1",
    threadId: "thread-1",
    turnId: "turn-1",
    kind: "provider-acp/image-read",
    toolName: null,
    status: "completed",
    startedAt: 1,
    completedAt: 2,
  },
  thread: { id: "thread-1", providerId: "acp-cursor" },
  payload: { path: "sample.png" },
  presentation: null,
  Original: () => <div>Cursor did not report a read result.</div>,
};
const get = vi.fn<PluginBrowserBbSdk["threads"]["get"]>(
  async () =>
    ({
      environment: {
        id: "environment-1",
        hostId: "host-1",
        path: "/workspace",
      },
    }) as Awaited<ReturnType<PluginBrowserBbSdk["threads"]["get"]>>,
);
const file = {
  path: "/workspace/sample.png",
  content: "iVBORw0KGgo=",
  contentEncoding: "base64" as const,
  mimeType: "image/png",
  sizeBytes: 8,
  sha256: "fixture",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Cursor image timeline renderer lifecycle", () => {
  it("loads through the workspace file SDK and opens the existing file preview", async () => {
    const read = vi.fn<PluginBrowserBbSdk["files"]["read"]>(async () => file);
    const view = renderSlot(registration, props, {
      pluginId: "provider-acp",
      sdk: { threads: { get }, files: { read } },
    });
    const image = await view.findByAltText("sample.png");
    expect(image.getAttribute("src")).toBe(
      "data:image/png;base64,iVBORw0KGgo=",
    );
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        hostId: "host-1",
        rootPath: "/workspace",
        path: "sample.png",
      }),
    );
    expect(view.getByText("Cursor did not report a read result.")).toBeTruthy();
    fireEvent.click(view.getByRole("link"));
    expect(view.inspection.navigateCalls).toContainEqual(
      expect.objectContaining({
        method: "experimental_openFilePreview",
        options: expect.objectContaining({
          target: {
            kind: "workspace",
            environmentId: "environment-1",
            path: "sample.png",
          },
        }),
      }),
    );
  });

  it.each(["pending", "error", "interrupted"] as const)(
    "does not load an image for a %s read",
    (status) => {
      const view = renderSlot(
        registration,
        { ...props, row: { ...props.row, status } },
        { pluginId: "provider-acp", sdk: { threads: { get } } },
      );
      expect(view.queryByRole("img")).toBeNull();
      expect(get).not.toHaveBeenCalled();
    },
  );

  it("keeps missing images unavailable and ordinary provider rows inert", async () => {
    const read = vi.fn<PluginBrowserBbSdk["files"]["read"]>(async () => {
      throw new Error("File not found");
    });
    const missing = renderSlot(registration, props, {
      pluginId: "provider-acp",
      sdk: { threads: { get }, files: { read } },
    });
    expect(await missing.findByRole("status")).toHaveProperty(
      "textContent",
      "Image preview unavailable.",
    );
    expect(missing.queryByRole("img")).toBeNull();
    missing.unmount();
    get.mockClear();
    const other = renderSlot(
      registration,
      { ...props, thread: { ...props.thread, providerId: "acp-grok" } },
      { pluginId: "provider-acp", sdk: { threads: { get } } },
    );
    expect(other.queryByRole("img")).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("handles a non-image response and decode failure through the unavailable preview", async () => {
    const text = renderSlot(registration, props, {
      pluginId: "provider-acp",
      sdk: {
        threads: { get },
        files: {
          read: async () => ({
            ...file,
            contentEncoding: "utf8",
            mimeType: "text/plain",
          }),
        },
      },
    });
    expect(await text.findByRole("status")).toHaveProperty(
      "textContent",
      "Image preview unavailable.",
    );
    text.unmount();
    const valid = renderSlot(registration, props, {
      pluginId: "provider-acp",
      sdk: { threads: { get }, files: { read: async () => file } },
    });
    fireEvent.error(await valid.findByRole("img"));
    expect(await valid.findByRole("status")).toHaveProperty(
      "textContent",
      "Image preview unavailable.",
    );
  });

  it("does not publish a late image after the row path changes", async () => {
    let finish!: (result: typeof file) => void;
    let oldSignal: AbortSignal | undefined;
    const pending = new Promise<typeof file>((resolve) => {
      finish = resolve;
    });
    const view = renderSlot(registration, props, {
      pluginId: "provider-acp",
      sdk: {
        threads: { get },
        files: {
          read: (args) => {
            if (args.path === "sample.png") {
              oldSignal = args.signal;
              return pending;
            }
            return Promise.resolve({
              ...file,
              content: "current",
              mimeType: "image/jpeg",
            });
          },
        },
      },
    });
    await waitFor(() => expect(oldSignal).toBeDefined());
    const Renderer = registration.component;
    view.rerender(<Renderer {...props} payload={{ path: "other.jpg" }} />);
    expect(oldSignal?.aborted).toBe(true);
    const current = await view.findByAltText("other.jpg");
    await act(async () => finish({ ...file, content: "stale" }));
    expect(current.getAttribute("src")).toBe("data:image/jpeg;base64,current");
    expect(view.queryByAltText("sample.png")).toBeNull();
  });

  it("aborts outstanding reads on disable and reloads a fresh renderer without stale results", async () => {
    let finish!: (result: typeof file) => void;
    let signal: AbortSignal | undefined;
    const pending = new Promise<typeof file>((resolve) => {
      finish = resolve;
    });
    const first = renderSlot(registration, props, {
      pluginId: "provider-acp",
      sdk: {
        threads: { get },
        files: {
          read: (args) => {
            signal = args.signal;
            return pending;
          },
        },
      },
    });
    await waitFor(() => expect(signal).toBeDefined());
    first.unmount();
    expect(signal?.aborted).toBe(true);
    const reloaded = await loadPluginApp(() => import("./app.js"));
    expect(reloaded.timelineRenderers).toHaveLength(1);
    const second = renderSlot(reloaded.timelineRenderers[0]!, props, {
      pluginId: "provider-acp",
      sdk: { threads: { get }, files: { read: async () => file } },
    });
    await second.findByRole("img");
    await act(async () => finish({ ...file, content: "stale" }));
    expect(second.getByRole("img").getAttribute("src")).not.toContain("stale");
  });
});
