from __future__ import annotations

import io
import re
import tarfile
import tempfile
import time
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, Response
from litemapy import BlockState, Region
from PIL import Image, UnidentifiedImageError


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CANVAS_SIZE = 128
COLOR_THRESHOLD = 123
BLACKSTONE = BlockState("minecraft:blackstone")
MAX_FILES = 512
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_BATCH_BYTES = 64 * 1024 * 1024
PUBLIC_FILES = frozenset({"index.html", "styles.css", "app.js", "core.js", "all.txt"})
WINDOWS_FORBIDDEN = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


class ProjectionError(ValueError):
    """Raised when an uploaded image cannot be converted safely."""


app = FastAPI(
    title="字格投影导出服务",
    description="Convert 128×128 black-and-white glyph canvases to Litematica projections.",
    version="1.0.0",
)


def safe_output_name(upload_name: str, index: int) -> str:
    """Keep the browser's Chinese filename while preventing archive paths."""
    basename = upload_name.replace("\\", "/").rsplit("/", 1)[-1].strip()
    stem = Path(basename).stem.strip()
    stem = WINDOWS_FORBIDDEN.sub("_", stem).rstrip(". ")
    if not stem:
        stem = f"投影_{index + 1}"
    return f"{stem}.litematic"


def png_to_litematic(png_data: bytes, schematic_name: str) -> bytes:
    """Convert one 128×128 PNG to an x/z projection at y=0."""
    try:
        with Image.open(io.BytesIO(png_data)) as source:
            if source.format != "PNG":
                raise ProjectionError("文件不是 PNG 图片")
            if source.size != (CANVAS_SIZE, CANVAS_SIZE):
                raise ProjectionError(
                    f"图片尺寸必须为 {CANVAS_SIZE}×{CANVAS_SIZE}，当前为 {source.width}×{source.height}"
                )

            source.load()
            rgba = source.convert("RGBA")
            white_background = Image.new("RGBA", source.size, "white")
            white_background.alpha_composite(rgba)
            grayscale = white_background.convert("L")
    except UnidentifiedImageError as error:
        raise ProjectionError("无法识别 PNG 图片") from error
    except OSError as error:
        raise ProjectionError("PNG 图片已损坏或无法读取") from error

    region = Region(0, 0, 0, CANVAS_SIZE, 1, CANVAS_SIZE)
    pixels = grayscale.load()

    # Image column maps to x. Image row maps to z. The only y layer is y=0.
    for z in range(CANVAS_SIZE):
        for x in range(CANVAS_SIZE):
            if pixels[x, z] <= COLOR_THRESHOLD:
                region[x, 0, z] = BLACKSTONE

    schematic = region.as_schematic(
        name=schematic_name,
        author="TgkRuobin-Github",
        description=(
            f"128x128 glyph projection; y=0; grayscale <= {COLOR_THRESHOLD} becomes "
            "minecraft:blackstone"
        ),
    )

    with tempfile.TemporaryDirectory(prefix="ziku-litematic-") as temp_directory:
        output_path = Path(temp_directory) / "projection.litematic"
        schematic.save(str(output_path))
        return output_path.read_bytes()


def build_projection_tar(files: list[tuple[str, bytes]]) -> bytes:
    archive_buffer = io.BytesIO()
    used_names: set[str] = set()

    with tarfile.open(fileobj=archive_buffer, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for index, (upload_name, png_data) in enumerate(files):
            output_name = safe_output_name(upload_name, index)
            base_stem = Path(output_name).stem
            suffix = 2
            while output_name.casefold() in used_names:
                output_name = f"{base_stem}_{suffix}.litematic"
                suffix += 1
            used_names.add(output_name.casefold())

            try:
                litematic_data = png_to_litematic(png_data, Path(output_name).stem)
            except ProjectionError as error:
                raise ProjectionError(f"{upload_name}: {error}") from error

            info = tarfile.TarInfo(name=output_name)
            info.size = len(litematic_data)
            info.mtime = int(time.time())
            info.mode = 0o644
            archive.addfile(info, io.BytesIO(litematic_data))

    return archive_buffer.getvalue()


@app.get("/api/health")
def health() -> dict[str, int | str]:
    return {
        "status": "ok",
        "canvas_size": CANVAS_SIZE,
        "layers": 1,
        "y": 0,
        "threshold": COLOR_THRESHOLD,
        "block": "minecraft:blackstone",
    }


@app.post("/api/export-litematics")
async def export_litematics(files: list[UploadFile] = File(...)) -> Response:
    if not files:
        raise HTTPException(status_code=400, detail="没有收到待转换的图片")
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=413, detail=f"一次最多转换 {MAX_FILES} 个字符")

    uploaded: list[tuple[str, bytes]] = []
    total_bytes = 0
    for index, upload in enumerate(files):
        try:
            data = await upload.read(MAX_FILE_BYTES + 1)
        finally:
            await upload.close()

        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail=f"第 {index + 1} 张图片超过 2 MiB")
        total_bytes += len(data)
        if total_bytes > MAX_BATCH_BYTES:
            raise HTTPException(status_code=413, detail="上传图片总大小超过 64 MiB")
        uploaded.append((upload.filename or f"投影_{index + 1}.png", data))

    try:
        archive = await run_in_threadpool(build_projection_tar, uploaded)
    except ProjectionError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    archive_name = f"字符投影_{time.strftime('%Y%m%d_%H%M%S')}.tar"
    disposition = f"attachment; filename*=UTF-8''{quote(archive_name)}"
    return Response(
        content=archive,
        media_type="application/x-tar",
        headers={"Content-Disposition": disposition},
    )


@app.get("/")
def index() -> FileResponse:
    return FileResponse(PROJECT_ROOT / "index.html")


@app.get("/{file_name}")
def public_file(file_name: str) -> FileResponse:
    if file_name not in PUBLIC_FILES:
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(PROJECT_ROOT / file_name)
