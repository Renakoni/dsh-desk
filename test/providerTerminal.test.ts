import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHARA_DESK_CLAUDE_ENV,
  PS_RESUME_CLAUDE,
  PS_RUN_CLAUDE,
  buildPowerShellLaunch,
  isFullyQualifiedWindowsPath,
  launchDetachedTerminal,
  launchFailedMessage,
  mergeTerminalEnv,
  normalizeCmdCwd,
  notAFolderMessage,
  providerTerminalEnv,
  resolveClaudeExecutable,
  resolveSessionCwd,
  sessionFolderUnavailableMessage,
  trustedCmdPath,
  trustedPowerShellPath,
  uncNotSupportedMessage
} from "../src/main/providerTerminal";

// A stand-in for child_process.spawn: returns an EventEmitter (plus unref) and fires
// the chosen event on the next microtask, after the launcher attaches its listeners.
type FakeSpawn = Parameters<typeof launchDetachedTerminal>[3];
function fakeSpawn(
  act: (child: EventEmitter & { unref(): void }) => void,
  capture?: (options: Record<string, unknown>) => void
): FakeSpawn {
  return ((_file: string, _args: string[], options: Record<string, unknown>) => {
    capture?.(options);
    const child = Object.assign(new EventEmitter(), { unref() {} });
    queueMicrotask(() => act(child));
    return child;
  }) as unknown as FakeSpawn;
}

const POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const CMD = "C:\\Windows\\System32\\cmd.exe";

// `cmd /c start` opens a real console window; on a headless CI runner (Session 0, no
// interactive desktop) the launched PowerShell doesn't reliably run in time, which makes
// these end-to-end tests flaky there. So they run LOCALLY only — the deterministic unit
// tests (buildPowerShellLaunch shape, normalizeCmdCwd, etc.) cover the same logic on CI.
const SKIP_WINDOW_SPAWN = process.platform !== "win32" || Boolean(process.env.CI);

// Poll until the marker has CONTENT (not just exists) — the launched PowerShell's `>`
// redirect creates the file before the command's output lands, so "exists" alone is too
// eager under load. Reads defensively (the file may be briefly locked mid-write). Used
// by the real Windows integration test; the shell launch is async.
function waitForFileContent(path: string, timeoutMs: number): Promise<string> {
  return new Promise(resolve => {
    const start = Date.now();
    const tick = () => {
      try {
        if (existsSync(path)) {
          const text = readFileSync(path, "utf16le").trim();
          if (text.length > 0) return resolve(text);
        }
      } catch { /* briefly locked mid-write; keep polling */ }
      if (Date.now() - start >= timeoutMs) return resolve("");
      setTimeout(tick, 150);
    };
    tick();
  });
}

describe("providerTerminalEnv", () => {
  it("keeps string and finite-number env entries and drops the rest", () => {
    expect(providerTerminalEnv({ env: { A: "x", B: 42, C: null, D: {}, E: true, F: NaN } })).toEqual({ A: "x", B: "42" });
  });
  it("never lets a provider replace PATH, regardless of key casing", () => {
    expect(providerTerminalEnv({ env: {
      Path: "C:\\attacker",
      PATH: "D:\\attacker",
      path: "E:\\attacker",
      ANTHROPIC_AUTH_TOKEN: "secret"
    } })).toEqual({ ANTHROPIC_AUTH_TOKEN: "secret" });
  });
  it("returns an empty map when env is missing or malformed", () => {
    expect(providerTerminalEnv({})).toEqual({});
    expect(providerTerminalEnv(null)).toEqual({});
    expect(providerTerminalEnv({ env: "nope" })).toEqual({});
  });
});

