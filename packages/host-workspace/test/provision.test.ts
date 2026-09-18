import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  provisionWorkspace,
  type WorkspaceVcsDriver,
  type WorkspaceVcsDriverProvider,
} from "../src/index.js";
import { listBranches, runGit } from "../src/git.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function initRepo(): Promise<string> {
  const repoPath = await makeTempDir("bb-provision-repo-");
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  await runGit(["add", "."], { cwd: repoPath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: repoPath });
  return repoPath;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("provisionWorkspace", () => {
  describe("unmanaged", () => {
    it("provisions an unmanaged git repo and discovers properties", async () => {
      const repoPath = await initRepo();

      const ws = await provisionWorkspace({
        path: repoPath,
      });

      expect(ws.path).toBe(repoPath);
      expect(ws.isGitRepo).toBe(true);
      expect(ws.isWorktree).toBe(false);
      expect(await ws.getCurrentBranch()).toBe("main");
    });

    it("provisions an unmanaged non-git directory", async () => {
      const dirPath = await makeTempDir("bb-provision-nongit-");

      const ws = await provisionWorkspace({
        path: dirPath,
      });

      expect(ws.isGitRepo).toBe(false);
      expect(ws.isWorktree).toBe(false);
    });

    it("detects a worktree as isWorktree=true", async () => {
      const repoPath = await initRepo();
      const parentDir = await makeTempDir("bb-provision-wt-parent-");
      const wtPath = path.join(parentDir, "wt");
      await runGit(["worktree", "add", "-B", "feature", wtPath], {
        cwd: repoPath,
      });

      const ws = await provisionWorkspace({
        path: wtPath,
      });

      expect(ws.isGitRepo).toBe(true);
      expect(ws.isWorktree).toBe(true);
    });

    it("resolves external git metadata roots for unmanaged worktrees", async () => {
      const repoPath = await initRepo();
      const parentDir = await makeTempDir("bb-provision-unmanaged-wt-roots-");
      const wtPath = path.join(parentDir, "wt");
      await runGit(["worktree", "add", "-B", "feature", wtPath], {
        cwd: repoPath,
      });
      const ws = await provisionWorkspace({
        path: wtPath,
      });
      const gitDir = (
        await runGit(["rev-parse", "--absolute-git-dir"], { cwd: ws.path })
      ).stdout.trim();
      const commonGitDir = path.resolve(
        ws.path,
        (
          await runGit(["rev-parse", "--git-common-dir"], { cwd: ws.path })
        ).stdout.trim(),
      );

      await expect(ws.getAdditionalWorkspaceWriteRoots()).resolves.toEqual([
        path.resolve(gitDir),
        path.join(commonGitDir, "objects"),
        path.join(commonGitDir, "refs"),
        path.join(commonGitDir, "logs"),
      ]);
    });

    it("throws for non-existent path", async () => {
      await expect(
        provisionWorkspace({
          path: "/tmp/does-not-exist-bb",
        }),
      ).rejects.toThrow(/does not exist/u);
    });

    it("selects a supplied VCS driver before the built-in Git driver", async () => {
      const repoPath = await initRepo();
      const gitWorkspace = await provisionWorkspace({ path: repoPath });
      const customDriver: WorkspaceVcsDriver = {
        kind: "custom",
        isRepository: true,
        isGitRepository: false,
        isWorktree: false,
        getDefaultBranch: () => Promise.resolve("custom-trunk"),
        getCurrentBranch: () => Promise.resolve("custom-change"),
        getHeadSha: () => gitWorkspace.getHeadSha(),
        getLocalStateFingerprint: () => gitWorkspace.getLocalStateFingerprint(),
        getSharedRefsFingerprint: () =>
          gitWorkspace.getSharedGitRefsFingerprint(),
        getAdditionalWorkspaceWriteRoots: () => Promise.resolve([]),
        getStatus: (options) => gitWorkspace.getStatus(options),
        getDiff: (options) => gitWorkspace.getDiff(options),
        diffFiles: (args) => gitWorkspace.diffFiles(args),
        diffPatch: (args) => gitWorkspace.diffPatch(args),
        getPullRequest: (options) => gitWorkspace.getPullRequest(options),
        runPullRequestAction: (action, options) =>
          gitWorkspace.runPullRequestAction(action, options),
        commit: (options) => gitWorkspace.commit(options),
      };
      const customProvider: WorkspaceVcsDriverProvider = {
        kind: "custom",
        open: () => Promise.resolve(customDriver),
      };

      const workspace = await provisionWorkspace({
        path: repoPath,
        additionalVcsDrivers: [customProvider],
      });

      expect(workspace.isGitRepo).toBe(false);
      expect(await workspace.getCurrentBranch()).toBe("custom-change");
      expect(await workspace.getDefaultBranch()).toBe("custom-trunk");
    });
  });

  describe("HostWorkspace git operations", () => {
    it("delegates git operations to the underlying Workspace", async () => {
      const repoPath = await initRepo();
      const ws = await provisionWorkspace({
        path: repoPath,
      });

      const status = await ws.getStatus();
      expect(status.workingTree.state).toBe("clean");

      await fs.writeFile(path.join(repoPath, "new.txt"), "data\n", "utf8");
      const result = await ws.commit({
        message: "Test commit",
        noVerify: false,
      });
      expect(result.commitSha).toBeTruthy();

      const branches = await listBranches(ws.path);
      expect(branches).toContain("main");

      const diff = await ws.getDiff();
      expect(typeof diff.diff).toBe("string");
    });
  });
});
