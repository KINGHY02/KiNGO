import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { spawnSync } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function detectedTarget() {
  if (process.platform === "win32" && process.arch === "x64") return "windows-x64";
  if (process.platform === "darwin" && process.arch === "arm64") return "macos-arm64";
  return `${process.platform}-${process.arch}`;
}

function safePath(root, value) {
  const rootPath = resolve(root);
  const candidate = resolve(rootPath, value);
  if (candidate !== rootPath && !candidate.startsWith(`${rootPath}${sep}`)) {
    throw new Error(`Path escapes its root: ${value}`);
  }
  return candidate;
}

function fileSha256(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function run(program, commandArgs, description) {
  const result = spawnSync(program, commandArgs, { stdio: "inherit" });
  if (result.error) throw new Error(`${description}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${description}: ${program} exited with ${result.status ?? "no status"}`);
  }
}

async function download(entry, cacheRoot) {
  const fileName = basename(new URL(entry.url).pathname);
  const entryCache = safePath(cacheRoot, entry.id);
  mkdirSync(entryCache, { recursive: true });
  const destination = safePath(entryCache, fileName);
  if (existsSync(destination) && fileSha256(destination) === entry.sha256) {
    return destination;
  }

  const pending = `${destination}.download-${process.pid}`;
  rmSync(pending, { force: true });
  const response = await fetch(entry.url, {
    redirect: "follow",
    headers: { "User-Agent": "KiNGO reproducible macOS build" },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${entry.url}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(pending));
  const actual = fileSha256(pending);
  if (actual !== entry.sha256) {
    rmSync(pending, { force: true });
    throw new Error(`SHA-256 mismatch for ${fileName}: expected ${entry.sha256}, got ${actual}`);
  }
  rmSync(destination, { force: true });
  renameSync(pending, destination);
  return destination;
}

async function prepareMacArm64(outputDirectory) {
  const manifestPath = join(projectRoot, "core-assets", "macos-arm64.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.target !== "macos-arm64") throw new Error("Unexpected macOS core manifest target");

  const cacheRoot = join(projectRoot, "src-tauri", "target", "core-assets", manifest.target);
  const workRoot = join(cacheRoot, `work-${process.pid}`);
  const staging = `${resolve(outputDirectory)}.staging-${process.pid}`;
  mkdirSync(cacheRoot, { recursive: true });
  rmSync(workRoot, { recursive: true, force: true });
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(workRoot, { recursive: true });
  mkdirSync(staging, { recursive: true });

  try {
    for (const entry of manifest.entries) {
      const sourceArchive = await download(entry, cacheRoot);
      const extractRoot = safePath(workRoot, entry.id);
      mkdirSync(extractRoot, { recursive: true });

      if (entry.format === "archive") {
        run("tar", ["-xf", sourceArchive, "-C", extractRoot], `Extract ${entry.id}`);
      } else if (entry.format === "gzip") {
        const expanded = safePath(extractRoot, "expanded");
        await pipeline(createReadStream(sourceArchive), createGunzip(), createWriteStream(expanded));
      } else if (entry.format !== "plain") {
        throw new Error(`Unsupported archive format for ${entry.id}: ${entry.format}`);
      }

      for (const file of entry.files) {
        const source = entry.format === "plain"
          ? sourceArchive
          : entry.format === "gzip"
            ? safePath(extractRoot, "expanded")
            : safePath(extractRoot, file.source);
        if (!statSync(source).isFile()) throw new Error(`Expected file is missing for ${entry.id}: ${file.source ?? file.target}`);
        const target = safePath(staging, file.target);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(source, target);
        if (file.executable !== false) chmodSync(target, 0o755);
      }
    }

    const inventory = manifest.entries.flatMap((entry) => entry.files.map((file) => file.target)).sort();
    for (const file of inventory) {
      if (!statSync(safePath(staging, file)).isFile()) throw new Error(`Prepared core is missing: ${file}`);
    }
    writeFileSync(
      join(staging, ".kingo-platform.json"),
      `${JSON.stringify({ target: manifest.target, files: inventory }, null, 2)}\n`,
    );

    const output = resolve(outputDirectory);
    const previous = `${output}.previous-${process.pid}`;
    rmSync(previous, { recursive: true, force: true });
    if (existsSync(output)) renameSync(output, previous);
    try {
      renameSync(staging, output);
      rmSync(previous, { recursive: true, force: true });
    } catch (error) {
      if (!existsSync(output) && existsSync(previous)) renameSync(previous, output);
      throw error;
    }
    console.log(`Prepared ${inventory.length} verified macOS arm64 core files in ${relative(projectRoot, output)}.`);
  } finally {
    rmSync(workRoot, { recursive: true, force: true });
    rmSync(staging, { recursive: true, force: true });
  }
}

const target = option("--target") ?? detectedTarget();
const customOutput = option("--output");
const defaultOutput = join(projectRoot, "src-tauri", "resources", "cores");

if (target === "windows-x64") {
  if (customOutput) throw new Error("A custom output directory is not supported by the Windows restore wrapper");
  const powershell = process.platform === "win32" ? "powershell" : "pwsh";
  run(
    powershell,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(projectRoot, "scripts", "restore-core-assets.ps1")],
    "Restore Windows core assets",
  );
} else if (target === "macos-arm64") {
  if (process.platform !== "darwin" && !customOutput) {
    throw new Error("Preparing macOS cores from another OS requires an explicit --output directory");
  }
  await prepareMacArm64(customOutput ? resolve(customOutput) : defaultOutput);
} else {
  throw new Error(`KiNGO has no bundled core manifest for ${target}`);
}
