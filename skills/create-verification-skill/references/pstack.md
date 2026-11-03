# pstack の出典・改変方針と MIT License

## 固定出典

Cursor の `cursor/plugins` repository、revision `c742dd61706fbacc1b95f1a20b7b988cf096ce6c` を基準とする。

- [Prove It Works](https://github.com/cursor/plugins/blob/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/principle-prove-it-works/SKILL.md)
- [Create Verification Skill](https://github.com/cursor/plugins/blob/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/create-verification-skill/SKILL.md)
- [Maintain Verification Skill](https://github.com/cursor/plugins/blob/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/skills/maintain-verification-skill/SKILL.md)
- [pstack/LICENSE](https://github.com/cursor/plugins/blob/c742dd61706fbacc1b95f1a20b7b988cf096ce6c/pstack/LICENSE)

## 転用・改変範囲

実物の直接確認、再実行できる手順と必要な helper、Feature Map、Create の少なくとも一機能の実操作確認、証拠の保持、安全な cleanup の原則を転用し、日本語の Pi 向け手順に改変した。Maintain の全 Map 点検と、検証資産の劣化・製品不具合・前提不足を区別する考え方も参照したが、共通 Maintain Skill はこの配布では未提供。

配置は Pi の project Skill に合わせ、既存の規約・検証資産を優先する。固定件数のない単一 Markdown の Map と、run ごとの観測記録を分離する。通常の関連変更では必要箇所だけ更新・再実行する。証拠の保存には対象 repository の既存ルールを優先し、なければ `.pi/verification-evidence/<run>/` を使い、機密性・最小取得・Git 管理対象外の方針を加えた。通常テスト・承認・最終受入判断は置き換えない。

Cursor 固有配置、固定3–5機能、強制並列 source readers、branch / PR 自動化は転用しない。subagent package、独自 runner・registry、隣接 checkout を実行要件にしない。

この通知と以下の MIT License 全文は、生成した検証 Skill の `references/pstack.md` にも同梱する。生成 Skill から相対参照し、配布元や会話履歴がなくても出典・通知が読める状態を保つ。既存の通知を削除しない。転用 Skill の license は MIT とし、`pi-skills` repository 全体の ISC 表記は変更しない。

## MIT License

```text
MIT License

Copyright (c) 2026 Lauren Tan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
