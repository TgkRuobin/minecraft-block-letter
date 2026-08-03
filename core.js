const punctuationNames = new Map([
  ["!", "感叹号"],
  ["@", "艾特符号"],
  ["#", "井号"],
  ["$", "美元符号"],
  ["%", "百分号"],
  ["^", "脱字符"],
  ["&", "与号"],
  ["*", "星号"],
  ["(", "左圆括号"],
  [")", "右圆括号"],
  ["-", "连字符"],
  ["_", "下划线"],
  ["+", "加号"],
  ["=", "等号"],
  [";", "分号"],
  [":", "冒号"],
  ["'", "单引号"],
  ['"', "双引号"],
  ["[", "左方括号"],
  ["]", "右方括号"],
  ["{", "左花括号"],
  ["}", "右花括号"],
  ["\\", "反斜杠"],
  ["|", "竖线"],
  ["/", "斜杠"],
  ["?", "问号"],
  ["<", "小于号"],
  [">", "大于号"],
  [",", "逗号"],
  [".", "句点"],
  ["`", "反引号"],
  ["~", "波浪号"],
  ["…", "省略号"],
  ["，", "逗号"],
  ["。", "句号"],
  ["、", "顿号"],
  ["；", "分号"],
  ["：", "冒号"],
  ["？", "问号"],
  ["！", "感叹号"],
  ["“", "左双引号"],
  ["”", "右双引号"],
  ["‘", "左单引号"],
  ["’", "右单引号"],
  ["（", "左圆括号"],
  ["）", "右圆括号"],
  ["【", "左方头括号"],
  ["】", "右方头括号"],
  ["《", "左书名号"],
  ["》", "右书名号"],
  ["〈", "左单书名号"],
  ["〉", "右单书名号"],
  ["〔", "左六角括号"],
  ["〕", "右六角括号"],
  ["［", "左方括号"],
  ["］", "右方括号"],
  ["｛", "左花括号"],
  ["｝", "右花括号"],
  ["—", "破折号"],
  ["–", "短破折号"],
  ["·", "间隔号"],
  ["•", "圆点"],
  ["￥", "人民币符号"],
  ["¥", "人民币符号"],
  ["€", "欧元符号"],
  ["£", "英镑符号"],
  ["°", "度数符号"],
  ["§", "章节号"],
  ["©", "版权符号"],
  ["®", "注册商标符号"],
  ["™", "商标符号"],
  [" ", "空格"],
  ["　", "全角空格"],
]);

const punctuationPattern = /\p{P}/u;
const forbiddenFilenamePattern = /[<>:"/\\|?*\u0000-\u001f]/u;

export function segmentCharacters(text) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const segments = typeof Intl !== "undefined" && Intl.Segmenter
    ? [...new Intl.Segmenter("zh-CN", { granularity: "grapheme" }).segment(normalized)].map(
        (part) => part.segment,
      )
    : Array.from(normalized);

  const drawable = segments.filter((character) => character !== "\n" && character !== "\t");
  const unique = [];
  const seen = new Set();

  for (const character of drawable) {
    if (!seen.has(character)) {
      seen.add(character);
      unique.push(character);
    }
  }

  return {
    characters: unique,
    duplicateCount: drawable.length - unique.length,
  };
}

function codePointLabel(character) {
  return Array.from(character)
    .map((part) => `U+${part.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`)
    .join("_");
}

export function filenameStemForCharacter(character) {
  if (/^[A-Z]$/.test(character)) {
    return `大写字母${character}`;
  }

  if (/^[a-z]$/.test(character)) {
    return `小写字母${character}`;
  }

  if (punctuationNames.has(character)) {
    return punctuationNames.get(character);
  }

  if (punctuationPattern.test(character) || forbiddenFilenamePattern.test(character)) {
    return `标点符号_${codePointLabel(character)}`;
  }

  const trimmed = character.replace(/[. ]+$/g, "");
  if (!trimmed || trimmed === "." || trimmed === "..") {
    return `字符_${codePointLabel(character)}`;
  }

  return character;
}

export function buildFileNames(characters) {
  const usedNames = new Map();

  return characters.map((character) => {
    const stem = filenameStemForCharacter(character);
    const normalized = stem.normalize("NFC");
    const useCount = usedNames.get(normalized) ?? 0;
    usedNames.set(normalized, useCount + 1);
    const suffix = useCount === 0 ? "" : `_${codePointLabel(character)}`;

    return `${stem}${suffix}.png`;
  });
}

function writeUtf8(target, offset, length, value) {
  const bytes = new TextEncoder().encode(value);
  target.set(bytes.slice(0, length), offset);
}

function writeOctal(target, offset, length, value) {
  const octal = Math.max(0, value).toString(8).padStart(length - 1, "0").slice(-(length - 1));
  writeUtf8(target, offset, length, `${octal}\0`);
}

function createTarHeader(name, size, modifiedTime) {
  const header = new Uint8Array(512);
  writeUtf8(header, 0, 100, name);
  writeOctal(header, 100, 8, 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, Math.floor(modifiedTime / 1000));

  for (let index = 148; index < 156; index += 1) {
    header[index] = 0x20;
  }

  header[156] = "0".charCodeAt(0);
  writeUtf8(header, 257, 6, "ustar\0");
  writeUtf8(header, 263, 2, "00");
  writeUtf8(header, 265, 32, "local");
  writeUtf8(header, 297, 32, "local");

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = checksum.toString(8).padStart(6, "0").slice(-6);
  writeUtf8(header, 148, 8, `${checksumText}\0 `);
  return header;
}

export function createTar(entries, modifiedTime = Date.now()) {
  const chunks = [];
  let totalSize = 1024;

  for (const entry of entries) {
    const data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
    const paddingSize = (512 - (data.byteLength % 512)) % 512;
    chunks.push(createTarHeader(entry.name, data.byteLength, modifiedTime), data);
    if (paddingSize) chunks.push(new Uint8Array(paddingSize));
    totalSize += 512 + data.byteLength + paddingSize;
  }

  chunks.push(new Uint8Array(1024));
  const tar = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    tar.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return tar;
}
