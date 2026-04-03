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
            fontname="helv",  # Helvetica — built into every PDF viewer
            color=(0.17, 0.17, 0.17),  # #2C2C2C dark gray
        )

    result = doc.tobytes()
    doc.close()
    return result
