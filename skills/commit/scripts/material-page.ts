import { requireThat } from "./local-git.ts";
import { digest, type Reference } from "./private-files.ts";

const materialNames = [
  "diff",
  "history",
  "recent-history",
  "pr-diff",
  "pr-history",
  "pr-templates",
  "files",
  "prFiles",
];
export const displayBudget = 32768;
export function view(bytes: Buffer) {
  try {
    if (bytes.includes(0))
      return { encoding: "base64", text: bytes.toString("base64") };
    return {
      encoding: "utf8",
      text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes,
      ),
    };
  } catch {
    return { encoding: "base64", text: bytes.toString("base64") };
  }
}

type Cursor = {
  binding: string;
  materials: string[];
  index: number;
  offset: number;
};
type Source = Buffer | unknown[];
type Part = Record<string, unknown>;
const integer = (v: unknown): v is number =>
  Number.isSafeInteger(v) && Number(v) >= 0;
function materialBinding(
  ref: Reference,
  materials: string[],
  index: number,
  offset: number,
) {
  return digest(
    Buffer.from(
      JSON.stringify([
        ref.repository,
        ref.directory,
        ref.run,
        ref.dev,
        ref.ino,
        Object.entries(ref.files).sort(([a], [b]) => a.localeCompare(b)),
        materials,
        index,
        offset,
      ]),
    ),
  );
}
export function materialPage(
  ref: Reference,
  input: Record<string, unknown>,
  source: (name: string) => Source,
) {
  const continuation = input.cursor !== undefined;
  requireThat(
    Object.keys(input).every((k) =>
      ["reference", continuation ? "cursor" : "materials"].includes(k),
    ),
    "invalid_material_request",
  );
  const cursor = (
    continuation
      ? input.cursor
      : {
          materials: input.materials,
          index: 0,
          offset: 0,
        }
  ) as Cursor;
  requireThat(
    cursor !== null &&
      typeof cursor === "object" &&
      !Array.isArray(cursor) &&
      Object.keys(cursor).length === (continuation ? 4 : 3) &&
      Array.isArray(cursor.materials) &&
      cursor.materials.length > 0 &&
      cursor.materials.every((n) => materialNames.includes(n)) &&
      new Set(cursor.materials).size === cursor.materials.length &&
      integer(cursor.index) &&
      cursor.index <= cursor.materials.length &&
      integer(cursor.offset),
    "invalid_material_request",
  );
  requireThat(
    !continuation ||
      cursor.binding ===
        materialBinding(ref, cursor.materials, cursor.index, cursor.offset),
    "invalid_material_request",
  );
  // Resolve every requested material, including those deferred to later pages.
  const sources = cursor.materials.map(source);
  let { index, offset } = cursor;
  requireThat(
    index === sources.length ? offset === 0 : offset <= sources[index].length,
    "invalid_material_request",
  );
  const parts: Part[] = [];
  const result = (items: Part[], nextIndex: number, nextOffset: number) => ({
    fixed: true,
    parts: items,
    next:
      nextIndex === sources.length
        ? null
        : {
            binding: materialBinding(
              ref,
              cursor.materials,
              nextIndex,
              nextOffset,
            ),
            materials: cursor.materials,
            index: nextIndex,
            offset: nextOffset,
          },
    done: nextIndex === sources.length,
    unread: cursor.materials.slice(nextIndex),
  });
  const fits = (items: Part[], nextIndex: number, nextOffset: number) =>
    Buffer.byteLength(JSON.stringify(result(items, nextIndex, nextOffset))) <=
    displayBudget;
  while (index < sources.length) {
    const payload = sources[index];
    const utf8 = Buffer.isBuffer(payload) && view(payload).encoding === "utf8";
    const boundary = (position: number) =>
      !utf8 ||
      position === payload.length ||
      ((payload as Buffer)[position] & 0xc0) !== 0x80;
    requireThat(boundary(offset), "invalid_material_request");
    const endAt = (length: number) => {
      let end = offset + length;
      while (!boundary(end)) end--;
      return end;
    };
    const partAt = (end: number): Part =>
      Buffer.isBuffer(payload)
        ? {
            name: cursor.materials[index],
            offset,
            length: end - offset,
            totalBytes: payload.length,
            ...(utf8
              ? view(payload.subarray(offset, end))
              : {
                  encoding: "base64",
                  text: payload.subarray(offset, end).toString("base64"),
                }),
          }
        : {
            name: cursor.materials[index],
            offset,
            count: end - offset,
            totalCount: payload.length,
            items: payload.slice(offset, end),
          };
    const fitsEnd = (end: number) =>
      fits(
        [...parts, partAt(end)],
        end === payload.length ? index + 1 : index,
        end === payload.length ? 0 : end,
      );
    let low = 0;
    let high = Math.min(payload.length - offset, displayBudget);
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (fitsEnd(endAt(mid))) low = mid;
      else high = mid - 1;
    }
    const end = endAt(low);
    if (!fitsEnd(end) || (end === offset && offset < payload.length)) {
      requireThat(parts.length > 0, "material_display_budget_exceeded");
      break;
    }
    parts.push(partAt(end));
    if (end === payload.length) {
      index++;
      offset = 0;
    } else {
      offset = end;
      break;
    }
  }
  const page = result(parts, index, offset);
  requireThat(
    Buffer.byteLength(JSON.stringify(page)) <= displayBudget,
    "material_display_budget_exceeded",
  );
  return page;
}
