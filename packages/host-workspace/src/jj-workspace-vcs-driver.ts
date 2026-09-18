import type { WorkspaceStatus } from "@bb/domain";
import {
  getPullRequestForCurrentBranch,
  runPullRequestActionForCurrentBranch,
  type GitHostCliOptions,
  type GitHostPullRequestLookup,
} from "./git-host.js";
import {
  detectGitRepo,
  WorkspaceError,
  type GitProcessOptions,
} from "./git.js";
import { detectJjRepository, readJjCurrentBookmark, runJj } from "./jj.js";
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
import { withCheckoutMutationLock } from "./checkout-mutation-lock.js";

const JJ_TIMEOUT_MS = 15_000;
const JJ_COMMIT_TEMPLATE =
  '"{" ++ "\\"commitId\\":" ++ json(commit_id) ++ ",\\"description\\":" ++ json(description) ++ ",\\"empty\\":" ++ json(empty) ++ "}\\n"';

interface JjCommit {
  commitId: string;
  description: string;
  empty: boolean;
}

export class JjWorkspaceVcsDriver implements WorkspaceVcsDriver {
  readonly kind = "jj";
  readonly isRepository = true;
  readonly isGitRepository: boolean;
  readonly isWorktree = false;

  private readonly path: string;
  private readonly workspace: Workspace;
  private readonly processOptions: GitProcessOptions;

  constructor(options: {
    path: string;
    isGitRepository: boolean;
    shellPath?: string;
  }) {
    this.path = options.path;
    this.isGitRepository = options.isGitRepository;
    this.processOptions = {
      ...(options.shellPath === undefined
        ? {}
        : { shellPath: options.shellPath }),
    };
    this.workspace = new Workspace(options.path, this.processOptions);
  }

  private run(args: string[]) {
    return runJj(args, {
      cwd: this.path,
      timeoutMs: JJ_TIMEOUT_MS,
      ...this.processOptions,
    });
  }

  private async readCommit(revision = "@"): Promise<JjCommit> {
    const result = await this.run([
      "log",
      "--no-graph",
      "-r",
      revision,
      "-T",
      JJ_COMMIT_TEMPLATE,
    ]);
    try {
      const value: unknown = JSON.parse(result.stdout.trim());
      if (
        typeof value === "object" &&
        value !== null &&
        "commitId" in value &&
        typeof value.commitId === "string" &&
        "description" in value &&
        typeof value.description === "string" &&
        "empty" in value &&
        typeof value.empty === "boolean"
      ) {
        return {
          commitId: value.commitId,
          description: value.description,
          empty: value.empty,
        };
      }
    } catch {}
    throw new WorkspaceError(
      "jj_command_failed",
      "Jujutsu returned invalid commit metadata",
    );
  }

  async getDefaultBranch(): Promise<string | null> {
    return this.workspace
      .getStatus()
      .then((status) => status.branch.defaultBranch);
  }

  async getCurrentBranch(): Promise<string | null> {
    return readJjCurrentBookmark(this.path, this.processOptions);
  }

  async getHeadSha(): Promise<string | null> {
    return (await this.readCommit()).commitId;
  }

  async getLocalStateFingerprint(): Promise<string> {
    const commit = await this.readCommit();
    const diff = await this.run(["diff", "-r", "@", "--summary"]);
    return JSON.stringify({ commit, diff: diff.stdout });
  }

  async getSharedRefsFingerprint(): Promise<string> {
    return (
      await this.run([
        "bookmark",
        "list",
        "--all-remotes",
        "-T",
        'json(self) ++ "\\n"',
      ])
    ).stdout;
  }

  getAdditionalWorkspaceWriteRoots(): Promise<string[]> {
    return Promise.resolve([]);
  }

  async getStatus(options?: StatusOptions): Promise<WorkspaceStatus> {
    const headSha = (await this.readCommit()).commitId;
    const [status, currentBranch] = await Promise.all([
      this.workspace.getStatus(options),
      this.getCurrentBranch(),
    ]);
    return {
      ...status,
      vcsKind: "jj",
      branch: { ...status.branch, currentBranch },
      checkout: currentBranch
        ? { kind: "branch", branchName: currentBranch, headSha }
        : { kind: "detached", headSha },
    };
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

  async getPullRequest(
    options: GitHostCliOptions = {},
  ): Promise<GitHostPullRequestLookup> {
    const localBranch = await this.getCurrentBranch();
    if (!localBranch) {
      return { outcome: "none" };
    }
    return getPullRequestForCurrentBranch({
      cwd: this.path,
      localBranch,
      ...this.processOptions,
      ...options,
    });
  }

  async runPullRequestAction(
    action: PullRequestActionOptions,
    options: GitHostCliOptions = {},
  ): Promise<void> {
    const localBranch = await this.getCurrentBranch();
    if (!localBranch) {
      throw new WorkspaceError(
        "invalid_request",
        "Cannot update pull request without a Jujutsu bookmark",
      );
    }
    return runPullRequestActionForCurrentBranch({
      cwd: this.path,
      localBranch,
      action,
      ...this.processOptions,
      ...options,
    });
  }

  async commit(options: CommitOptions): Promise<CommitResult> {
    return withCheckoutMutationLock(
      this.path,
      async () => {
        const commit = await this.readCommit();
        if (commit.empty) {
          throw new WorkspaceError("no_changes", "No changes to commit");
        }
        await this.run(["describe", "-r", "@", "-m", options.message]);
        const described = await this.readCommit();
        await this.run(["new"]);
        return {
          commitSha: described.commitId,
          commitSubject: described.description.trim().split("\n")[0] ?? "",
        };
      },
      undefined,
      this.processOptions,
    );
  }
}

export const jjWorkspaceVcsDriverProvider: WorkspaceVcsDriverProvider = {
  kind: "jj",
  async open(options) {
    const processOptions =
      options.shellPath === undefined ? {} : { shellPath: options.shellPath };
    if (!(await detectJjRepository(options.path, processOptions))) {
      return null;
    }
    const isGitRepository = await detectGitRepo(options.path, processOptions);
    if (!isGitRepository) {
      return null;
    }
    return new JjWorkspaceVcsDriver({
      path: options.path,
      isGitRepository,
      ...processOptions,
    });
  },
};
