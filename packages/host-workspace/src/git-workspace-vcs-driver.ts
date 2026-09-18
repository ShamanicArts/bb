import type { WorkspaceStatus } from "@bb/domain";
import type {
  GitHostCliOptions,
  GitHostPullRequestLookup,
} from "./git-host.js";
import {
  detectGitRepo,
  detectLinkedWorktree,
  readDefaultBranch,
  type GitProcessOptions,
} from "./git.js";
import type {
  CommitOptions,
  CommitResult,
  DiffFilesArgs,
  DiffFilesResult,
  DiffOptions,
  DiffPatchArgs,
  DiffPatchEntry,
  DiffResult,
  PullRequestActionOptions,
  StatusOptions,
} from "./workspace.js";
import { Workspace } from "./workspace.js";
import type {
  WorkspaceVcsDriver,
  WorkspaceVcsDriverProvider,
} from "./workspace-vcs-driver.js";
import { resolveAdditionalWorkspaceWriteRoots } from "./workspace-write-roots.js";

const WORKSPACE_BRANCH_GIT_TIMEOUT_MS = 15_000;

export class GitWorkspaceVcsDriver implements WorkspaceVcsDriver {
  readonly kind = "git";
  readonly isRepository: boolean;
  readonly isWorktree: boolean;

  private readonly path: string;
  private readonly workspace: Workspace;
  private readonly processOptions: GitProcessOptions;

  constructor(options: {
    path: string;
    isRepository: boolean;
    isWorktree: boolean;
    shellPath?: string;
  }) {
    this.path = options.path;
    this.isRepository = options.isRepository;
    this.isWorktree = options.isWorktree;
    this.processOptions = {
      ...(options.shellPath === undefined
        ? {}
        : { shellPath: options.shellPath }),
    };
    this.workspace = new Workspace(options.path, this.processOptions);
  }

  async getDefaultBranch(): Promise<string | null> {
    if (!this.isRepository) {
      return null;
    }
    return (
      (await readDefaultBranch(this.path, {
        timeoutMs: WORKSPACE_BRANCH_GIT_TIMEOUT_MS,
        ...this.processOptions,
      })) ?? null
    );
  }

  async getCurrentBranch(): Promise<string | null> {
    return (await this.workspace.currentBranch) ?? null;
  }

  getHeadSha(): Promise<string | null> {
    return this.workspace.getHeadSha();
  }

  getLocalStateFingerprint(): Promise<string> {
    return this.workspace.getLocalStateFingerprint();
  }

  getSharedRefsFingerprint(): Promise<string> {
    return this.workspace.getSharedGitRefsFingerprint();
  }

  getAdditionalWorkspaceWriteRoots(): Promise<string[]> {
    if (!this.isRepository || !this.isWorktree) {
      return Promise.resolve([]);
    }
    return resolveAdditionalWorkspaceWriteRoots(this.path, this.processOptions);
  }

  getStatus(options?: StatusOptions): Promise<WorkspaceStatus> {
    return this.workspace.getStatus(options);
  }

  getDiff(options?: DiffOptions): Promise<DiffResult> {
    return this.workspace.getDiff(options);
  }

  diffFiles(args: DiffFilesArgs): Promise<DiffFilesResult> {
    return this.workspace.diffFiles(args);
  }

  diffPatch(args: DiffPatchArgs): Promise<DiffPatchEntry[]> {
    return this.workspace.diffPatch(args);
  }

  getPullRequest(
    options?: GitHostCliOptions,
  ): Promise<GitHostPullRequestLookup> {
    return this.workspace.getPullRequest(options);
  }

  runPullRequestAction(
    action: PullRequestActionOptions,
    options?: GitHostCliOptions,
  ): Promise<void> {
    return this.workspace.runPullRequestAction(action, options);
  }

  commit(options: CommitOptions): Promise<CommitResult> {
    return this.workspace.commit(options);
  }
}

export const gitWorkspaceVcsDriverProvider: WorkspaceVcsDriverProvider = {
  kind: "git",
  async open(options) {
    const processOptions = {
      ...(options.shellPath === undefined
        ? {}
        : { shellPath: options.shellPath }),
    };
    const isRepository = await detectGitRepo(options.path, processOptions);
    if (!isRepository) {
      return null;
    }
    const isWorktree = await detectLinkedWorktree(options.path, processOptions);
    return new GitWorkspaceVcsDriver({
      path: options.path,
      isRepository: true,
      isWorktree,
      ...processOptions,
    });
  },
};