describe("mergeTerminalEnv", () => {
  it("layers the overlay over the inherited env, keeping credentials in env", () => {
    const env = mergeTerminalEnv(
      { ANTHROPIC_BASE_URL: "https://api.example.com", ANTHROPIC_AUTH_TOKEN: "sk-secret-token" },
      { PATH: "C:\\Windows", ANTHROPIC_BASE_URL: "https://default" }
    );
    expect(env.PATH).toBe("C:\\Windows");
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.example.com");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("sk-secret-token");
  });
  it("drops undefined base values", () => {
    expect(mergeTerminalEnv({}, { A: "x", B: undefined })).toEqual({ A: "x" });
  });
  it("overrides case-insensitively for trusted overlays", () => {
    const pathEnv = mergeTerminalEnv({ PATH: "C:\\provider" }, { Path: "C:\\Windows" });
    expect(Object.keys(pathEnv).filter(k => k.toLowerCase() === "path")).toEqual(["PATH"]);
    expect(pathEnv.PATH).toBe("C:\\provider");
    // A trusted child-only var wins over any case-variant a provider env might set.
    const guarded = mergeTerminalEnv({ CHARA_DESK_CLAUDE: "C:\\trusted\\claude.exe" }, { chara_desk_claude: "C:\\evil\\claude.exe" });
    expect(Object.keys(guarded).filter(k => k.toLowerCase() === "chara_desk_claude")).toEqual(["CHARA_DESK_CLAUDE"]);
    expect(guarded.CHARA_DESK_CLAUDE).toBe("C:\\trusted\\claude.exe");
  });
});

describe("isFullyQualifiedWindowsPath", () => {
  it("accepts drive-absolute and UNC paths", () => {
    expect(isFullyQualifiedWindowsPath("C:\\tools")).toBe(true);
    expect(isFullyQualifiedWindowsPath("c:/tools")).toBe(true);
    expect(isFullyQualifiedWindowsPath("\\\\server\\share")).toBe(true);
    expect(isFullyQualifiedWindowsPath("//server/share")).toBe(true);
  });
  it("rejects relative, drive-relative and drive-root-relative paths", () => {
    expect(isFullyQualifiedWindowsPath(".")).toBe(false);
    expect(isFullyQualifiedWindowsPath("tools")).toBe(false);
    expect(isFullyQualifiedWindowsPath(".\\bin")).toBe(false);
    expect(isFullyQualifiedWindowsPath("\\tools")).toBe(false); // drive-root-relative
    expect(isFullyQualifiedWindowsPath("C:tools")).toBe(false); // drive-relative
    expect(isFullyQualifiedWindowsPath("")).toBe(false);
  });
});

