import { execFile as execFileCallback } from "node:child_process";
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { get as httpsGet } from "node:https";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const stableVersionPattern = /^(\d+)\.(\d+)\.(\d+)$/;
const stableTagPattern = /^open-design-v(\d+\.\d+\.\d+)$/;
const betaVersionPattern = /^(\d+\.\d+\.\d+)-beta\.(\d+)$/;

type ParsedStableVersion = {
  parsed: [number, number, number];
  value: string;
};

type ParsedBetaVersion = {
  baseVersion: string;
  betaNumber: number;
  betaVersion: string;
};

function fail(message: string): never {
  console.error(`[release-beta] ${message}`);
  process.exit(1);
}

function parseStableVersion(value: string): [number, number, number] | null {
  const match = stableVersionPattern.exec(value);
  if (match == null) return null;

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: [number, number, number], right: [number, number, number]): number {
  const [leftMajor, leftMinor, leftPatch] = left;
  const [rightMajor, rightMinor, rightPatch] = right;
  const pairs = [
    [leftMajor, rightMajor],
    [leftMinor, rightMinor],
    [leftPatch, rightPatch],
  ] as const;

  for (const [leftPart, rightPart] of pairs) {
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return 0;
}

function extractStableVersionFromTag(tag: string): ParsedStableVersion | null {
  const match = stableTagPattern.exec(tag);
  if (match?.[1] == null) return null;

  const parsed = parseStableVersion(match[1]);
  return parsed == null ? null : { parsed, value: match[1] };
}

function parseBetaParts(baseVersion: string, betaNumber: string): ParsedBetaVersion {
  const parsedBetaNumber = Number(betaNumber);
  if (!Number.isSafeInteger(parsedBetaNumber) || parsedBetaNumber < 1) {
    fail(`invalid beta number in latest beta metadata: ${betaNumber}`);
  }

  return {
    baseVersion,
    betaNumber: parsedBetaNumber,
    betaVersion: `${baseVersion}-beta.${betaNumber}`,
  };
}

function parseBetaVersionFromLatestMacYml(value: string): ParsedBetaVersion {
  const match = value.match(/^version:\s*["']?([^"'\n]+)["']?\s*$/m);
  if (match?.[1] == null) {
    fail("R2 beta latest-mac.yml is missing a version field");
  }

  const betaMatch = betaVersionPattern.exec(match[1]);
  if (betaMatch?.[1] == null || betaMatch[2] == null) {
    fail(`R2 beta latest-mac.yml version must be x.y.z-beta.N; got ${match[1]}`);
  }

  return parseBetaParts(betaMatch[1], betaMatch[2]);
}

async function readPackagedVersion(): Promise<string> {
  const packageJsonPath = join(process.cwd(), "apps", "packaged", "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: unknown };

  if (typeof packageJson.version !== "string") {
    fail(`missing version in ${packageJsonPath}`);
  }

  if (!stableVersionPattern.test(packageJson.version)) {
    fail(`apps/packaged/package.json version must be a stable x.y.z base version; got ${packageJson.version}`);
  }

  return packageJson.version;
}

async function fetchGitTags(pattern: string): Promise<string[]> {
  const { stdout } = await execFile("git", ["tag", "--list", pattern]);
  return stdout
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function fetchOptionalHttpsText(url: string, redirectCount = 0): Promise<string | null> {
  return new Promise((resolvePromise, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      reject(new Error(`expected HTTPS URL for beta feed lookup: ${parsed.protocol}`));
      return;
    }

    const request = httpsGet(
      parsed,
      {
        headers: {
          "Cache-Control": "no-cache",
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode === 404) {
          response.resume();
          resolvePromise(null);
          return;
        }

        const location = response.headers.location;
        if (statusCode >= 300 && statusCode < 400 && typeof location === "string") {
          response.resume();
          if (redirectCount >= 3) {
            reject(new Error("too many redirects while reading beta feed"));
            return;
          }
          const nextUrl = new URL(location, parsed).toString();
          fetchOptionalHttpsText(nextUrl, redirectCount + 1).then(resolvePromise, reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`beta feed request failed with HTTP ${statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolvePromise(Buffer.concat(chunks).toString("utf8"));
        });
      },
    );

    request.setTimeout(10_000, () => {
      request.destroy(new Error("timed out while reading beta feed"));
    });
    request.on("error", reject);
  });
}

function validateHttpsUrl(value: string, name: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${name} must be an HTTPS URL; got ${value}`);
  }

  if (parsed.protocol !== "https:") {
    fail(`${name} must be an HTTPS URL; got ${value}`);
  }
}

function setOutput(name: string, value: string): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath == null || outputPath.length === 0) return;
  appendFileSync(outputPath, `${name}=${value}\n`);
}

const signed = process.env.OPEN_DESIGN_RELEASE_SIGNED !== "false";
const packagedVersion = await readPackagedVersion();
const packagedParsed = parseStableVersion(packagedVersion) ?? fail(`invalid packaged version: ${packagedVersion}`);
const tags = await fetchGitTags("open-design-v*");

let latestStable: ParsedStableVersion | null = null;
for (const tag of tags) {
  const stableVersion = extractStableVersionFromTag(tag);
  if (stableVersion == null) continue;

  if (latestStable == null || compareVersions(stableVersion.parsed, latestStable.parsed) > 0) {
    latestStable = stableVersion;
  }
}

if (latestStable != null && compareVersions(packagedParsed, latestStable.parsed) <= 0) {
  fail(`packaged base version ${packagedVersion} must be strictly greater than latest stable ${latestStable.value}`);
}

const latestMacFeedUrl = process.env.OPEN_DESIGN_BETA_LATEST_MAC_URL;
if (latestMacFeedUrl == null || latestMacFeedUrl.length === 0) {
  fail("OPEN_DESIGN_BETA_LATEST_MAC_URL is required");
}
validateHttpsUrl(latestMacFeedUrl, "OPEN_DESIGN_BETA_LATEST_MAC_URL");

let betaNumber = 1;
let latestBeta: ParsedBetaVersion | null = null;
const latestMacFeed = await fetchOptionalHttpsText(latestMacFeedUrl);
if (latestMacFeed == null) {
  console.log("[release-beta] R2 beta latest-mac.yml: not found");
} else {
  latestBeta = parseBetaVersionFromLatestMacYml(latestMacFeed);
  console.log(`[release-beta] R2 beta latest-mac.yml version: ${latestBeta.betaVersion}`);

  const beta = latestBeta;
  const existingBase = parseStableVersion(beta.baseVersion);
  if (existingBase == null) {
    fail(`invalid beta base version in R2 beta latest-mac.yml: ${beta.baseVersion}`);
  }

  const ordering = compareVersions(packagedParsed, existingBase);
  if (ordering < 0) {
    fail(`packaged base version ${packagedVersion} regressed below current beta base version ${beta.baseVersion}`);
  }

  if (ordering === 0) {
    betaNumber = beta.betaNumber + 1;
  }
}

const betaVersion = `${packagedVersion}-beta.${betaNumber}`;
const unsignedSuffix = signed ? "" : ".unsigned";
const branch = process.env.GITHUB_REF_NAME ?? "";
const commit = process.env.GITHUB_SHA ?? "";
const releaseName = `Open Design Beta ${betaVersion}${signed ? "" : " (unsigned)"}`;

console.log(`[release-beta] channel: beta`);
console.log(`[release-beta] base version: ${packagedVersion}`);
console.log(`[release-beta] beta version: ${betaVersion}`);
console.log(`[release-beta] signed: ${signed ? "true" : "false"}`);
console.log("[release-beta] beta state source: R2 latest-mac.yml");
if (latestStable != null) console.log(`[release-beta] latest stable: ${latestStable.value}`);
if (latestBeta != null) console.log(`[release-beta] latest beta: ${latestBeta.betaVersion}`);

setOutput("asset_version_suffix", unsignedSuffix);
setOutput("base_version", packagedVersion);
setOutput("beta_number", String(betaNumber));
setOutput("beta_version", betaVersion);
setOutput("branch", branch);
setOutput("commit", commit);
setOutput("latest_stable", latestStable?.value ?? "");
setOutput("release_name", releaseName);
setOutput("signed", signed ? "true" : "false");
