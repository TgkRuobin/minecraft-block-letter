import { buildFileNames, segmentCharacters } from "./core.js";

const CANVAS_SIZE = 128;
const DEFAULT_TEXT_FILE = "./all.txt";
const DEFAULT_STYLE = Object.freeze({
  fontSize: 88,
  fontWeight: 400,
  boldness: 0,
  italic: false,
  scaleX: 100,
  scaleY: 100,
  offsetX: 0,
  offsetY: 0,
});

const state = {
  characters: [],
  fileNames: [],
  duplicateCount: 0,
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
  fontDisplayName: "系统默认字体",
  fontObjectUrl: null,
  fontFace: null,
  renderToken: 0,
  exporting: false,
  style: { ...DEFAULT_STYLE },
};

const elements = {
  textFile: document.querySelector("#text-file"),
  textFileName: document.querySelector("#text-file-name"),
  textFileStatus: document.querySelector("#text-file-status"),
  fontFile: document.querySelector("#font-file"),
  fontFileName: document.querySelector("#font-file-name"),
  fontFileStatus: document.querySelector("#font-file-status"),
  glyphGrid: document.querySelector("#glyph-grid"),
  emptyState: document.querySelector("#empty-state"),
  characterCount: document.querySelector("#character-count"),
  duplicateCount: document.querySelector("#duplicate-count"),
  exportButton: document.querySelector("#export-button"),
  exportSummaryTitle: document.querySelector("#export-summary-title"),
  exportSummaryDetail: document.querySelector("#export-summary-detail"),
  exportProgress: document.querySelector("#export-progress"),
  exportProgressText: document.querySelector("#export-progress-text"),
  exportProgressBar: document.querySelector("#export-progress-bar"),
  resetStyle: document.querySelector("#reset-style"),
  toast: document.querySelector("#toast"),
};

const controlDefinitions = [
  { id: "font-size", key: "fontSize", suffix: " px" },
  { id: "font-weight", key: "fontWeight", suffix: "" },
  { id: "boldness", key: "boldness", suffix: " px" },
  { id: "scale-x", key: "scaleX", suffix: "%" },
  { id: "scale-y", key: "scaleY", suffix: "%" },
  { id: "offset-x", key: "offsetX", suffix: " px" },
  { id: "offset-y", key: "offsetY", suffix: " px" },
];

let renderTimer = 0;
let toastTimer = 0;

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 2800);
}

function updateOutput(definition) {
  const output = document.querySelector(`#${definition.id}-output`);
  output.value = `${state.style[definition.key]}${definition.suffix}`;
  output.textContent = output.value;
}

function syncControlsFromState() {
  for (const definition of controlDefinitions) {
    const input = document.querySelector(`#${definition.id}`);
    input.value = state.style[definition.key];
    updateOutput(definition);
  }
  document.querySelector("#italic").checked = state.style.italic;
}

function drawGlyph(canvas, character) {
  const context = canvas.getContext("2d", { alpha: false });
  const { fontSize, fontWeight, boldness, italic, scaleX, scaleY, offsetX, offsetY } = state.style;

  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  context.fillStyle = "#000000";
  context.strokeStyle = "#000000";
  context.lineJoin = "round";
  context.miterLimit = 2;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.font = `${fontWeight} ${fontSize}px ${state.fontFamily}`;

  const metrics = context.measureText(character);
  const ascent = Number.isFinite(metrics.actualBoundingBoxAscent)
    ? metrics.actualBoundingBoxAscent
    : fontSize * 0.8;
  const descent = Number.isFinite(metrics.actualBoundingBoxDescent)
    ? metrics.actualBoundingBoxDescent
    : fontSize * 0.2;
  const baseline = (ascent - descent) / 2;
  const skew = italic ? -Math.tan((12 * Math.PI) / 180) : 0;

  context.save();
  context.translate(CANVAS_SIZE / 2 + offsetX, CANVAS_SIZE / 2 + offsetY);
  context.transform(scaleX / 100, 0, skew, scaleY / 100, 0, 0);
  if (boldness > 0) {
    context.lineWidth = boldness * 2;
    context.strokeText(character, 0, baseline);
  }
  context.fillText(character, 0, baseline);
  context.restore();
}

