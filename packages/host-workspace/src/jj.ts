import { execFile, type ExecFileException } from "node:child_process";
import { promisify } from "node:util";
import { sanitizeInheritedChildProcessEnv } from "@bb/process-utils";
import { WorkspaceError, type GitProcessOptions } from "./git.js";

const execFileAsync = promisify(execFile);

export interface JjCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunJjOptions extends GitProcessOptions {
  cwd: string;
  allowFailure?: boolean;
  timeoutMs?: number;
  maxBufferBytes?: number;
}

export async function runJj(
  args: string[],
  options: RunJjOptions,
): Promise<JjCommandResult> {
  const commandArgs = ["--no-pager", "--color", "never", ...args];
  try {
    const result = await execFileAsync("jj", commandArgs, {
      cwd: options.cwd,
      encoding: "utf8",
      env: sanitizeInheritedChildProcessEnv({
        env: process.env,
        ...(options.shellPath === undefined
          ? {}
          : { shellPath: options.shellPath }),
      }),
      maxBuffer: options.maxBufferBytes ?? 16 * 1024 * 1024,
      timeout: options.timeoutMs,
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const execError =
      error instanceof Error ? (error as ExecFileException) : null;
    const stdout =
      typeof execError?.stdout === "string" ? execError.stdout : "";
    const stderr =
      typeof execError?.stderr === "string" ? execError.stderr : "";
    const exitCode = typeof execError?.code === "number" ? execError.code : 1;
    if (options.allowFailure) {
      return { stdout, stderr, exitCode };
    }
    const detail = stderr.trim();
    throw new WorkspaceError(
      "jj_command_failed",
      `jj ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`,
      { cause: error },
    );
  }
}

export async function detectJjRepository(
  cwd: string,
  options: GitProcessOptions = {},
): Promise<boolean> {
  const result = await runJj(["root"], {
    cwd,
    ...options,
    allowFailure: true,
    timeoutMs: 5_000,
    maxBufferBytes: 8_192,
  });
  return result.exitCode === 0 && result.stdout.trim().length > 0;
}

export async function readJjCurrentBookmark(
  cwd: string,
  options: GitProcessOptions = {},
): Promise<string | null> {
  for (const revision of ["@", "@-"]) {
    const result = await runJj(
      ["bookmark", "list", "-r", revision, "-T", 'name ++ "\\n"'],
      { cwd, ...options, timeoutMs: 5_000, maxBufferBytes: 64 * 1024 },
    );
    const bookmark = result.stdout
      .split("\n")
      .map((value) => value.trim())
      .find((value) => value.length > 0);
    if (bookmark) return bookmark;
  }
  return null;
}
