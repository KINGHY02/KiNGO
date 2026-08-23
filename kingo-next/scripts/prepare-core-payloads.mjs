import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(projectRoot, "src-tauri", "resources", "cores");
const payloadRoot = join(projectRoot, "src-tauri", "resources", "core-payloads");
const target = process.env.KINGO_TARGET_PLATFORM
  ?? (process.platform === "win32" && process.arch === "x64"
    ? "windows-x64"
    : process.platform === "darwin" && process.arch === "arm64"
      ? "macos-arm64"
      : `${process.platform}-${process.arch}`);
const expectedByTarget = {
  "windows-x64": [
    "hy2/hysteria2.exe",
    "hysteria/hysteria-tun-windows-6.0-386.exe",
    "juicity/juicity-client.exe",
    "mieru/mieru.exe",
    "mihomo/mihomo.exe",
    "naiveproxy/naive.exe",
    "shadowquic/shadowquic.exe",
    "sing-box/sing-box.exe",
    "subs-check/subs-check.exe",
    "xray/xray.exe",
  ],
  "macos-arm64": [
    "hy2/hysteria2",
    "hysteria/hysteria",
    "juicity/juicity-client",
    "mieru/mieru",
    "mihomo/mihomo",
    "naiveproxy/naive",
    "shadowquic/shadowquic",
    "sing-box/sing-box",
    "subs-check/subs-check",
    "xray/xray",
  ],
};
const expected = expectedByTarget[target];
if (!expected) throw new Error(`No bundled core inventory is defined for ${target}`);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const executables = walk(sourceRoot)
  .filter((path) => target === "windows-x64"
    ? path.toLowerCase().endsWith(".exe")
    : !path.split(/[\\/]/).at(-1).includes("."))
  .map((path) => relative(sourceRoot, path).replaceAll("\\", "/"))
  .sort();
if (JSON.stringify(executables) !== JSON.stringify([...expected].sort())) {
  throw new Error(`Bundled core inventory mismatch.\nExpected: ${expected.join(", ")}\nActual: ${executables.join(", ")}`);
}

rmSync(payloadRoot, { recursive: true, force: true });
const manifest = [];
for (const name of executables) {
  const source = join(sourceRoot, ...name.split("/"));
  const target = join(payloadRoot, ...`${name}.payload`.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
  const bytes = readFileSync(source);
  manifest.push({
    executable: name,
    payload: `${name}.payload`,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
writeFileSync(
  join(payloadRoot, "manifest.json"),
  `${JSON.stringify({ target, files: manifest }, null, 2)}\n`,
);
console.log(`Prepared ${manifest.length} ${target} bundled core payloads (${manifest.reduce((sum, item) => sum + item.bytes, 0)} bytes).`);
