import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Pi supplies these modules; only the host boundary is stubbed in Node tests.
const hostModules = {
  "@earendil-works/pi-ai":
    "export const Type = { Object: properties => ({type: 'object', properties}), String: () => ({type: 'string'}) };",
  "@earendil-works/pi-tui":
    "export class Text { constructor(text, paddingX, paddingY) { Object.assign(this, {text, paddingX, paddingY}); } }",
};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(hostModules, specifier)) {
      return {
        url: `data:text/javascript,${encodeURIComponent(hostModules[specifier])}`,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});
const { default: register } = await import("../extensions/commit-status.js");
let tool;
register({
  registerTool(value) {
    tool = value;
  },
});

function state(changes = []) {
  return { repository: "/repo", branch: "feature", changes };
}
function change(index, worktree, path = "file.txt", extra = {}) {
  return { index, worktree, path, ...extra };
}
function execute(status, mode = "tui") {
  return tool.execute(
    "display",
    { status: JSON.stringify(status) },
    undefined,
    undefined,
    { mode },
  );
}
function render(result, prefix = "") {
  return tool.renderResult(
    result,
    {},
    {
      fg(color, text) {
        assert.equal(text, "●", "Only the text dot may receive a color");
        return `<${prefix}${color}>${text}</${prefix}${color}>`;
      },
    },
    { outputPad: 1 },
  ).text;
}

test("colors only dots and preserves original status metadata", async () => {
  const input = state([
    change(" ", "M"),
    change("?", "?"),
    change("A", " "),
    change(" ", "D"),
  ]);
  const original = JSON.stringify(input);
  const result = await execute(input);
  assert.deepEqual(result.details, input);
  assert.equal(JSON.stringify(input), original);
  assert.match(result.content[0].text, /4件/);
  assert.doesNotMatch(result.content[0].text, /file.txt/);
  const text = render(result);
  for (const [color, label] of [
    ["warning", "Modified"],
    ["mdLink", "Untracked"],
    ["success", "Added"],
    ["error", "Deleted"],
  ]) {
    assert.ok(text.includes(`<${color}>●</${color}> ${label}`));
  }
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.destructiveHint, false);
  assert.equal(tool.renderCall({}, {}, { outputPad: 1 }).text, "Git status");
});

test("shows partial stages, renames, copies, and conflicts accurately", async () => {
  const result = await execute(
    state([
      change("M", "M"),
      change("R", "M", "new.txt", { originalPath: "old.txt" }),
      change("C", " ", "copy.txt", { originalPath: "original.txt" }),
      change(" ", "T"),
      change("A", "A"),
      change("U", "U"),
    ]),
  );
  const text = render(result);
  assert.match(text, /Modified \[Staged\].*Modified \[Unstaged\]/);
  assert.match(
    text,
    /Renamed \[Staged\].*Modified \[Unstaged\].*"old.txt" → "new.txt"/,
  );
  assert.match(text, /Copied \[Staged\].*"original.txt" → "copy.txt"/);
  assert.match(text, /Type changed \[Unstaged\]/);
  assert.equal((text.match(/Unmerged/g) ?? []).length, 2);
});

test("escapes terminal controls and preserves special path boundaries", async () => {
  const path = "space | [name]\n\t\u001b[31m\u009b31m\u202efile.txt";
  const result = await execute({
    branch: "topic\u202e",
    changes: [change("?", "?", path)],
  });
  const text = render(result);
  for (const control of ["\u001b", "\u009b", "\u202e"]) {
    assert.equal(text.includes(control), false);
  }
  assert.match(text, /space \| \[name\]\\n\\t\\u001b/);
  assert.ok(text.includes("\\u{9b}"));
  assert.ok(text.includes("\\u{202e}"));
  assert.equal(result.details.changes[0].path, path);
});

for (const mode of ["rpc", "json", "print"]) {
  test(`${mode} mode receives a plain-text list without ANSI`, async () => {
    const result = await execute(state([change("?", "?")]), mode);
    assert.match(result.content[0].text, /● Untracked.*"file.txt"/);
    assert.equal(result.content[0].text.includes("\u001b"), false);
  });
}

test("handles clean and detached states and uses the current renderer theme", async () => {
  const clean = await execute({ branch: null, changes: [] });
  assert.match(render(clean), /detached HEAD.*0 files\nNo changes/);
  const result = await execute(state([change("?", "?")]));
  assert.match(render(result, "first-"), /<first-mdLink>/);
  assert.match(render(result, "second-"), /<second-mdLink>/);
  assert.equal(
    tool.renderResult({ content: [] }, {}, {}, { outputPad: 1 }).text,
    "Git status could not be displayed.",
  );
});

test("disables only this tool's colored shell and preserves output padding", async () => {
  assert.equal(tool.renderShell, "self");
  assert.equal(tool.renderCall({}, {}, { outputPad: 2 }).paddingX, 2);
  const result = await execute(state([change("?", "?")]));
  const rendered = tool.renderResult(
    result,
    {},
    { fg: (_color, text) => text },
    { outputPad: 2 },
  );
  assert.equal(rendered.paddingX, 2);
  assert.equal(rendered.paddingY, 0);
});

test("rejects malformed metadata without echoing invalid JSON", async () => {
  for (const input of [
    null,
    {},
    { branch: 42, changes: [] },
    { branch: "main", changes: null },
    state([null]),
    state([change(" ", " ")]),
    state([change("?", "M")]),
    state([change(["M"], " ")]),
    state([change("X", " ")]),
    state([change("A", " ", 42)]),
    state([change("R", " ", "new.txt", { originalPath: 42 })]),
  ]) {
    await assert.rejects(execute(input), /Invalid Git status metadata/);
  }
  await assert.rejects(
    tool.execute("display", { status: "SECRET_INVALID_JSON" }, null, null, {}),
    { message: "Invalid Git status metadata" },
  );
});
