// Small filesystem-access helpers extracted so they can be unit-tested against
// real temp files without booting Electron.
import { statSync, accessSync, constants } from "node:fs";

// Whether `path` is a REGULAR FILE that the current process can read. This is
// stricter than existsSync: a directory with the expected name, a special file,
// or a file the process lacks read permission for all return false. Any
// filesystem exception (missing, EACCES, …) is treated as "not readable".
export function isReadableRegularFile(path: string): boolean {
  if (!path) return false;
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
