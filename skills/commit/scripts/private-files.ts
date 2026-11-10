import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";
import { requireThat } from "./local-git.ts";

export type Identity = {
  dev: number;
  ino: number;
  bytes: number;
  digest: string;
};
export type Reference = {
  directory: string;
  dev: number;
  ino: number;
  run: string;
  repository: string;
  files: Record<string, Identity>;
};
function outside(repository: string, path: string): boolean {
  const pathFromRepository = relative(repository, path);
  return pathFromRepository === ".." || pathFromRepository.startsWith("../");
}
export function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function object(value: unknown): Record<string, unknown> {
  requireThat(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "invalid_input",
  );
  return value as Record<string, unknown>;
}
export function reference(value: unknown, repository: string): Reference {
  const ref = object(value);
  requireThat(
    typeof ref.directory === "string" &&
      isAbsolute(ref.directory) &&
      typeof ref.run === "string" &&
      ref.repository === repository &&
      typeof ref.dev === "number" &&
      typeof ref.ino === "number",
    "invalid_reference",
  );
  requireThat(
    outside(repository, ref.directory),
    "private_directory_in_repository",
  );
  object(ref.files);
  const result = ref as Reference;
  checkDirectory(result);
  for (const name of Object.keys(result.files)) readOwned(result, name);
  return result;
}
function checkDirectory(ref: Reference) {
  const info = lstatSync(ref.directory);
  requireThat(
    info.isDirectory() &&
      !info.isSymbolicLink() &&
      info.uid === process.getuid?.() &&
      (info.mode & 0o777) === 0o700 &&
      info.dev === ref.dev &&
      info.ino === ref.ino &&
      realpathSync(ref.directory) === ref.directory,
    "private_directory_changed",
  );
}
export function createPrivate(repository: string): Reference {
  const parent = realpathSync(tmpdir());
  requireThat(outside(repository, parent), "private_directory_in_repository");
  const directory = mkdtempSync(join(parent, "pi-commit-"), {
    encoding: "utf8",
  });
  // umask may remove permissions, never rely on it to add privacy.
  const info = lstatSync(directory);
  requireThat((info.mode & 0o777) === 0o700, "private_permissions_failed");
  return {
    directory,
    dev: info.dev,
    ino: info.ino,
    run: randomUUID(),
    repository,
    files: {},
  };
}
export function save(ref: Reference, name: string, bytes: Buffer): void {
  checkDirectory(ref);
  requireThat(
    basename(name) === name && !ref.files[name],
    "invalid_private_name",
  );
  const fd = openSync(
    join(ref.directory, name),
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, bytes);
    const info = fstatSync(fd);
    requireThat(
      info.isFile() &&
        info.uid === process.getuid?.() &&
        (info.mode & 0o777) === 0o600,
      "private_permissions_failed",
    );
    ref.files[name] = {
      dev: info.dev,
      ino: info.ino,
      bytes: bytes.length,
      digest: digest(bytes),
    };
  } finally {
    closeSync(fd);
  }
}
export function readOwned(ref: Reference, name: string): Buffer {
  checkDirectory(ref);
  requireThat(
    basename(name) === name && Object.hasOwn(ref.files, name),
    "unknown_private_file",
  );
  const expected = ref.files[name];
  const fd = openSync(
    join(ref.directory, name),
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = fstatSync(fd);
    requireThat(
      info.isFile() &&
        info.uid === process.getuid?.() &&
        (info.mode & 0o777) === 0o600 &&
        info.dev === expected.dev &&
        info.ino === expected.ino,
      "private_file_changed",
    );
    const bytes = readFileSync(fd);
    requireThat(
      bytes.length === expected.bytes && digest(bytes) === expected.digest,
      "private_file_changed",
    );
    return bytes;
  } finally {
    closeSync(fd);
  }
}
export function removeOwned(ref: Reference, name: string): void {
  readOwned(ref, name);
  const info = lstatSync(join(ref.directory, name));
  requireThat(
    info.dev === ref.files[name].dev && info.ino === ref.files[name].ino,
    "private_file_changed",
  );
  unlinkSync(join(ref.directory, name));
  delete ref.files[name];
}
export function cleanup(ref: Reference): {
  complete: boolean;
  remaining: string[];
} {
  const remaining: string[] = [];
  for (const name of Object.keys(ref.files)) {
    try {
      removeOwned(ref, name);
    } catch {
      remaining.push(name);
    }
  }
  try {
    checkDirectory(ref);
    rmdirSync(ref.directory);
  } catch {
    remaining.push(ref.directory);
  }
  return { complete: remaining.length === 0, remaining };
}
export function saveJson(ref: Reference, name: string, value: unknown): void {
  save(
    ref,
    name,
    Buffer.from(
      JSON.stringify({ run: ref.run, repository: ref.repository, value }),
    ),
  );
}
export function readJson<T>(ref: Reference, name: string): T {
  const data = object(JSON.parse(readOwned(ref, name).toString()));
  requireThat(
    data.run === ref.run && data.repository === ref.repository,
    "private_run_mismatch",
  );
  return data.value as T;
}
