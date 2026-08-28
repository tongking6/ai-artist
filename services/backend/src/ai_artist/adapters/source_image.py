from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError


class InvalidSourceImageError(ValueError):
    pass


@dataclass(frozen=True)
class NormalizedSourceImage:
    body: bytes
    media_type: str
    extension: str
    was_mpo: bool


def normalize_source_image(photo: bytes) -> NormalizedSourceImage:
    """Validate source bytes and turn an MPO primary frame into a standard JPEG."""
    try:
        with Image.open(io.BytesIO(photo)) as image:
            image_format = image.format
            image.load()
            if image_format == "MPO":
                output = io.BytesIO()
                ImageOps.exif_transpose(image).convert("RGB").save(output, format="JPEG")
                return NormalizedSourceImage(
                    body=output.getvalue(),
                    media_type="image/jpeg",
                    extension="jpg",
                    was_mpo=True,
                )
    except (Image.DecompressionBombError, OSError, SyntaxError, UnidentifiedImageError) as error:
        raise InvalidSourceImageError("Source photo is not a valid JPEG or PNG image.") from error

    if image_format == "JPEG":
        return NormalizedSourceImage(
            body=photo,
            media_type="image/jpeg",
            extension="jpg",
            was_mpo=False,
        )
    if image_format == "PNG":
        return NormalizedSourceImage(
            body=photo,
            media_type="image/png",
            extension="png",
            was_mpo=False,
        )
    raise InvalidSourceImageError("Source photo is not a valid JPEG or PNG image.")
