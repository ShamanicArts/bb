import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { provisionWorkspace } from "../src/index.js";
import { runGit } from "../src/git.js";
import { runJj } from "../src/jj.js";

const hasJj = spawnSync("jj", ["--version"], { encoding: "utf8" }).status === 0;
const tempDirs: string[] = [];

async function initColocatedRepo(): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "bb-jj-repo-"));
  tempDirs.push(repoPath);
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await runGit(["config", "user.name", "BB Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "bb@example.com"], { cwd: repoPath });
  await fs.writeFile(path.join(repoPath, "README.md"), "hello\n", "utf8");
  await runGit(["add", "."], { cwd: repoPath });
  await runGit(["commit", "-m", "Initial commit"], { cwd: repoPath });
  await runJj(["git", "init", "--colocate", "."], { cwd: repoPath });
  await runJj(["bookmark", "set", "feature", "-r", "@"], {
    cwd: repoPath,
  });
  return repoPath;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe.runIf(hasJj)("JjWorkspaceVcsDriver", () => {
  it("selects JJ and commits the working-copy change", async () => {
    const repoPath = await initColocatedRepo();
    const workspace = await provisionWorkspace({ path: repoPath });

    expect(workspace.isGitRepo).toBe(true);
    expect(await workspace.getCurrentBranch()).toBe("feature");

    await fs.writeFile(path.join(repoPath, "README.md"), "hello jj\n", "utf8");

    const status = await workspace.getStatus();
    expect(status.branch.currentBranch).toBe("feature");
    expect(status.workingTree.hasUncommittedChanges).toBe(true);
    expect(status.workingTree.files).toEqual([
      expect.objectContaining({ path: "README.md", status: "M" }),
    ]);

    const diff = await workspace.getDiff();
    expect(diff.diff).toContain("+hello jj");

    const result = await workspace.commit({
      message: "Describe JJ change",
      noVerify: false,
    });

    expect(result.commitSubject).toBe("Describe JJ change");
    expect(result.commitSha).toMatch(/^[0-9a-f]{40,64}$/u);
    expect(await workspace.getCurrentBranch()).toBe("feature");
    expect(
      (await workspace.getStatus()).workingTree.hasUncommittedChanges,
    ).toBe(false);
    expect(
      (
        await runJj(["log", "--no-graph", "-r", "@-", "-T", "description"], {
          cwd: repoPath,
        })
      ).stdout.trim(),
    ).toBe("Describe JJ change");
  });
});
