import type { ProvisioningTranscriptEntry, WorkspaceStatus } from "@bb/domain";
import { pathExists } from "@bb/process-utils";
import {
  GitWorkspaceVcsDriver,
  gitWorkspaceVcsDriverProvider,
} from "./git-workspace-vcs-driver.js";
import { jjWorkspaceVcsDriverProvider } from "./jj-workspace-vcs-driver.js";
import type {
  CommitOptions,
  CommitResult,
  DiffOptions,
  DiffResult,
  DiffFilesArgs,
  DiffFilesResult,
  DiffPatchArgs,
  DiffPatchEntry,
  PullRequestActionOptions,
  StatusOptions,
} from "./workspace.js";
import type {
  GitHostCliOptions,
  GitHostPullRequestLookup,
} from "./git-host.js";
import { WorkspaceError } from "./git.js";
import type {
  WorkspaceVcsDriver,
  WorkspaceVcsDriverProvider,
} from "./workspace-vcs-driver.js";

type ProvisionProgressCallback = (entry: ProvisioningTranscriptEntry) => void;

function createProvisionCancelledError(cause?: unknown): WorkspaceError {
  return new WorkspaceError(
    "provision_cancelled",
    "Workspace provisioning was cancelled",
    { cause },
  );
}

export function throwIfProvisionAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createProvisionCancelledError(signal.reason);
  }
}

interface ProvisionBase {
  onProgress?: ProvisionProgressCallback;
  shellPath?: string;
  signal?: AbortSignal;
}

interface UnmanagedWorkspaceOpts extends ProvisionBase {
  path: string;
  additionalVcsDrivers?: readonly WorkspaceVcsDriverProvider[];
}

export type ProvisionWorkspaceArgs = UnmanagedWorkspaceOpts;

export interface HostWorkspace {
  readonly path: string;
  readonly isGitRepo: boolean;
  readonly isWorktree: boolean;

  getDefaultBranch(): Promise<string | null>;
  getCurrentBranch(): Promise<string | null>;
  getHeadSha(): Promise<string | null>;
  getLocalStateFingerprint(): Promise<string>;
  getSharedGitRefsFingerprint(): Promise<string>;
  getAdditionalWorkspaceWriteRoots(): Promise<string[]>;
  getStatus(options?: StatusOptions): Promise<WorkspaceStatus>;
  getDiff(options?: DiffOptions): Promise<DiffResult>;
  diffFiles(args: DiffFilesArgs): Promise<DiffFilesResult>;
  diffPatch(args: DiffPatchArgs): Promise<DiffPatchEntry[]>;
  getPullRequest(
    options?: GitHostCliOptions,
  ): Promise<GitHostPullRequestLookup>;
  runPullRequestAction(
    action: PullRequestActionOptions,
    options?: GitHostCliOptions,
  ): Promise<void>;

  commit(options: CommitOptions): Promise<CommitResult>;
}

class ProvisionedHostWorkspace implements HostWorkspace {
  readonly path: string;
  readonly isGitRepo: boolean;
  readonly isWorktree: boolean;

  private readonly vcs: WorkspaceVcsDriver;

  constructor(opts: { path: string; vcs: WorkspaceVcsDriver }) {
    this.path = opts.path;
    this.vcs = opts.vcs;
    this.isGitRepo = opts.vcs.isGitRepository;
    this.isWorktree = opts.vcs.isWorktree;
  }

  getCurrentBranch(): Promise<string | null> {
    return this.vcs.getCurrentBranch();
  }

  getDefaultBranch(): Promise<string | null> {
    return this.vcs.getDefaultBranch();
  }

  getHeadSha(): Promise<string | null> {
    return this.vcs.getHeadSha();
  }

  getLocalStateFingerprint(): Promise<string> {
    return this.vcs.getLocalStateFingerprint();
  }

  getSharedGitRefsFingerprint(): Promise<string> {
    return this.vcs.getSharedRefsFingerprint();
  }

  getAdditionalWorkspaceWriteRoots(): Promise<string[]> {
    return this.vcs.getAdditionalWorkspaceWriteRoots();
  }

  getStatus(options?: StatusOptions): Promise<WorkspaceStatus> {
    return this.vcs.getStatus(options);
  }

  getDiff(options?: DiffOptions): Promise<DiffResult> {
    return this.vcs.getDiff(options);
  }

  diffFiles(args: DiffFilesArgs): Promise<DiffFilesResult> {
    return this.vcs.diffFiles(args);
  }

  diffPatch(args: DiffPatchArgs): Promise<DiffPatchEntry[]> {
    return this.vcs.diffPatch(args);
  }

  getPullRequest(
    options?: GitHostCliOptions,
  ): Promise<GitHostPullRequestLookup> {
    return this.vcs.getPullRequest(options);
  }

  runPullRequestAction(
    action: PullRequestActionOptions,
    options?: GitHostCliOptions,
  ): Promise<void> {
    return this.vcs.runPullRequestAction(action, options);
  }

  commit(options: CommitOptions): Promise<CommitResult> {
    return this.vcs.commit(options);
  }
}

export function provisionWorkspace(
  opts: ProvisionWorkspaceArgs,
): Promise<HostWorkspace> {
  return provisionUnmanaged(opts);
}

async function provisionUnmanaged(
  opts: UnmanagedWorkspaceOpts,
): Promise<HostWorkspace> {
  throwIfProvisionAborted(opts.signal);
  if (!(await pathExists(opts.path))) {
    throw new WorkspaceError(
      "path_not_found",
      `Unmanaged workspace path does not exist: ${opts.path}`,
    );
  }
  const openOptions = {
    path: opts.path,
    ...(opts.shellPath === undefined ? {} : { shellPath: opts.shellPath }),
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  };
  let vcs: WorkspaceVcsDriver | null = null;
  for (const provider of [
    ...(opts.additionalVcsDrivers ?? []),
    jjWorkspaceVcsDriverProvider,
    gitWorkspaceVcsDriverProvider,
  ]) {
    vcs = await provider.open(openOptions);
    if (vcs !== null) {
      break;
    }
  }
  vcs ??= new GitWorkspaceVcsDriver({
    path: opts.path,
    isRepository: false,
    isWorktree: false,
    ...(opts.shellPath === undefined ? {} : { shellPath: opts.shellPath }),
  });

  return new ProvisionedHostWorkspace({
    path: opts.path,
    vcs,
  });
}