describe("trustedPowerShellPath", () => {
  it("resolves the System32 Windows PowerShell from SystemRoot only (never PATH/cwd)", () => {
    expect(trustedPowerShellPath({ SystemRoot: "C:\\Windows" }, p => p === POWERSHELL)).toBe(POWERSHELL);
    expect(trustedPowerShellPath({ systemroot: "D:\\Win" }, p => p === "D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"))
      .toBe("D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  });
  it("returns null when the trusted PowerShell is absent", () => {
    expect(trustedPowerShellPath({ SystemRoot: "C:\\Windows" }, () => false)).toBeNull();
  });
});

describe("trustedCmdPath", () => {
  it("resolves System32\\cmd.exe from SystemRoot only (never PATH/cwd)", () => {
    expect(trustedCmdPath({ SystemRoot: "C:\\Windows" }, p => p === CMD)).toBe(CMD);
    expect(trustedCmdPath({ systemroot: "D:\\Win" }, p => p === "D:\\Win\\System32\\cmd.exe"))
      .toBe("D:\\Win\\System32\\cmd.exe");
  });
  it("returns null when cmd.exe is absent", () => {
    expect(trustedCmdPath({ SystemRoot: "C:\\Windows" }, () => false)).toBeNull();
  });
});

describe("resolveClaudeExecutable", () => {
  it("resolves a fully-qualified claude.exe or claude.ps1 from PATH (never cwd), .exe first", () => {
    const both = (p: string) => p === "C:\\cli\\claude.exe" || p === "C:\\cli\\claude.ps1";
    expect(resolveClaudeExecutable({ PATH: "C:\\cli" }, both)).toEqual({ ok: true, path: "C:\\cli\\claude.exe" });
    expect(resolveClaudeExecutable({ PATH: "C:\\cli" }, p => p === "C:\\cli\\claude.ps1")).toEqual({ ok: true, path: "C:\\cli\\claude.ps1" });
  });
  it("never resolves a batch shim — reports batch-only so we don't delegate to cmd", () => {
    expect(resolveClaudeExecutable({ PATH: "C:\\cli" }, p => p === "C:\\cli\\claude.cmd")).toEqual({ ok: false, reason: "batch-only" });
    expect(resolveClaudeExecutable({ PATH: "C:\\cli" }, p => p === "C:\\cli\\claude.bat")).toEqual({ ok: false, reason: "batch-only" });
  });
  it("reports not-found when no claude entry point is on PATH", () => {
    expect(resolveClaudeExecutable({ PATH: "C:\\cli" }, () => false)).toEqual({ ok: false, reason: "not-found" });
    expect(resolveClaudeExecutable({}, () => true)).toEqual({ ok: false, reason: "not-found" });
  });
  it("a project-local claude can't shadow it — cwd is never searched", () => {
    const planted = "C:\\evil-project\\claude.exe";
    const real = "C:\\Program Files\\claude\\claude.exe";
    expect(resolveClaudeExecutable({ PATH: "C:\\Program Files\\claude" }, p => p === planted || p === real)).toEqual({ ok: true, path: real });
  });
  it("rejects relative, drive-relative and drive-root-relative PATH entries", () => {
    const always = () => true;
    expect(resolveClaudeExecutable({ PATH: "." }, always)).toEqual({ ok: false, reason: "not-found" });
    expect(resolveClaudeExecutable({ PATH: "tools" }, always)).toEqual({ ok: false, reason: "not-found" });
    expect(resolveClaudeExecutable({ PATH: ".\\bin" }, always)).toEqual({ ok: false, reason: "not-found" });
    expect(resolveClaudeExecutable({ PATH: "\\tools" }, always)).toEqual({ ok: false, reason: "not-found" }); // drive-root-relative
    expect(resolveClaudeExecutable({ PATH: "C:tools" }, always)).toEqual({ ok: false, reason: "not-found" }); // drive-relative
    // ...and an absolute entry alongside still resolves.
    expect(resolveClaudeExecutable({ PATH: ".;C:\\real" }, p => p === "C:\\real\\claude.exe")).toEqual({ ok: true, path: "C:\\real\\claude.exe" });
  });
});

describe("resolveSessionCwd", () => {
  it("uses home only when the session recorded no cwd", () => {
    expect(resolveSessionCwd(undefined, "C:\\home", () => true)).toEqual({ ok: true, cwd: "C:\\home" });
    expect(resolveSessionCwd("", "C:\\home", () => true)).toEqual({ ok: true, cwd: "C:\\home" });
  });
  it("returns the recorded cwd when available — local or UNC, since PowerShell can open both", () => {
    expect(resolveSessionCwd("C:\\project", "C:\\home", () => true)).toEqual({ ok: true, cwd: "C:\\project" });
    expect(resolveSessionCwd("\\\\server\\share\\proj", "C:\\home", () => true)).toEqual({ ok: true, cwd: "\\\\server\\share\\proj" });
  });
  it("fails (never silently uses home) for an unavailable recorded cwd, returning the path", () => {
    expect(resolveSessionCwd("C:\\gone", "C:\\home", () => false)).toEqual({ ok: false, path: "C:\\gone" });
    expect(resolveSessionCwd("\\\\server\\offline", "C:\\home", () => false)).toEqual({ ok: false, path: "\\\\server\\offline" });
  });
});

describe("normalizeCmdCwd", () => {
  it("keeps an ordinary local drive-absolute path unchanged", () => {
    expect(normalizeCmdCwd("C:\\Users\\me\\proj")).toEqual({ ok: true, cwd: "C:\\Users\\me\\proj" });
    expect(normalizeCmdCwd("E:\\project")).toEqual({ ok: true, cwd: "E:\\project" });
  });
  it("normalizes an extended-length local drive path by stripping \\\\?\\ (cmd can't use the prefix)", () => {
    expect(normalizeCmdCwd("\\\\?\\E:\\claude-plugins\\pet")).toEqual({ ok: true, cwd: "E:\\claude-plugins\\pet" });
    expect(normalizeCmdCwd("\\\\?\\C:\\Users\\me")).toEqual({ ok: true, cwd: "C:\\Users\\me" });
  });
  // The whole point: an existing-but-cmd-unsupported directory must NEVER pass through —
  // cmd would silently drop to C:\Windows and exit 0, launching the terminal in the wrong
  // folder while we report success. So every UNC form is rejected before we spawn.
  it("rejects a plain UNC path (backslash or forward-slash)", () => {
    expect(normalizeCmdCwd("\\\\localhost\\C$\\Users\\me")).toEqual({ ok: false });
    expect(normalizeCmdCwd("\\\\server\\share\\proj")).toEqual({ ok: false });
    expect(normalizeCmdCwd("//server/share/proj")).toEqual({ ok: false });
  });
  it("rejects an extended-length UNC path", () => {
    expect(normalizeCmdCwd("\\\\?\\UNC\\server\\share\\proj")).toEqual({ ok: false });
  });
});

describe("buildPowerShellLaunch", () => {
  it("opens a standalone PowerShell window via cmd /c start, with claude running inside PowerShell", () => {
    const launch = buildPowerShellLaunch(CMD, POWERSHELL, PS_RUN_CLAUDE, { CHARA_DESK_CLAUDE: "C:\\cli\\claude.exe" });
    expect(launch.file).toBe(CMD); // cmd is ONLY the launcher (`start` opens the window)
    expect(launch.args).toEqual(["/c", "start", "DSH Desk", POWERSHELL, "-NoExit", "-Command", "& $env:CHARA_DESK_CLAUDE"]);
    // The shell that actually runs the command is PowerShell — claude never runs in cmd.
    expect(launch.args[3]).toBe(POWERSHELL);
    expect(launch.args[launch.args.length - 1]).toBe("& $env:CHARA_DESK_CLAUDE");
  });
  it("keeps the user profile: -NoExit present, no -NoProfile / -NonInteractive / -ExecutionPolicy override", () => {
    const args = buildPowerShellLaunch(CMD, POWERSHELL, PS_RUN_CLAUDE, {}).args.join(" ").toLowerCase();
    expect(args).toContain("-noexit");
    expect(args).not.toContain("-noprofile");
    expect(args).not.toContain("-noninteractive");
    expect(args).not.toContain("-executionpolicy");
  });
  it("keeps provider secrets, the claude path and the session id in env only — never in argv", () => {
    const launch = buildPowerShellLaunch(CMD, POWERSHELL, PS_RESUME_CLAUDE, {
      CHARA_DESK_CLAUDE: "C:\\cli\\claude.exe",
      CHARA_DESK_RESUME_ID: "sess-123",
      ANTHROPIC_AUTH_TOKEN: "sk-secret-token",
      ANTHROPIC_BASE_URL: "https://api.example.com"
    });
    expect(launch.file).toBe(CMD);
    expect(launch.args[3]).toBe(POWERSHELL); // claude runs in PowerShell, not cmd
    expect(launch.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-secret-token");
    const argv = JSON.stringify(launch.args);
    expect(argv).not.toContain("sk-secret-token");
    expect(argv).not.toContain("https://api.example.com");
    expect(argv).not.toContain("claude.exe"); // the path rides in the env var
    expect(argv).not.toContain("sess-123"); // the id rides in the env var
    // the fixed resume command is still a pure env-ref — the id/path are not interpolated
    expect(launch.args[launch.args.length - 1]).toBe("& $env:CHARA_DESK_CLAUDE --resume $env:CHARA_DESK_RESUME_ID");
  });
});

describe("privacy-aware error messages", () => {
  it("includes the path normally but omits it when paths are hidden", () => {
    expect(notAFolderMessage("C:\\proj", false)).toContain("C:\\proj");
    expect(notAFolderMessage("C:\\proj", true)).not.toContain("C:\\proj");
    expect(sessionFolderUnavailableMessage("\\\\srv\\share", false)).toContain("srv");
    expect(sessionFolderUnavailableMessage("\\\\srv\\share", true)).not.toContain("srv");
    expect(launchFailedMessage("spawn C:\\proj ENOENT", false)).toContain("C:\\proj");
    expect(launchFailedMessage("spawn C:\\proj ENOENT", true)).not.toContain("C:\\proj");
    expect(uncNotSupportedMessage("\\\\srv\\share", false)).toContain("srv");
    expect(uncNotSupportedMessage("\\\\srv\\share", true)).not.toContain("srv");
  });
});

describe("launchDetachedTerminal", () => {
  it("resolves ok once the terminal spawns", async () => {
    const result = await launchDetachedTerminal(POWERSHELL, ["-NoExit"], {}, fakeSpawn(c => c.emit("spawn")));
    expect(result).toEqual({ ok: true });
  });
  it("returns { ok:false, error } on an async spawn failure (the provider + resume path)", async () => {
    const result = await launchDetachedTerminal(POWERSHELL, ["-NoExit"], {}, fakeSpawn(c => c.emit("error", new Error("spawn powershell ENOENT"))));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ENOENT");
  });
  it("spawns a detached launcher with ignored stdio and forwards cwd/env", async () => {
    let seen: Record<string, unknown> | undefined;
    await launchDetachedTerminal(CMD, ["/c", "start", "DSH Desk", POWERSHELL, "-NoExit"], { cwd: "C:\\proj", env: { ANTHROPIC_AUTH_TOKEN: "x" } }, fakeSpawn(c => c.emit("spawn"), o => { seen = o; }));
    // `start` gives the launched PowerShell its own console, so this short-lived cmd needs
    // no std handles — stdio "ignore" is correct (cmd just fires `start` and exits).
    expect(seen).toMatchObject({ cwd: "C:\\proj", env: { ANTHROPIC_AUTH_TOKEN: "x" }, detached: true, windowsHide: false, stdio: "ignore" });
  });
});

describe("PowerShell launch (real Windows execution)", () => {
  // Cold-starting real Windows PowerShell via spawnSync can exceed vitest's 5s default
  // on a loaded CI runner (issue #83). Give these real-execution probes generous
  // headroom — a per-test timeout, not a global one, so genuine hangs elsewhere still
  // surface. The window-spawn tests below already carry their own 15s/25s limits.
  const REAL_EXEC_TIMEOUT_MS = 30_000;

  it.skipIf(process.platform !== "win32")("runs the trusted claude via the fixed call-operator command even when its path has metacharacters", () => {
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const powershell = trustedPowerShellPath(process.env);
    expect(powershell).not.toBeNull();
    // A harmless system exe standing in for claude.exe, in a directory with spaces,
    // &, parentheses and a caret — the kind of path that breaks cmd quoting.
    const base = mkdtempSync(join(tmpdir(), "cdps-"));
    const dir = join(base, "probe & (meta)^ dir");
    mkdirSync(dir);
    const fakeClaude = join(dir, "claude.exe");
    copyFileSync(join(systemRoot, "System32", "hostname.exe"), fakeClaude);
    try {
      // Same env var + FIXED command the launcher uses; -NoProfile only to keep the
      // test fast (the product launcher intentionally loads the profile).
      const env = { ...process.env, [CHARA_DESK_CLAUDE_ENV]: fakeClaude };
      const result = spawnSync(powershell!, ["-NoProfile", "-Command", PS_RUN_CLAUDE], { env, windowsHide: true, encoding: "utf8" });
      expect(result.status).toBe(0);
      expect((result.stdout || "").trim().length).toBeGreaterThan(0); // hostname printed
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }, REAL_EXEC_TIMEOUT_MS);

  it.skipIf(process.platform !== "win32")("starts PowerShell in the exact cwd, including spaces and metacharacters", () => {
    const powershell = trustedPowerShellPath(process.env)!;
    const base = mkdtempSync(join(tmpdir(), "cdps-"));
    const dir = join(base, "work & (dir)^ space");
    mkdirSync(dir);
    try {
      const result = spawnSync(powershell, ["-NoProfile", "-Command", "(Get-Location).Path"], { cwd: dir, windowsHide: true, encoding: "utf8" });
      expect(result.status).toBe(0);
      // Compare canonical (long-form) paths: os.tmpdir() can return an 8.3 short
      // path (e.g. RUNNER~1) while PowerShell reports the expanded long name.
      expect((result.stdout || "").trim().toLowerCase()).toBe(realpathSync.native(dir).toLowerCase());
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }, REAL_EXEC_TIMEOUT_MS);

  it.skipIf(SKIP_WINDOW_SPAWN)("opens PowerShell via cmd /c start, which actually runs the fixed command IN PowerShell", async () => {
    const powershell = trustedPowerShellPath(process.env)!;
    const cmdExe = trustedCmdPath(process.env)!;
    expect(cmdExe).not.toBeNull();
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const base = mkdtempSync(join(tmpdir(), "cdps-"));
    const marker = join(base, "ran.txt");
    try {
      const env = { ...process.env, [CHARA_DESK_CLAUDE_ENV]: join(systemRoot, "System32", "hostname.exe"), MARKER_OUT: marker };
      // Derive argv from the REAL production builder, so the "DSH Desk" title, arg order
      // and cmd/start structure stay in lockstep with the launcher. Adapt only for CI:
      // swap -NoExit -> -NoProfile so the window self-closes, and redirect the "claude"
      // (hostname) output — the marker appears only if `start` truly launched PowerShell
      // AND PowerShell ran the command, proving cmd is only a launcher (it passed the
      // `&`/`>` through verbatim) and claude runs INSIDE PowerShell.
      const { file, args } = buildPowerShellLaunch(cmdExe, powershell, "& $env:CHARA_DESK_CLAUDE > $env:MARKER_OUT", {});
      const child = spawn(file, args.map(a => (a === "-NoExit" ? "-NoProfile" : a)),
        { env, detached: true, windowsHide: true, stdio: "ignore" });
      child.unref();
      const printed = await waitForFileContent(marker, 10000);
      expect(printed.length).toBeGreaterThan(0); // PowerShell ran `& $env:CHARA_DESK_CLAUDE` (hostname) and captured its output
    } finally {
      // The `start`-launched PowerShell may still hold the redirected file for a moment as
      // it exits; retry the unlink and never let cleanup of a temp dir fail the test.
      try { rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* harmless temp-dir residue */ }
    }
  }, 15000);

  it.skipIf(SKIP_WINDOW_SPAWN)("normalizes an extended-length cwd so cmd/start lands PowerShell in the real folder (raw \\\\?\\ drops to the system dir)", async () => {
    const powershell = trustedPowerShellPath(process.env)!;
    const cmdExe = trustedCmdPath(process.env)!;
    const base = realpathSync.native(mkdtempSync(join(tmpdir(), "cdps-")));
    const extended = `\\\\?\\${base}`; // extended-length form of the SAME directory
    try {
      // normalizeCmdCwd must strip the prefix back to the plain drive path cmd can use.
      expect(normalizeCmdCwd(extended)).toEqual({ ok: true, cwd: base });

      // Launch PowerShell via the real builder with a given cwd; report where PS landed
      // (MARKER_OUT is absolute, so it's captured even if cmd falls back elsewhere).
      const landedIn = async (cwd: string, tag: string) => {
        const marker = join(base, `${tag}.txt`);
        const { file, args } = buildPowerShellLaunch(cmdExe, powershell, "(Get-Location).Path > $env:MARKER_OUT", {});
        try {
          spawn(file, args.map(a => (a === "-NoExit" ? "-NoProfile" : a)),
            { cwd, env: { ...process.env, MARKER_OUT: marker }, detached: true, windowsHide: true, stdio: "ignore" }).unref();
        } catch { return ""; } // a rejected cwd is also "did not land in our folder"
        return (await waitForFileContent(marker, 10000)).toLowerCase();
      };

      // Raw extended cwd: cmd can't use it and silently drops to the system dir — NOT ours.
      expect(await landedIn(extended, "raw")).not.toBe(base.toLowerCase());
      // Normalized cwd (== base, asserted above): cmd/start lands PowerShell in the folder.
      expect(await landedIn(base, "fixed")).toBe(base.toLowerCase());
    } finally {
      try { rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* harmless temp-dir residue */ }
    }
  }, 25000);
});
