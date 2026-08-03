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

    return `${stem}${suffix}.litematic`;
  });
}
