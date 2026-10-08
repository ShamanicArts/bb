import os from "node:os";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import {
  experimental_createAcpProviderBridge,
  experimental_probeAcpAgent,
} from "@get-bb/plugin-sdk/provider-bridge/acp";
import { acpHostContract } from "./contract.js";
import { resolveAcpNativeRoots } from "./native-roots/index.js";

import { classifyCursorImageRead } from "./image-read.js";

export const experimental_providerBridge = experimental_createAcpProviderBridge(
  {
    experimental_classifyToolCall: classifyCursorImageRead,
  },
);

export default experimental_defineHostEntry({
  contract: acpHostContract,
  handlers: {
    probeAgent: async (input, context) =>
      experimental_probeAcpAgent({
        command: input.command,
        args: input.args,
        env: input.env,
        cwd: context.experimental_paths.tempDir,
      }),
    resolveNativeRoots: (input) =>
      resolveAcpNativeRoots({
        agentId: input.providerId,
        cwd: input.cwd,
        homeDir: os.homedir(),
        env: process.env,
      }),
  },
});
