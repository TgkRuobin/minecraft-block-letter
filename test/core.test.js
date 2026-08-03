import assert from "node:assert/strict";
import test from "node:test";
import { buildFileNames, createTar, filenameStemForCharacter, segmentCharacters } from "../core.js";

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
    "大写字母A.png",
    "感叹号.png",
    "斜杠.png",
  ]);
});

test("distinguishes uppercase and lowercase filenames on Windows", () => {
  assert.deepEqual(buildFileNames(["A", "a", "Z", "z"]), [
    "大写字母A.png",
    "小写字母a.png",
    "大写字母Z.png",
    "小写字母z.png",
  ]);
});

test("keeps TAR entries aligned and writes a valid ustar header", () => {
  const tar = createTar(
    [
      { name: "A.png", data: new Uint8Array([1, 2, 3]) },
      { name: "感叹号.png", data: new Uint8Array(520).fill(7) },
    ],
    0,
  );

  const decoder = new TextDecoder();
  assert.equal(decoder.decode(tar.slice(0, 5)), "A.png");
  assert.equal(decoder.decode(tar.slice(257, 263)), "ustar\0");
  assert.equal(tar.byteLength % 512, 0);
  assert.deepEqual([...tar.slice(-1024)], new Array(1024).fill(0));
});
