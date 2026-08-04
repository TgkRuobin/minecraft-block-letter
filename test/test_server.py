import io
import itertools
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from litemapy import Schematic
from PIL import Image

from server.app import (
    CANVAS_SIZE,
    EXACT_ORDER_LIMIT,
    bitmap_to_litematic,
    build_distance_matrix,
    build_projection_tar,
    find_low_cost_order,
    png_to_bitmap,
    route_cost,
)


def make_png(dark_pixels):
    image = Image.new("L", (CANVAS_SIZE, CANVAS_SIZE), 255)
    for x, y, value in dark_pixels:
        image.putpixel((x, y), value)
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


class ProjectionOrderingTests(unittest.TestCase):
    def test_bitmap_uses_the_export_threshold(self):
        bitmap = png_to_bitmap(
            make_png(
                [
                    (0, 0, 0),
                    (1, 0, 123),
                    (2, 0, 124),
                ]
            )
        )

        self.assertEqual(bitmap[0], 0b11000000)

    def test_small_batch_order_has_the_global_minimum_cost(self):
        masks = [0b0000, 0b0001, 0b0011, 0b1111, 0b0111, 0b0101]
        distances = build_distance_matrix(masks)
        order = find_low_cost_order(masks)
        optimum = min(
            route_cost(candidate, distances)
            for candidate in itertools.permutations(range(len(masks)))
        )

        self.assertLessEqual(len(masks), EXACT_ORDER_LIMIT)
        self.assertEqual(route_cost(order, distances), optimum)
        self.assertEqual(sorted(order), list(range(len(masks))))

    def test_large_batch_order_is_a_complete_deterministic_path(self):
        masks = [index * 0x9E3779B1 for index in range(EXACT_ORDER_LIMIT + 3)]

        first = find_low_cost_order(masks)
        second = find_low_cost_order(masks)

        self.assertEqual(first, second)
        self.assertEqual(sorted(first), list(range(len(masks))))

    def test_bitmap_conversion_preserves_projection_orientation(self):
        bitmap = bytearray(CANVAS_SIZE * CANVAS_SIZE // 8)
        bitmap[0] = 0b10000000
        bitmap[-1] = 0b00000001
        litematic_data = bitmap_to_litematic(bytes(bitmap), "orientation-check")

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "orientation-check.litematic"
            path.write_bytes(litematic_data)
            schematic = Schematic.load(str(path))

        region = next(iter(schematic.regions.values()))
        self.assertEqual(region[0, 0, 0].id, "minecraft:blackstone")
        self.assertEqual(region[127, 0, 127].id, "minecraft:blackstone")
        self.assertEqual(region[1, 0, 0].id, "minecraft:air")
        self.assertEqual((region.width, region.height, region.length), (128, 1, 128))

    def test_tar_members_follow_route_and_use_numbered_names(self):
        files = [
            ("甲.png", make_png([(0, 0, 0)])),
            ("乙.png", make_png([(0, 0, 0), (1, 0, 0)])),
            ("丙.png", make_png([(0, 0, 0), (1, 0, 0), (2, 0, 0)])),
        ]

        with patch("server.app.bitmap_to_litematic", return_value=b"projection"):
            archive_data = build_projection_tar(files)

        with tarfile.open(fileobj=io.BytesIO(archive_data), mode="r:") as archive:
            names = archive.getnames()

        masks = [int.from_bytes(png_to_bitmap(data), "big") for _, data in files]
        order = find_low_cost_order(masks)
        expected_names = [
            f"{sequence}是{Path(files[index][0]).stem}.litematic"
            for sequence, index in enumerate(order, start=1)
        ]
        self.assertEqual(names, expected_names)


if __name__ == "__main__":
    unittest.main()
