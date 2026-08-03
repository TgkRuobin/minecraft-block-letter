import assert from "node:assert/strict";
import test from "node:test";
import { buildFileNames, filenameStemForCharacter, segmentCharacters } from "../core.js";

test("segments graphemes, ignores line separators, and removes duplicates", () => {
  const result = segmentCharacters("A\nA\t中🙂\r\n");
  assert.deepEqual(result.characters, ["A", "中", "🙂"]);
  assert.equal(result.duplicateCount, 1);
});

test("uses Chinese descriptions for punctuation filenames", () => {
  assert.equal(filenameStemForCharacter("!"), "感叹号");
  assert.equal(filenameStemForCharacter("/"), "斜杠");
  assert.equal(filenameStemForCharacter("…"), "省略号");
  assert.deepEqual(buildFileNames(["A", "!", "/"]), [
    "大写字母A.litematic",
    "感叹号.litematic",
    "斜杠.litematic",
  ]);
});

test("distinguishes uppercase and lowercase filenames on Windows", () => {
  assert.deepEqual(buildFileNames(["A", "a", "Z", "z"]), [
    "大写字母A.litematic",
    "小写字母a.litematic",
    "大写字母Z.litematic",
    "小写字母z.litematic",
  ]);
});