function renderGrid() {
  const token = ++state.renderToken;
  const cards = elements.glyphGrid.querySelectorAll(".glyph-card");
  let index = 0;

  function renderBatch() {
    if (token !== state.renderToken) return;
    const end = Math.min(index + 48, cards.length);
    for (; index < end; index += 1) {
      drawGlyph(cards[index].querySelector("canvas"), state.characters[index]);
    }
    if (index < cards.length) requestAnimationFrame(renderBatch);
  }

  requestAnimationFrame(renderBatch);
}

function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(renderGrid, 24);
}

function buildGrid() {
  elements.glyphGrid.replaceChildren();
  const fragment = document.createDocumentFragment();

  state.characters.forEach((character, index) => {
    const card = document.createElement("figure");
    const canvas = document.createElement("canvas");
    const caption = document.createElement("figcaption");
    card.className = "glyph-card";
    card.title = `${character === " " ? "空格" : character} → ${state.fileNames[index]}`;
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    canvas.setAttribute("aria-label", `${character} 的投影预览`);
    caption.textContent = state.fileNames[index];
    card.append(canvas, caption);
    fragment.append(card);
  });

  elements.glyphGrid.append(fragment);
  elements.emptyState.hidden = state.characters.length > 0;
  elements.glyphGrid.hidden = state.characters.length === 0;
  elements.characterCount.textContent = `${state.characters.length} 个字符`;
  elements.duplicateCount.textContent = `已去重 ${state.duplicateCount} 个`;
  elements.exportButton.disabled = state.characters.length === 0 || state.exporting;
  elements.exportSummaryTitle.textContent = state.characters.length
    ? `已就绪 · ${state.characters.length} 份投影`
    : "等待字符载入";
  elements.exportSummaryDetail.textContent = state.characters.length
    ? `${state.fontDisplayName} · 128 × 1 × 128 方块`
    : "每份投影均为单层 128 × 128 区域";
  renderGrid();
}

function applyText(text, sourceName) {
  const result = segmentCharacters(text);
  state.characters = result.characters;
  state.duplicateCount = result.duplicateCount;
  state.fileNames = buildFileNames(state.characters);
  elements.textFileName.textContent = sourceName;
  elements.textFileStatus.textContent = state.characters.length
    ? `已读取 ${state.characters.length} 个唯一字符`
    : "文件中没有可绘制字符";
  buildGrid();
}

async function loadDefaultText() {
  try {
    const response = await fetch(DEFAULT_TEXT_FILE, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    applyText(await response.text(), "all.txt");
  } catch (error) {
    elements.textFileStatus.textContent = "自动读取失败，请手动选择文本文件";
    elements.emptyState.hidden = false;
    elements.glyphGrid.hidden = true;
    showToast("未能自动读取 all.txt。请通过本地服务器打开，或手动选择文本文件。");
    console.warn("Failed to load the default character file:", error);
  }
}

async function handleTextUpload(event) {
  const [file] = event.target.files;
  if (!file) return;
  try {
    applyText(await file.text(), file.name);
    showToast(`已载入 ${file.name}`);
  } catch (error) {
    elements.textFileStatus.textContent = "读取失败，请确认文件编码为 UTF-8";
    showToast("文本文件读取失败。");
    console.error(error);
  }
}

async function handleFontUpload(event) {
  const [file] = event.target.files;
  if (!file) return;

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!new Set(["ttf", "otf"]).has(extension)) {
    showToast("请选择 TTF 或 OTF 字体文件。");
    event.target.value = "";
    return;
  }

  elements.fontFileName.textContent = file.name;
  elements.fontFileStatus.textContent = "正在解析字体…";
  let objectUrl = null;

  try {
    objectUrl = URL.createObjectURL(file);
    const family = `UploadedGlyphFont_${Date.now()}`;
    const face = new FontFace(family, `url(${objectUrl})`);
    await face.load();

    if (state.fontFace) document.fonts.delete(state.fontFace);
    if (state.fontObjectUrl) URL.revokeObjectURL(state.fontObjectUrl);
    document.fonts.add(face);

    state.fontFace = face;
    state.fontObjectUrl = objectUrl;
    state.fontFamily = `"${family}"`;
    state.fontDisplayName = file.name;
    elements.fontFileStatus.textContent = "字体已生效，仅在本机内存中使用";
    elements.exportSummaryDetail.textContent = `${file.name} · 128 × 1 × 128 方块`;
    renderGrid();
    showToast(`字体已切换为 ${file.name}`);
  } catch (error) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    elements.fontFileName.textContent = state.fontDisplayName;
    elements.fontFileStatus.textContent = `字体解析失败，继续使用${state.fontDisplayName}`;
    showToast("无法载入该字体文件。");
    console.error(error);
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Canvas PNG encoding failed"));
    }, "image/png");
  });
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function setExportProgress(current, total) {
  const percentage = total === 0 ? 0 : Math.round((current / total) * 100);
  elements.exportProgressText.textContent = `正在生成画布 ${current} / ${total}`;
  elements.exportProgressBar.style.width = `${percentage}%`;
}

