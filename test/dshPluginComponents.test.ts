import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deduplicateDshProfileComponents, mergeDshPluginComponents, scanDshStaticPluginComponents } from "../src/main/dshPluginComponents";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function writeBundle(dshHome: string, packageName: string, patch: string) {
  const directory = join(dshHome, "profiles", "node_modules", ...packageName.split("/"));
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({
    name: packageName,
    dsh: { bundle: { patch: "./cordis.patch.yml" } }
  }));
  writeFileSync(join(directory, "cordis.patch.yml"), patch);
}

function writeProfile(dshHome: string, name: string, bundles: string[]) {
  const directory = join(dshHome, "profiles", name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({
    name: `dsh-profile-${name}`,
    dsh: { profile: { bundles } }
  }));
}

describe("DSH static plugin component catalog", () => {
  it("discovers bundle roots without a running DSH process", () => {
    const dshHome = mkdtempSync(join(tmpdir(), "dsh-static-components-"));
    roots.push(dshHome);
    writeBundle(dshHome, "@deepseek-ai/dsh-base", "- insert:\n    - id: timer\n      name: timer-plugin\n      config:\n        root: !!js process.cwd()\n    - id: tools\n      group: true\n      config:\n        - id: search\n          name: search-plugin\n");
    writeBundle(dshHome, "@deepseek-ai/dsh-web-app", "- insert:\n    - id: code-runtime\n      name: code-runtime-plugin\n");
    writeBundle(dshHome, "@deepseek-ai/dsh-headless", "- insert:\n    - id: code-runtime\n      name: code-runtime-plugin\n    - id: runner\n      name: runner-plugin\n");
    writeBundle(dshHome, "dsh-desk-plugin", "- insert:\n    - id: dsh-desk\n      name: dsh-desk-plugin\n");
    writeProfile(dshHome, "web", ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-desk-plugin"]);
    writeProfile(dshHome, "headless", ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless", "dsh-desk-plugin"]);

    const catalog = scanDshStaticPluginComponents(dshHome);
    expect(catalog["@deepseek-ai/dsh-base"]).toEqual([
      expect.objectContaining({ key: "include:tools:search", moduleName: "search-plugin", runtimeObserved: false, manageable: true }),
      expect.objectContaining({ key: "include:timer", moduleName: "timer-plugin", runtimeObserved: false, manageable: true })
    ]);
    expect(catalog["@deepseek-ai/dsh-web-app"]).toEqual([
      expect.objectContaining({ key: "include:code-runtime", runtimeObserved: false })
    ]);
    expect(catalog["@deepseek-ai/dsh-headless"].map(component => component.key)).toEqual([
      "include:code-runtime",
      "include:runner"
    ]);
    expect(catalog["dsh-desk-plugin"]).toEqual([
      expect.objectContaining({ key: "include:dsh-desk", manageable: false })
    ]);
  });

  it("refreshes the cached catalog when a bundle patch changes", () => {
    const dshHome = mkdtempSync(join(tmpdir(), "dsh-static-components-"));
    roots.push(dshHome);
    writeBundle(dshHome, "demo-bundle", "- insert:\n    - id: first\n      name: first-plugin\n");
    writeProfile(dshHome, "web", ["demo-bundle"]);
    expect(scanDshStaticPluginComponents(dshHome)["demo-bundle"].map(component => component.name)).toEqual(["first"]);

    writeBundle(dshHome, "demo-bundle", "- insert:\n    - id: first\n      name: first-plugin\n    - id: second\n      name: second-plugin\n");
    expect(scanDshStaticPluginComponents(dshHome)["demo-bundle"].map(component => component.name)).toEqual(["first", "second"]);
  });

  it("overlays live state and shows a shared Web and Headless path once", () => {
    const offline = [{
      key: "include:code-runtime",
      name: "code-runtime",
      moduleName: "code-runtime-plugin",
      baselineEnabled: true,
      enabled: false,
      manageable: true,
      fiberPhase: null,
      runtimeObserved: false
    }] as const;
    const live = [{ ...offline[0], enabled: true, fiberPhase: "active" as const, runtimeObserved: undefined }];
    const components = mergeDshPluginComponents([...offline], live);
    expect(components).toEqual([expect.objectContaining({ enabled: true, fiberPhase: "active", runtimeObserved: undefined })]);

    const resources = deduplicateDshProfileComponents([{
      id: "plugin:package:@deepseek-ai/dsh-headless",
      kind: "plugin" as const,
      name: "@deepseek-ai/dsh-headless",
      packageName: "@deepseek-ai/dsh-headless",
      enabled: true,
      manageable: false,
      components: live
    }, {
      id: "plugin:package:@deepseek-ai/dsh-web-app",
      kind: "plugin" as const,
      name: "@deepseek-ai/dsh-web-app",
      packageName: "@deepseek-ai/dsh-web-app",
      enabled: true,
      manageable: false,
      components: [...offline]
    }]);
    expect(resources.find(resource => resource.packageName === "@deepseek-ai/dsh-web-app")?.components).toEqual([
      expect.objectContaining({ enabled: true, fiberPhase: "active", runtimeObserved: undefined })
    ]);
    expect(resources.find(resource => resource.packageName === "@deepseek-ai/dsh-headless")?.components).toBeUndefined();
  });
});
