from __future__ import annotations

import io
import re
import tarfile
import tempfile
import time
from collections.abc import Sequence
from dataclasses import dataclass
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
DARK_PIXEL_TABLE = tuple(255 if value <= COLOR_THRESHOLD else 0 for value in range(256))
EXACT_ORDER_LIMIT = 13
HEURISTIC_START_LIMIT = 8
TWO_OPT_MAX_PASSES = 12


class ProjectionError(ValueError):
    """Raised when an uploaded image cannot be converted safely."""


@dataclass(frozen=True)
class PreparedProjection:
    output_name: str
    bitmap: bytes
    mask: int


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


def png_to_bitmap(png_data: bytes) -> bytes:
    """Validate a PNG and return its thresholded, bit-packed dark-pixel mask."""
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
            dark_pixels = grayscale.point(DARK_PIXEL_TABLE).convert(
                "1",
                dither=Image.Dither.NONE,
            )
            return dark_pixels.tobytes()
    except UnidentifiedImageError as error:
        raise ProjectionError("无法识别 PNG 图片") from error
    except OSError as error:
        raise ProjectionError("PNG 图片已损坏或无法读取") from error


def bitmap_to_litematic(bitmap: bytes, schematic_name: str) -> bytes:
    """Convert one thresholded bitmap to an x/z projection at y=0."""
    row_bytes = (CANVAS_SIZE + 7) // 8
    if len(bitmap) != CANVAS_SIZE * row_bytes:
        raise ProjectionError("内部位图尺寸无效")

    region = Region(0, 0, 0, CANVAS_SIZE, 1, CANVAS_SIZE)

    # Image column maps to x. Image row maps to z. The only y layer is y=0.
    for z in range(CANVAS_SIZE):
        row_start = z * row_bytes
        for byte_column in range(row_bytes):
            byte_value = bitmap[row_start + byte_column]
            while byte_value:
                bit_offset = 8 - byte_value.bit_length()
                x = byte_column * 8 + bit_offset
                region[x, 0, z] = BLACKSTONE
                byte_value &= ~(0x80 >> bit_offset)

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


def png_to_litematic(png_data: bytes, schematic_name: str) -> bytes:
    """Convert one 128×128 PNG to an x/z projection at y=0."""
    return bitmap_to_litematic(png_to_bitmap(png_data), schematic_name)


def build_distance_matrix(masks: Sequence[int]) -> list[list[int]]:
    """Calculate all pairwise black/white Hamming distances."""
    count = len(masks)
    distances = [[0] * count for _ in range(count)]
    for left in range(count):
        for right in range(left + 1, count):
            distance = (masks[left] ^ masks[right]).bit_count()
            distances[left][right] = distance
            distances[right][left] = distance
    return distances


def route_cost(order: Sequence[int], distances: Sequence[Sequence[int]]) -> int:
    return sum(distances[left][right] for left, right in zip(order, order[1:]))


def canonicalize_order(order: Sequence[int]) -> list[int]:
    forward = tuple(order)
    backward = tuple(reversed(order))
    return list(min(forward, backward))


def exact_projection_order(distances: Sequence[Sequence[int]]) -> list[int]:
    """Find an optimal open Hamiltonian path with Held-Karp dynamic programming."""
    count = len(distances)
    if count < 2:
        return list(range(count))

    state_count = 1 << count
    infinity = float("inf")
    costs: list[list[int | float]] = [[infinity] * count for _ in range(state_count)]
    parents = [bytearray([255]) * count for _ in range(state_count)]

    for endpoint in range(count):
        costs[1 << endpoint][endpoint] = 0

    for mask in range(1, state_count):
        if mask & (mask - 1) == 0:
            continue

        endpoints = mask
        while endpoints:
            endpoint_bit = endpoints & -endpoints
            endpoint = endpoint_bit.bit_length() - 1
            previous_mask = mask ^ endpoint_bit
            previous_nodes = previous_mask
            best_cost: int | float = infinity
            best_parent = 255

            while previous_nodes:
                previous_bit = previous_nodes & -previous_nodes
                previous = previous_bit.bit_length() - 1
                candidate_cost = costs[previous_mask][previous] + distances[previous][endpoint]
                if candidate_cost < best_cost or (
                    candidate_cost == best_cost and previous < best_parent
                ):
                    best_cost = candidate_cost
                    best_parent = previous
                previous_nodes ^= previous_bit

            costs[mask][endpoint] = best_cost
            parents[mask][endpoint] = best_parent
            endpoints ^= endpoint_bit

    full_mask = state_count - 1
    endpoint = min(
        range(count),
        key=lambda candidate: (costs[full_mask][candidate], candidate),
    )
    order = []
    mask = full_mask
    while mask:
        order.append(endpoint)
        parent = parents[mask][endpoint]
        mask ^= 1 << endpoint
        if parent == 255:
            break
        endpoint = parent

    order.reverse()
    return canonicalize_order(order)


