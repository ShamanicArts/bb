import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    silent: "passed-only",
    projects: [
      {
        extends: true,
        test: {
          name: "bb-plugin-provider-acp",
          include: ["src/**/*.test.ts"],
          exclude: ["node_modules/**", "src/image-read-bridge.test.ts"],
          isolate: false,
        },
      },
      {
        extends: true,
        test: {
          name: "bb-plugin-provider-acp:isolated",
          include: [
            "server.test.ts",
            "app.test.tsx",
            "src/image-read-bridge.test.ts",
          ],
          exclude: ["node_modules/**"],
        },
      },
    ],
  },
});
