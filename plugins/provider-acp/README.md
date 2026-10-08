# ACP providers

First-party plugin for ACP (Agent Client Protocol) agent providers: Cursor,
opencode, omp, Grok Build and Hermes Agent.

OpenCode Go usage appears under OpenCode in the Provider usage panel for the
selected machine. It reads the official Go endpoint using the machine's OpenCode
Console account or API credentials and reports the five-hour, weekly, and monthly
windows with their reset times. Sign in to Go in OpenCode on that machine.
The same data is available through `bb settings usage --machine <id> --json`
and `bb.sdk.system.usageLimits({ hostId, providerId: "acp-opencode" })`.
Other OpenCode providers and pay-as-you-go spending are not included.

The plugin has no bridge of its own. Every agent it registers runs on the
published ACP kit, `@get-bb/plugin-sdk/provider-bridge/acp`, which its
`bb.host` entry creates (`src/host.ts`). That is the whole
point of the kit: a third-party plugin adds an ACP agent exactly the way this
one does, with no bb-side code. The plugin is forkable
(`docs/forkable-plugins.md`): its lint rule and the fork check prove it takes
no shortcut — no file here may import a workspace package.

What lives here:

- `server.ts` — the plugin's runtime: it reconciles one registration per
  agent, from the shipped list (`src/known-agents.ts`) plus whatever the
  `customAgents` setting and the deprecated `customAcpAgents` config array
  declare.
- `src/agents.ts` — the agent definition and the setting's schema, built out
  of the kit's own launch-spec schema so what the setting accepts is exactly
  what the bridge parses. The setting itself is a multi-line JSON field
  (`experimental_multiline`) whose description stays at two sentences; the
  field reference — required and optional fields, the replacement rule for a
  shipped agent's id, the `acp-<id>` provider id — is the "Custom ACP Agents"
  chapter of `docs/configuration.md`.
- `src/configured-agents.ts` — merging the setting and the deprecated config
  array, with the setting winning on a shared id.
- `src/declaration.ts` — one agent definition becomes one
  `bb.providers.register` declaration: ids, display names, icons,
  capabilities, and the bridge options it launches with (`acpLaunchSpec`, and
  `acpDialect` for the agents whose vendor side channels the kit reads).
- `src/legacy-config.ts` — reading the deprecated config array. Dies with the
  deprecation window.
- `src/host.ts` — the `bb.host` artifact, two surfaces in one file: the kit's
  bridge, with per-instance tool classification, and a host entry whose one RPC asks an agent what it
  supports on the machine it is installed on (`src/contract.ts`,
  `src/probe-capabilities.ts`).
- `icons/` — the provider logos, declared in `package.json` under
  `bb.branding.experimental_icons` so the packaged build ships them.

The kit itself, including the ACP wire schema, the delta translation, the
per-agent dialects and the bridge process, is `packages/provider-bridge-acp`.

Cursor PNG/JPEG reads use the plugin-owned `provider-acp/image-read` timeline
extension. The bridge classifies the initial request once and retains ACP's
reported status. Cursor 2026.09.18-9a7762b omits the result for both image reads
and missing-file reads, so the row says “Cursor did not report a read result.”
A completed row previews the requested path using the public workspace file
SDK; unavailable files show “Image preview unavailable.” This does not certify
that Cursor successfully viewed the image. Ordinary text reads, ambiguous
paths and reported failed/cancelled operations retain their normal behavior.
Recognition is limited to the observed Cursor dialect and PNG/JPEG extensions.

This build requires the experimental per-bridge classifier factory in the local
SDK extension. The hook is ACP-general; image policy and rendering live here.
It adds no shared timeline or assembler changes. This changes the existing
bundled provider-acp plugin: its id is reserved, so a generic local-path install
cannot shadow it. Build its existing package with
`pnpm exec turbo run prepare:bundled --filter=bb-plugin-provider-acp` and carry
that package into the maintained custom runtime's bundled-plugin location.
Use `bb plugin reload provider-acp` after the artifact update. Coordinate that
update around active Cursor sessions; reloading does not retroactively convert
ordinary fileRead history or replace a running bridge's code.
Disabling the plugin removes its renderer; retained extension rows still show
BB's declarative presentation. Re-enabling/reloading restores their preview.

`src/fixtures/cursor-image-reads.json` preserves actual installed Cursor ACP
updates, with only the probe root replaced by `/workspace`. It contains pending,
in-progress and terminal image, text and missing-file reads, including the
omitted image/error results. The replay test drives these through the public
SDK bridge and assembler. Live UI acceptance requires a running installed
architecture and cannot be inferred from those fixtures alone.

The plugin's test config stays self-contained because it is forkable: the
repository-only shared-worker helper cannot be imported by a standalone copy.
Its ordinary Node fixtures share workers; DOM, host lifecycle and bridge stdout
capture tests run in isolated workers using Vitest's public project options.
