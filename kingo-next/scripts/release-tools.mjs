#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const minimumPayloadBytes = 1024 * 1024;

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function cargoPackageVersion() {
  const cargo = readFileSync(join(projectRoot, "src-tauri", "Cargo.toml"), "utf8");
  const packageStart = cargo.indexOf("[package]");
  if (packageStart < 0) fail("Cargo.toml is missing [package]");
  const afterPackage = cargo.slice(packageStart + "[package]".length);
  const nextSection = afterPackage.search(/\r?\n\[/);
  const packageSection = nextSection < 0 ? afterPackage : afterPackage.slice(0, nextSection);
  const match = packageSection.match(/^version\s*=\s*"([^"]+)"\s*$/m);
  if (!match) fail("Cargo.toml [package] is missing version");
  return match[1];
}

function sourceVersions() {
  const packageJson = readJson(join(projectRoot, "package.json"));
  const packageLock = readJson(join(projectRoot, "package-lock.json"));
  const tauri = readJson(join(projectRoot, "src-tauri", "tauri.conf.json"));
  return {
    "package.json": packageJson.version,
    "package-lock.json": packageLock.version,
    "package-lock.json packages root": packageLock.packages?.[""]?.version,
    "src-tauri/tauri.conf.json": tauri.version,
    "src-tauri/Cargo.toml": cargoPackageVersion(),
  };
}

function parseStableVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value ?? "");
  if (!match) fail(`Release version must be stable SemVer X.Y.Z, received: ${value ?? ""}`);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function stableTags() {
  const output = execFileSync(
    "git",
    ["tag", "--list", "v[0-9]*", "--format=%(refname:strip=2)"],
    { cwd: projectRoot, encoding: "utf8" },
  );
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((tag) => ({ tag, parsed: /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag) }))
    .filter((entry) => entry.parsed)
    .map((entry) => ({ tag: entry.tag, version: entry.parsed.slice(1).map(Number) }));
}

