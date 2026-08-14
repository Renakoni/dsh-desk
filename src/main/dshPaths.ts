import { homedir } from "node:os";
import { join, resolve } from "node:path";

function expandHomePath(filePath: string): string {
  if (filePath === "~") return homedir();
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) return join(homedir(), filePath.slice(2));
  return filePath;
}

export function resolveDshHome(explicitHome?: string): string {
  const fromEnvironment = process.env.DSH_HOME;
  const selected = explicitHome
    ?? (fromEnvironment !== undefined && fromEnvironment.trim().length > 0
      ? fromEnvironment
      : join(homedir(), ".dsh"));
  return resolve(expandHomePath(selected));
}
