"""Generate filled PDFs by overlaying text values onto a PDF template."""
from __future__ import annotations

import fitz  # PyMuPDF


def generate_filled_pdf(
    template_bytes: bytes,
    field_map: dict,
    values: dict,
) -> bytes:
    """Overlay text values onto a PDF template at mapped field positions.

    Args:
        template_bytes: Raw bytes of the PDF template.
        field_map: Mapping of field keys to placement info.
            Each value: {"page": int, "x": float, "y": float, "font_size": float}
            Coordinates are in PDF points (72 DPI), top-left origin (PyMuPDF native).
        values: Mapping of field keys to display strings.
            e.g. {"customer_name": "John Smith", "essential_price": "$1,200"}

    Returns:
        The filled PDF as bytes.
    """
    # Per-field color overrides (RGB tuples, 0-1 range)
    FIELD_COLORS: dict[str, tuple[float, float, float]] = {
        "legacy_price": (0.81, 0.62, 0.32),     # #cf9d52
        "legacy_monthly": (0.81, 0.62, 0.32),   # #cf9d52
    }
    DEFAULT_COLOR = (0.17, 0.17, 0.17)  # #2C2C2C dark gray

    doc = fitz.open(stream=template_bytes, filetype="pdf")

    for field_key, placement in field_map.items():
        value = values.get(field_key)
        if not value:
            continue

        page_num = int(placement.get("page", 0))
        if page_num < 0 or page_num >= len(doc):
            continue

        x = float(placement.get("x", 0))
        y = float(placement.get("y", 0))
        font_size = float(placement.get("font_size", 12))

        page = doc[page_num]
        page.insert_text(
            fitz.Point(x, y),
            str(value),
            fontsize=font_size,
            fontname="helv",
            color=FIELD_COLORS.get(field_key, DEFAULT_COLOR),
        )

    # Compress: deflate streams, garbage-collect unused objects, deduplicate images
    result = doc.tobytes(garbage=4, deflate=True, clean=True)
    doc.close()
    return result


def rasterize_pdf_pages(pdf_bytes: bytes, dpi_scale: float = 2.0, jpeg_quality: int = 80) -> list[bytes]:
    """Convert each page of a PDF to a JPEG image.

    Args:
        pdf_bytes: The PDF as bytes.
        dpi_scale: Zoom factor (2.0 = 144 DPI for sharp mobile display).
        jpeg_quality: JPEG compression quality (80 = good balance of size vs clarity).

    Returns:
        List of JPEG bytes, one per page. Typically ~200-400KB each.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    mat = fitz.Matrix(dpi_scale, dpi_scale)
    pages = []
    for i in range(len(doc)):
        pix = doc[i].get_pixmap(matrix=mat)
        pages.append(pix.tobytes("jpeg", jpg_quality=jpeg_quality))
    doc.close()
    return pages
