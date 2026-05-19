import { access, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function buildExtension({
  rootDir = ROOT_DIR,
  now = () => new Date(),
  spawnCommand = spawn
} = {}) {
  const plan = await createBuildPlan({ rootDir, now });
  await mkdir(plan.distDir, { recursive: true });
  await runZip({
    cwd: plan.extensionDir,
    outputPath: plan.outputPath,
    spawnCommand
  });
  return plan;
}

export async function createBuildPlan({ rootDir = ROOT_DIR, now = () => new Date() } = {}) {
  const packageJson = await readJson(path.join(rootDir, "package.json"));
  const manifest = await readJson(path.join(rootDir, "extension", "manifest.json"));
  const packageName = normalizeArtifactPart(packageJson.name || manifest.name || "extension");
  const version = normalizeArtifactPart(readManifestVersion(manifest));
  const distDir = path.join(rootDir, "dist");
  const outputPath = await resolveOutputPath({
    distDir,
    packageName,
    version,
    now
  });

  return {
    distDir,
    extensionDir: path.join(rootDir, "extension"),
    manifestVersion: manifest.version,
    outputPath,
    packageVersion: packageJson.version || "",
    version
  };
}

export async function resolveOutputPath({ distDir, packageName, version, now = () => new Date() }) {
  const baseName = `${packageName}-${version}.zip`;
  const basePath = path.join(distDir, baseName);

  if (!await fileExists(basePath)) {
    return basePath;
  }

  const timestamp = formatTimestamp(now());
  for (let index = 1; index < 100; index += 1) {
    const suffix = index === 1 ? timestamp : `${timestamp}-${index}`;
    const candidatePath = path.join(distDir, `${packageName}-${version}-${suffix}.zip`);
    if (!await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error(`Could not find a free artifact filename in ${distDir}`);
}

export function formatTimestamp(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function readManifestVersion(manifest) {
  if (typeof manifest.version !== "string" || manifest.version.trim() === "") {
    throw new Error("extension/manifest.json must define a version before packaging");
  }

  return manifest.version;
}

function normalizeArtifactPart(value) {
  const normalized = String(value).trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) {
    throw new Error(`Invalid artifact name part: ${value}`);
  }
  return normalized;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function runZip({ cwd, outputPath, spawnCommand }) {
  await new Promise((resolve, reject) => {
    const child = spawnCommand("zip", [
      "-r",
      outputPath,
      ".",
      "-x",
      "*.DS_Store",
      "__MACOSX/*"
    ], {
      cwd,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`zip exited with code ${code}`));
    });
  });
}

function isMainModule() {
  return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  buildExtension()
    .then((plan) => {
      if (plan.packageVersion && plan.packageVersion !== plan.manifestVersion) {
        console.warn(`Warning: package.json version is ${plan.packageVersion}, extension/manifest.json version is ${plan.manifestVersion}; using manifest version for the Chrome plugin package.`);
      }
      console.log(`Built ${path.relative(ROOT_DIR, plan.outputPath)}`);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
