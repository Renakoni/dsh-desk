import { homedir } from "node:os";
import { join } from "node:path";

export function resolveDshHome(explicitHome?: string): string {
  return explicitHome ?? process.env.DSH_HOME ?? join(homedir(), ".dsh");
}
