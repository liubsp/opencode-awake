import { readFile, writeFile, rename, realpath, mkdir, access, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { parse, modify, applyEdits } from "jsonc-parser";

const packageName = "@liubsp/opencode-awake";
const normalize = (path) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);

export async function exists(path) {
  try { await access(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function belongsToAwake(entry, directory, managedRoot, migrateCheckout) {
  const target = typeof entry === "string" ? entry : entry?.package;
  if (typeof target !== "string" || target.startsWith("-")) return false;
  if (target === packageName) return true;
  let path;
  try { path = target.startsWith("file:") ? fileURLToPath(target) : resolve(directory, target); } catch { return false; }
  if (normalize(path) === normalize(managedRoot)) return true;
  if (!migrateCheckout) return false;
  for (const candidate of [join(path, "package.json"), join(dirname(path), "package.json")]) {
    try { if (JSON.parse(await readFile(candidate, "utf8")).name === packageName) return true; }
    catch (error) { if (error.code !== "ENOENT" && error.code !== "ENOTDIR" && !(error instanceof SyntaxError)) throw error; }
  }
  return false;
}

function edit(text, path, value) {
  return applyEdits(text, modify(text, path, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: text.includes("\r\n") ? "\r\n" : "\n" },
  }));
}

export async function configure(configDir, managedRoot, { uninstall = false } = {}) {
  const documents = [];
  for (const name of ["opencode.json", "opencode.jsonc"]) {
    const candidate = join(configDir, name);
    if (!await exists(candidate)) continue;
    const path = await realpath(candidate); // Preserve dotfile symlinks.
    if (documents.some((doc) => doc.path === path)) continue;
    const original = await readFile(path, "utf8");
    const errors = [];
    const info = parse(original, errors, { allowTrailingComma: true });
    if (errors.length || !info || typeof info !== "object" || Array.isArray(info)) throw new Error(`Invalid OpenCode configuration: ${name}`);
    if (info.plugins !== undefined && !Array.isArray(info.plugins)) throw new Error(`plugins must be an array in ${name}`);
    documents.push({ path, directory: dirname(candidate), original, text: original, info, matches: [] });
  }
  if (!documents.length && !uninstall) {
    documents.push({ path: join(configDir, "opencode.jsonc"), directory: configDir, original: undefined,
      text: '{\n  "$schema": "https://opencode.ai/config.json"\n}\n', info: {}, matches: [] });
  }
  let preferred;
  for (const doc of documents) {
    for (const [index, entry] of (doc.info.plugins ?? []).entries()) {
      if (await belongsToAwake(entry, doc.directory, managedRoot, !uninstall)) {
        doc.matches.push(index);
        preferred = entry;
      }
    }
  }
  const canonical = documents.at(-1);
  const target = managedRoot.replaceAll("\\", "/");
  const replacement = typeof preferred === "object" ? { ...preferred, package: target } : target;
  // Migrate timing options written by the initial checkout-only version.
  if (replacement && typeof replacement === "object" && replacement.options) {
    replacement.options = { ...replacement.options };
    for (const [oldKey, newKey] of [["pollMs", "pollSeconds"], ["releaseDelayMs", "releaseDelaySeconds"]]) {
      if (oldKey in replacement.options) {
        replacement.options[newKey] ??= Math.ceil(replacement.options[oldKey] / 1000);
        delete replacement.options[oldKey];
      }
    }
  }
  for (const doc of documents) {
    const keep = !uninstall && doc === canonical ? doc.matches.at(-1) : undefined;
    if (keep !== undefined) {
      const entry = doc.info.plugins[keep];
      doc.text = edit(doc.text, typeof entry === "object" ? ["plugins", keep, "package"] : ["plugins", keep], target);
      if (typeof entry === "object" && entry.options) {
        for (const [oldKey, newKey] of [["pollMs", "pollSeconds"], ["releaseDelayMs", "releaseDelaySeconds"]]) {
          if (oldKey in entry.options) {
            if (!(newKey in entry.options)) doc.text = edit(doc.text, ["plugins", keep, "options", newKey], Math.ceil(entry.options[oldKey] / 1000));
            doc.text = edit(doc.text, ["plugins", keep, "options", oldKey], undefined);
          }
        }
      }
    }
    for (const index of [...doc.matches].reverse()) {
      if (index !== keep) doc.text = edit(doc.text, ["plugins", index], undefined);
    }
    if (!uninstall && doc === canonical && keep === undefined) {
      doc.text = doc.info.plugins === undefined ? edit(doc.text, ["plugins"], [replacement]) :
        edit(doc.text, ["plugins", -1], replacement);
    }
  }
  const changed = documents.filter((doc) => doc.text !== doc.original);
  for (const doc of changed) {
    const current = await exists(doc.path) ? await readFile(doc.path, "utf8") : undefined;
    if (current !== doc.original) throw new Error("OpenCode configuration changed during setup; rerun the installer");
  }
  const written = [];
  try {
    for (const doc of changed) {
      if (doc.original !== undefined) await writeFile(`${doc.path}.opencode-awake.bak`, doc.original, { mode: 0o600 });
      await atomicWrite(doc.path, doc.text);
      written.push(doc);
    }
  } catch (error) {
    for (const doc of written.reverse()) {
      if (doc.original === undefined) await rm(doc.path, { force: true });
      else await atomicWrite(doc.path, doc.original);
    }
    throw error;
  }
  return changed.length;
}

export async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}
