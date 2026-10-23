import { Type } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";

const states = {
  M: ["Modified", "warning"],
  "?": ["Untracked", "mdLink"],
  A: ["Added", "success"],
  D: ["Deleted", "error"],
  R: ["Renamed", "accent"],
  C: ["Copied", "accent"],
  T: ["Type changed", "warning"],
  U: ["Unmerged", "error"],
  "!": ["Ignored", "muted"],
};
const conflicts = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function parseStatus(json) {
  let status;
  try {
    status = JSON.parse(json);
  } catch {
    throw new Error("Invalid Git status metadata");
  }
  if (
    !status ||
    (status.branch !== null && typeof status.branch !== "string") ||
    !Array.isArray(status.changes) ||
    status.changes.some(
      (change) =>
        !change ||
        typeof change.path !== "string" ||
        typeof change.index !== "string" ||
        typeof change.worktree !== "string" ||
        !/^[ MADRCUT?!]$/.test(change.index) ||
        !/^[ MADRCUT?!]$/.test(change.worktree) ||
        change.index + change.worktree === "  " ||
        (/[?!]/.test(change.index + change.worktree) &&
          !["??", "!!"].includes(change.index + change.worktree)) ||
        (change.originalPath !== undefined &&
          typeof change.originalPath !== "string"),
    )
  ) {
    throw new Error("Invalid Git status metadata");
  }
  return status;
}

function quoted(value) {
  return JSON.stringify(value).replace(
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
    (character) => `\\u{${character.codePointAt(0).toString(16)}}`,
  );
}

function statusText(status, fg) {
  const badge = (code, scope = "") => {
    const [label, color] = states[code];
    return `${fg(color, "●")} ${label}${scope}`;
  };
  const lines = [
    `Branch: ${status.branch === null ? "(detached HEAD)" : quoted(status.branch)} — ${status.changes.length} files`,
  ];
  for (const change of status.changes) {
    const pair = change.index + change.worktree;
    let label;
    if (pair === "??" || pair === "!!") {
      label = badge(change.index);
    } else if (conflicts.has(pair)) {
      label = badge("U");
    } else {
      label = [
        change.index !== " " && badge(change.index, " [Staged]"),
        change.worktree !== " " && badge(change.worktree, " [Unstaged]"),
      ]
        .filter(Boolean)
        .join(" / ");
    }
    const path =
      change.originalPath === undefined
        ? quoted(change.path)
        : `${quoted(change.originalPath)} → ${quoted(change.path)}`;
    lines.push(`${label}  ${path}`);
  }
  if (status.changes.length === 0) lines.push("No changes.");
  return lines.join("\n");
}

export default function (pi) {
  pi.registerTool({
    name: "commit_status_display",
    label: "Git status",
    exposure: "model-only",
    renderShell: "self",
    description:
      "Display Git status metadata with themed text dots, without running Git or changing files. Pass the original git-status.py JSON string. Approval and checks remain separate.",
    parameters: Type.Object({ status: Type.String() }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    async execute(_id, { status: json }, _signal, _onUpdate, ctx) {
      const status = parseStatus(json);
      return {
        content: [
          {
            type: "text",
            text:
              ctx.mode === "tui"
                ? `Git状態一覧を表示しました（${status.changes.length}件）。同じ一覧のMarkdown表は不要です。承認は別途必要です。`
                : statusText(status, (_color, text) => text),
          },
        ],
        details: status,
      };
    },
    renderCall(_args, _theme, context) {
      return new Text("Git status", context.outputPad, 0);
    },
    renderResult(result, _options, theme, context) {
      if (!result.details) {
        return new Text(
          "Git status could not be displayed.",
          context.outputPad,
          0,
        );
      }
      return new Text(
        statusText(result.details, (color, text) => theme.fg(color, text)),
        context.outputPad,
        0,
      );
    },
  });
}