function validateVersion(version, requireNewer) {
  const parsed = parseStableVersion(version);
  const versions = sourceVersions();
  const mismatches = Object.entries(versions).filter(([, actual]) => actual !== version);
  if (mismatches.length > 0) {
    const details = mismatches.map(([file, actual]) => `${file}=${actual ?? "missing"}`).join(", ");
    fail(`Release version ${version} does not match source versions: ${details}`);
  }

  if (requireNewer) {
    const tags = stableTags();
    const exactTag = `v${version}`;
    if (tags.some((entry) => entry.tag === exactTag)) fail(`Tag ${exactTag} already exists`);
    const latest = tags.sort((left, right) => compareVersions(right.version, left.version))[0];
    if (latest && compareVersions(parsed, latest.version) <= 0) {
      fail(`Release version ${version} must be newer than ${latest.tag}`);
    }
  }

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=v${version}\n`, "utf8");
  }
  process.stdout.write(`Validated release version ${version} across all source files.\n`);
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function requireFile(directory, name, minimumBytes = 1) {
  const path = join(directory, name);
  let stats;
  try {
    stats = statSync(path);
  } catch {
    fail(`Missing release asset: ${name}`);
  }
  if (!stats.isFile() || stats.size < minimumBytes) {
    fail(`Release asset is unexpectedly small: ${name} (${stats.size} bytes)`);
  }
  return { name, path, bytes: stats.size };
}

function releaseUrl(repository, tag, name) {
  return `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`;
}

function prepareRelease(directoryArg, version, repository, sourceCommit) {
  parseStableVersion(version);
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository ?? "")) {
    fail(`Repository must use owner/name format, received: ${repository ?? ""}`);
  }
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit ?? "")) {
    fail(`Source commit must be a full 40-character SHA, received: ${sourceCommit ?? ""}`);
  }

  const directory = resolve(directoryArg);
  const windowsInstaller = `KiNGO-Setup-${version}-x64.exe`;
  const windowsSignature = `${windowsInstaller}.sig`;
  const macDmg = `KiNGO-${version}-macOS-arm64.dmg`;
  const macUpdater = `KiNGO-${version}-macOS-arm64.app.tar.gz`;
  const macSignature = `${macUpdater}.sig`;

  const payloads = [
    requireFile(directory, windowsInstaller, minimumPayloadBytes),
    requireFile(directory, windowsSignature, 100),
    requireFile(directory, macDmg, minimumPayloadBytes),
    requireFile(directory, macUpdater, minimumPayloadBytes),
    requireFile(directory, macSignature, 100),
  ];
  const windowsReport = requireFile(directory, "WINDOWS-BUILD-REPORT.txt", 20);
  const macReport = requireFile(directory, "MACOS-SIGNING-REPORT.txt", 20);
  for (const report of [windowsReport, macReport]) {
    const content = readFileSync(report.path, "utf8");
    if (!content.includes(`Source commit: ${sourceCommit}`)) {
      fail(`${report.name} does not identify source commit ${sourceCommit}`);
    }
  }

  const windowsSignatureContent = readFileSync(join(directory, windowsSignature), "utf8").trim();
  const macSignatureContent = readFileSync(join(directory, macSignature), "utf8").trim();
  if (windowsSignatureContent.length < 100 || macSignatureContent.length < 100) {
    fail("Updater signature content is incomplete");
  }

  const tag = `v${version}`;
  const createdAt = new Date().toISOString();
  const latest = {
    version,
    notes: `KiNGO ${tag}`,
    pub_date: createdAt,
    platforms: {
      "windows-x86_64": {
        signature: windowsSignatureContent,
        url: releaseUrl(repository, tag, windowsInstaller),
      },
      "darwin-aarch64": {
        signature: macSignatureContent,
        url: releaseUrl(repository, tag, macUpdater),
      },
    },
  };
  writeFileSync(join(directory, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`, "utf8");

  const manifestPayloads = payloads.map((asset) => ({
    name: asset.name,
    bytes: asset.bytes,
    sha256: sha256(asset.path),
  }));
  const manifest = {
    product: "KiNGO",
    version,
    tag,
    sourceCommit,
    createdAt,
    platforms: ["windows-x86_64", "darwin-aarch64"],
    artifacts: manifestPayloads,
  };
  writeFileSync(
    join(directory, "RELEASE-MANIFEST.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  const checksumEntries = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== "SHA256SUMS.txt")
    .map((entry) => entry.name)
    .sort()
    .map((name) => `${sha256(join(directory, name))}  ${name}`);
  writeFileSync(join(directory, "SHA256SUMS.txt"), `${checksumEntries.join("\n")}\n`, "utf8");

  process.stdout.write(
    `Prepared ${tag} release metadata for ${manifestPayloads.length} signed platform assets.\n`,
  );
}

function selfTest() {
  const directory = mkdtempSync(join(tmpdir(), "kingo-release-tools-"));
  const version = "9.8.7";
  const sourceCommit = "a".repeat(40);
  try {
    const largeFiles = [
      `KiNGO-Setup-${version}-x64.exe`,
      `KiNGO-${version}-macOS-arm64.dmg`,
      `KiNGO-${version}-macOS-arm64.app.tar.gz`,
    ];
    for (const name of largeFiles) {
      writeFileSync(join(directory, name), Buffer.alloc(minimumPayloadBytes + 1, name.length));
    }
    writeFileSync(
      join(directory, `KiNGO-Setup-${version}-x64.exe.sig`),
      `${"W".repeat(160)}\n`,
      "utf8",
    );
    writeFileSync(
      join(directory, `KiNGO-${version}-macOS-arm64.app.tar.gz.sig`),
      `${"M".repeat(160)}\n`,
      "utf8",
    );
    writeFileSync(
      join(directory, "WINDOWS-BUILD-REPORT.txt"),
      `Source commit: ${sourceCommit}\n`,
      "utf8",
    );
    writeFileSync(
      join(directory, "MACOS-SIGNING-REPORT.txt"),
      `Source commit: ${sourceCommit}\n`,
      "utf8",
    );

    prepareRelease(directory, version, "owner/repository", sourceCommit);
    const latest = readJson(join(directory, "latest.json"));
    const targets = Object.keys(latest.platforms).sort().join(",");
    if (targets !== "darwin-aarch64,windows-x86_64") fail(`Unexpected updater targets: ${targets}`);
    const manifest = readJson(join(directory, "RELEASE-MANIFEST.json"));
    if (manifest.sourceCommit !== sourceCommit || manifest.artifacts.length !== 5) {
      fail("Release manifest self-test failed");
    }
    if (!readFileSync(join(directory, "SHA256SUMS.txt"), "utf8").includes("latest.json")) {
      fail("Checksum self-test failed");
    }
    process.stdout.write("Release tooling self-test passed.\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function usage() {
  process.stderr.write(
    "Usage:\n" +
      "  node scripts/release-tools.mjs validate-version <X.Y.Z> [--require-newer]\n" +
      "  node scripts/release-tools.mjs prepare <directory> <X.Y.Z> <owner/repo> <source-sha>\n" +
      "  node scripts/release-tools.mjs self-test\n",
  );
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === "validate-version" && (args.length === 1 || args.length === 2)) {
    validateVersion(args[0], args[1] === "--require-newer");
  } else if (command === "prepare" && args.length === 4) {
    prepareRelease(args[0], args[1], args[2], args[3]);
  } else if (command === "self-test" && args.length === 0) {
    selfTest();
  } else {
    usage();
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`Release tooling failed: ${error.message}\n`);
  process.exitCode = 1;
}