async function exportProjections() {
  if (state.exporting || state.characters.length === 0) return;
  state.exporting = true;
  elements.exportButton.disabled = true;
  elements.exportProgress.hidden = false;
  setExportProgress(0, state.characters.length);

  try {
    const formData = new FormData();
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = CANVAS_SIZE;
    exportCanvas.height = CANVAS_SIZE;

    for (let index = 0; index < state.characters.length; index += 1) {
      drawGlyph(exportCanvas, state.characters[index]);
      const blob = await canvasToBlob(exportCanvas);
      formData.append("files", blob, state.fileNames[index]);
      setExportProgress(index + 1, state.characters.length);
      if ((index + 1) % 24 === 0) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }

    elements.exportProgressText.textContent = "本地服务正在转换投影…";
    const response = await fetch("/api/export-litematics", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      let message = `投影服务返回 HTTP ${response.status}`;
      try {
        const body = await response.json();
        if (body.detail) message = body.detail;
      } catch {
        // Keep the HTTP status fallback when the response is not JSON.
      }
      throw new Error(message);
    }

    elements.exportProgressText.textContent = "正在下载投影 TAR…";
    const archive = await response.blob();
    const url = URL.createObjectURL(archive);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `字符投影_${formatTimestamp(new Date())}.tar`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    showToast(`已导出 ${state.characters.length} 份 Litematica 投影。`);
  } catch (error) {
    showToast(`导出失败：${error.message}`);
    console.error(error);
  } finally {
    state.exporting = false;
    elements.exportButton.disabled = state.characters.length === 0;
    window.setTimeout(() => {
      elements.exportProgress.hidden = true;
      elements.exportProgressBar.style.width = "0";
    }, 700);
  }
}

for (const definition of controlDefinitions) {
  const input = document.querySelector(`#${definition.id}`);
  input.addEventListener("input", () => {
    state.style[definition.key] = Number(input.value);
    updateOutput(definition);
    scheduleRender();
  });
}

document.querySelector("#italic").addEventListener("change", (event) => {
  state.style.italic = event.target.checked;
  scheduleRender();
});

elements.resetStyle.addEventListener("click", () => {
  state.style = { ...DEFAULT_STYLE };
  syncControlsFromState();
  renderGrid();
  showToast("字形参数已恢复默认值。");
});

elements.textFile.addEventListener("change", handleTextUpload);
elements.fontFile.addEventListener("change", handleFontUpload);
elements.exportButton.addEventListener("click", exportProjections);

window.addEventListener("beforeunload", () => {
  if (state.fontObjectUrl) URL.revokeObjectURL(state.fontObjectUrl);
});

syncControlsFromState();
loadDefaultText();
