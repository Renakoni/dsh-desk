/**
 * Parser for pet install command lines.
 *
 * Gallery pages show a copy-pastable command (the codex-pet.org API even
 * ships it as a `command` field), so the install box accepts the whole line
 * — e.g. `npx codex-pet-installer add yuexinmiao` — as well as a bare slug.
 *
 * SECURITY: this is parsing, never execution. A recognized command is
 * translated to (source, slug) and resolved through this app's own HTTP
 * downloader; the command line itself never reaches a shell. Commands from
 * known-but-unsupported installers fail with an explicit code so the UI can
 * say so instead of pretending, and future installers slot into the
 * registry below.
 */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Installers whose ecosystems exist but which this app cannot resolve yet. */
const KNOWN_UNSUPPORTED_INSTALLERS = new Set(["petdex", "codex-pet-cli"]);

export type PetInstallCommandResult =
  | { ok: true; source: "codex-pet.org"; slug: string }
  | { ok: false; code: "empty" | "unsupported-installer" | "unrecognized"; installer?: string };

export function parsePetInstallCommand(input: string): PetInstallCommandResult {
  // Tolerate copied shell prompts ("$ npx ..." / "> npx ...").
  const cleaned = String(input ?? "").trim().replace(/^[$>]\s*/, "");
  if (!cleaned) return { ok: false, code: "empty" };

  const tokens = cleaned.split(/\s+/);

  // Bare slug convenience: "yuexinmiao" keeps working. Tool names alone are
  // a truncated command, not a pet.
  if (tokens.length === 1) {
    const slug = tokens[0].toLowerCase();
    if (slug === "npx" || slug === "npm") return { ok: false, code: "unrecognized" };
    return SLUG_PATTERN.test(slug)
      ? { ok: true, source: "codex-pet.org", slug }
      : { ok: false, code: "unrecognized" };
  }

  if (tokens[0].toLowerCase() !== "npx") return { ok: false, code: "unrecognized" };

  // Skip common npx flags ("npx -y codex-pet-installer ...").
  let index = 1;
  while (index < tokens.length && /^(-y|--yes|-q|--quiet)$/i.test(tokens[index])) index++;
  const installer = tokens[index]?.toLowerCase();
  if (!installer) return { ok: false, code: "unrecognized" };

  if (installer === "codex-pet-installer") {
    const verb = tokens[index + 1]?.toLowerCase();
    const slug = tokens[index + 2]?.toLowerCase();
    if (verb === "add" && slug && SLUG_PATTERN.test(slug) && tokens.length === index + 3) {
      return { ok: true, source: "codex-pet.org", slug };
    }
    return { ok: false, code: "unrecognized" };
  }

  if (KNOWN_UNSUPPORTED_INSTALLERS.has(installer)) {
    return { ok: false, code: "unsupported-installer", installer };
  }

  return { ok: false, code: "unrecognized" };
}