def greedy_multifragment_order(distances: Sequence[Sequence[int]]) -> list[int]:
    """Build a low-cost path by joining the globally cheapest path fragments."""
    count = len(distances)
    if count < 2:
        return list(range(count))

    edges = sorted(
        (distances[left][right], left, right)
        for left in range(count)
        for right in range(left + 1, count)
    )
    parents = list(range(count))
    ranks = [0] * count
    degrees = [0] * count
    neighbors: list[list[int]] = [[] for _ in range(count)]

    def find(node: int) -> int:
        while parents[node] != node:
            parents[node] = parents[parents[node]]
            node = parents[node]
        return node

    def union(left: int, right: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if ranks[left_root] < ranks[right_root]:
            left_root, right_root = right_root, left_root
        parents[right_root] = left_root
        if ranks[left_root] == ranks[right_root]:
            ranks[left_root] += 1

    selected = 0
    for _, left, right in edges:
        if degrees[left] == 2 or degrees[right] == 2 or find(left) == find(right):
            continue
        neighbors[left].append(right)
        neighbors[right].append(left)
        degrees[left] += 1
        degrees[right] += 1
        union(left, right)
        selected += 1
        if selected == count - 1:
            break

    start = min(index for index, degree in enumerate(degrees) if degree == 1)
    order = []
    previous = -1
    current = start
    while current != -1:
        order.append(current)
        following = [node for node in neighbors[current] if node != previous]
        previous, current = current, following[0] if following else -1
    return order


def nearest_neighbor_order(
    distances: Sequence[Sequence[int]],
    start: int,
) -> list[int]:
    count = len(distances)
    unvisited = [True] * count
    unvisited[start] = False
    order = [start]

    while len(order) < count:
        current = order[-1]
        following = min(
            (candidate for candidate in range(count) if unvisited[candidate]),
            key=lambda candidate: (distances[current][candidate], candidate),
        )
        unvisited[following] = False
        order.append(following)
    return order


def improve_order_two_opt(
    order: Sequence[int],
    distances: Sequence[Sequence[int]],
) -> list[int]:
    """Improve an open path by repeatedly applying its best 2-opt move."""
    improved = list(order)
    count = len(improved)

    for _ in range(TWO_OPT_MAX_PASSES):
        best_delta = 0
        best_move: tuple[int, int] | None = None

        for left in range(count - 1):
            for right in range(left + 1, count):
                if left == 0 and right == count - 1:
                    continue

                old_cost = 0
                new_cost = 0
                if left > 0:
                    old_cost += distances[improved[left - 1]][improved[left]]
                    new_cost += distances[improved[left - 1]][improved[right]]
                if right + 1 < count:
                    old_cost += distances[improved[right]][improved[right + 1]]
                    new_cost += distances[improved[left]][improved[right + 1]]

                delta = new_cost - old_cost
                if delta < best_delta:
                    best_delta = delta
                    best_move = (left, right)

        if best_move is None:
            break
        left, right = best_move
        improved[left : right + 1] = reversed(improved[left : right + 1])

    return canonicalize_order(improved)


def heuristic_projection_order(distances: Sequence[Sequence[int]]) -> list[int]:
    """Choose the best path from a global greedy seed and several local seeds."""
    count = len(distances)
    greedy_order = greedy_multifragment_order(distances)
    candidates = [improve_order_two_opt(greedy_order, distances)]

    row_sums = [sum(row) for row in distances]
    ranked_high = sorted(range(count), key=lambda index: (-row_sums[index], index))
    ranked_low = sorted(range(count), key=lambda index: (row_sums[index], index))
    starts: list[int] = []
    for start in (greedy_order[0], greedy_order[-1]):
        if start not in starts:
            starts.append(start)
    for high, low in zip(ranked_high, ranked_low):
        for start in (high, low):
            if start not in starts:
                starts.append(start)
            if len(starts) == min(HEURISTIC_START_LIMIT, count):
                break
        if len(starts) == min(HEURISTIC_START_LIMIT, count):
            break

    for start in starts:
        nearest_order = nearest_neighbor_order(distances, start)
        candidates.append(improve_order_two_opt(nearest_order, distances))

    return min(
        candidates,
        key=lambda order: (route_cost(order, distances), tuple(order)),
    )


def find_low_cost_order(masks: Sequence[int]) -> list[int]:
    """Return an exact small-batch order or a fast high-quality large-batch order."""
    distances = build_distance_matrix(masks)
    if len(masks) <= EXACT_ORDER_LIMIT:
        return exact_projection_order(distances)
    return heuristic_projection_order(distances)


def build_projection_tar(files: list[tuple[str, bytes]]) -> bytes:
    prepared: list[PreparedProjection] = []
    for index, (upload_name, png_data) in enumerate(files):
        output_name = safe_output_name(upload_name, index)
        try:
            bitmap = png_to_bitmap(png_data)
        except ProjectionError as error:
            raise ProjectionError(f"{upload_name}: {error}") from error
        prepared.append(
            PreparedProjection(
                output_name=output_name,
                bitmap=bitmap,
                mask=int.from_bytes(bitmap, "big"),
            )
        )

    order = find_low_cost_order([projection.mask for projection in prepared])
    archive_buffer = io.BytesIO()

    with tarfile.open(fileobj=archive_buffer, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for sequence, projection_index in enumerate(order, start=1):
            projection = prepared[projection_index]
            output_name = f"{sequence}是{projection.output_name}"
            litematic_data = bitmap_to_litematic(
                projection.bitmap,
                Path(output_name).stem,
            )

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
