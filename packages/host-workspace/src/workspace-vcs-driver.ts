import type { WorkspaceStatus } from "@bb/domain";
import type {
  GitHostCliOptions,
  GitHostPullRequestLookup,
} from "./git-host.js";
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

export interface WorkspaceVcsDriver {
  readonly kind: string;
  readonly isRepository: boolean;
  readonly isWorktree: boolean;

  getDefaultBranch(): Promise<string | null>;
  getCurrentBranch(): Promise<string | null>;
  getHeadSha(): Promise<string | null>;
  getLocalStateFingerprint(): Promise<string>;
  getSharedRefsFingerprint(): Promise<string>;
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

export interface WorkspaceVcsDriverOpenOptions {
  readonly path: string;
  readonly shellPath?: string;
  readonly signal?: AbortSignal;
}

export interface WorkspaceVcsDriverProvider {
  readonly kind: string;
  open(
    options: WorkspaceVcsDriverOpenOptions,
  ): Promise<WorkspaceVcsDriver | null>;
}
