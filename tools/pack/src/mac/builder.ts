import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";

import type { ToolPackConfig } from "../config.js";
import { macResources } from "../resources.js";
import { execFileAsync } from "./commands.js";
import {
  ELECTRON_BUILDER_ASAR,
  ELECTRON_BUILDER_FILE_PATTERNS,
  MAC_ELECTRON_LANGUAGES,
  PRODUCT_NAME,
  WEB_STANDALONE_HOOK_CONFIG_ENV,
  WEB_STANDALONE_RESOURCE_NAME,
} from "./constants.js";
import { pathExists } from "./fs.js";
import { readPackagedVersion } from "./manifest.js";
import { sanitizeNamespace } from "./paths.js";
import type { ElectronBuilderTarget, MacBuildOutput, MacPaths } from "./types.js";

export const MAC_FRAMEWORK_TOP_LEVEL_SIGN_IGNORE = [
  String.raw`/Contents/Frameworks/[^/]+\.framework$`,
  String.raw`/Contents/Frameworks/[^/]+\.framework/[^/]+$`,
  String.raw`/Contents/Frameworks/[^/]+\.framework/Versions/Current/[^/]+$`,
] as const;

export async function resolveElectronFrameworkVersionSignTargets(electronDistPath: string): Promise<string[]> {
  const frameworksRoot = join(electronDistPath, "Electron.app", "Contents", "Frameworks");
  let entries;
  try {
    entries = await readdir(frameworksRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const targets: string[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith(".framework")) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

    const versionPath = join(frameworksRoot, entry.name, "Versions", "A");
    if (await pathExists(versionPath)) {
      targets.push(posix.join("Contents", "Frameworks", entry.name, "Versions", "A"));
    }
  }

  return targets.sort();
}

async function assertWebStandaloneOutput(config: ToolPackConfig): Promise<void> {
  const webRoot = join(config.workspaceRoot, "apps", "web");
  const standaloneSourceRoot = join(webRoot, ".next", "standalone");
  const candidates = [
    join(standaloneSourceRoot, "apps", "web", "server.js"),
    join(standaloneSourceRoot, "server.js"),
  ];

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return;
  }

  throw new Error("Next.js standalone server output was not produced under apps/web/.next/standalone");
}

async function writeWebStandaloneHookConfig(config: ToolPackConfig, paths: MacPaths): Promise<string> {
  const webRoot = join(config.workspaceRoot, "apps", "web");
  await assertWebStandaloneOutput(config);

  await mkdir(dirname(paths.webStandaloneHookConfigPath), { recursive: true });
  await writeFile(
    paths.webStandaloneHookConfigPath,
    `${JSON.stringify(
      {
        auditReportPath: paths.webStandaloneHookAuditPath,
        pruneCopiedSharp: true,
        pruneRootNext: true,
        pruneRootSharp: true,
        macAdhocBundleSign: !config.signed,
        resourceName: WEB_STANDALONE_RESOURCE_NAME,
        standaloneSourceRoot: join(webRoot, ".next", "standalone"),
        version: 1,
        webPublicSourceRoot: join(webRoot, "public"),
        webStaticSourceRoot: join(webRoot, ".next", "static"),
        workspaceRoot: config.workspaceRoot,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return paths.webStandaloneHookConfigPath;
}

export function resolveElectronBuilderTargets(to: MacBuildOutput): ElectronBuilderTarget[] {
  switch (to) {
    case "app":
      return ["dir"];
    case "dmg":
      return ["dir", "dmg"];
    case "zip":
      return ["dir", "zip"];
    case "all":
      return ["dir", "dmg", "zip"];
  }
}

export async function runElectronBuilder(
  config: ToolPackConfig,
  paths: MacPaths,
  targets: ElectronBuilderTarget[],
): Promise<void> {
  const namespaceToken = sanitizeNamespace(config.namespace);
  const packagedVersion = await readPackagedVersion(config);
  const frameworkVersionSignTargets = config.signed
    ? await resolveElectronFrameworkVersionSignTargets(config.electronDistPath)
    : [];
  const webStandaloneHookConfigPath = config.webOutputMode === "standalone"
    ? await writeWebStandaloneHookConfig(config, paths)
    : null;
  const builderConfig = {
    appId: "io.open-design.desktop",
    artifactName: `${PRODUCT_NAME}-${namespaceToken}.\${ext}`,
    afterPack: webStandaloneHookConfigPath == null ? undefined : macResources.webStandaloneAfterPackHook,
    afterSign: config.signed ? macResources.notarizeHook : undefined,
    asar: ELECTRON_BUILDER_ASAR,
    buildDependenciesFromSource: false,
    compression: config.macCompression,
    directories: {
      output: paths.appBuilderOutputRoot,
    },
    dmg: {
      icon: macResources.icon,
      iconSize: 96,
      title: `${PRODUCT_NAME}-${namespaceToken}`,
    },
    electronDist: config.electronDistPath,
    electronVersion: config.electronVersion,
    executableName: PRODUCT_NAME,
    extraMetadata: {
      main: "./main.cjs",
      name: "open-design-packaged-app",
      productName: PRODUCT_NAME,
      version: packagedVersion,
    },
    extraResources: [
      { from: paths.resourceRoot, to: "open-design" },
      { from: paths.packagedConfigPath, to: "open-design-config.json" },
    ],
    files: [...ELECTRON_BUILDER_FILE_PATTERNS],
    mac: {
      category: "public.app-category.developer-tools",
      binaries: frameworkVersionSignTargets.length === 0 ? undefined : frameworkVersionSignTargets,
      electronLanguages: MAC_ELECTRON_LANGUAGES,
      entitlements: config.signed ? macResources.entitlements : undefined,
      entitlementsInherit: config.signed ? macResources.entitlementsInherit : undefined,
      gatekeeperAssess: false,
      hardenedRuntime: config.signed,
      icon: macResources.icon,
      identity: config.signed ? undefined : null,
      notarize: false,
      signIgnore: config.signed ? [...MAC_FRAMEWORK_TOP_LEVEL_SIGN_IGNORE] : undefined,
      target: targets,
    },
    nodeGypRebuild: false,
    npmRebuild: false,
    productName: PRODUCT_NAME,
    icon: macResources.icon,
    publish: [
      {
        provider: "generic",
        url: "https://updates.invalid/open-design",
      },
    ],
  };

  await rm(paths.appBuilderOutputRoot, { force: true, recursive: true });
  await mkdir(dirname(paths.appBuilderConfigPath), { recursive: true });
  await writeFile(paths.appBuilderConfigPath, `${JSON.stringify(builderConfig, null, 2)}\n`, "utf8");
  await execFileAsync(process.execPath, [
    config.electronBuilderCliPath,
    "--mac",
    "--projectDir",
    paths.assembledAppRoot,
    "--config",
    paths.appBuilderConfigPath,
    "--publish",
    "never",
  ], {
    cwd: config.workspaceRoot,
    env: {
      ...process.env,
      ...(config.signed ? {} : { CSC_IDENTITY_AUTO_DISCOVERY: "false" }),
      ...(webStandaloneHookConfigPath == null ? {} : { [WEB_STANDALONE_HOOK_CONFIG_ENV]: webStandaloneHookConfigPath }),
    },
  });
}
