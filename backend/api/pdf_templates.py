"""PDF template management — upload, rasterize pages, map fields, preview."""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

import fitz  # PyMuPDF
import psycopg2
from fastapi import APIRouter, File, HTTPException, UploadFile, Depends
from fastapi.responses import Response
from pydantic import BaseModel

from db import get_conn, get_db
from api.auth import require_admin
from services.pdf_generator import generate_filled_pdf

router = APIRouter(prefix="/api/pdf-templates", tags=["pdf-templates"])
logger = logging.getLogger(__name__)

MAX_FILE_SIZE = 15 * 1024 * 1024  # 15 MB


# ── Models ──────────────────────────────────────────────────────────────

class FieldMapUpdate(BaseModel):
    field_map: dict


# ── Helpers ─────────────────────────────────────────────────────────────

def _get_template_row(conn, include_data: bool = False):
    """Fetch the single global template row. Returns None if no template."""
    cols = "id, filename, page_count, page_widths, page_heights, field_map, created_at, updated_at"
    if include_data:
        cols = "id, pdf_data, filename, page_count, page_widths, page_heights, field_map, created_at, updated_at"
    with conn.cursor() as cur:
        cur.execute(f"SELECT {cols} FROM pdf_templates LIMIT 1")
        row = cur.fetchone()
    if not row:
        return None
    col_names = [c.strip() for c in cols.split(",")]
    return dict(zip(col_names, row))


# ── Endpoints ───────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_template(file: UploadFile = File(...), _user: dict = Depends(require_admin)):
    """Upload a PDF template. Replaces the current global template."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    pdf_bytes = await file.read()
    if len(pdf_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"File too large (max {MAX_FILE_SIZE // 1024 // 1024}MB)")

    # Validate PDF, extract page info, and compress
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page_count = len(doc)
        page_widths = [round(doc[i].rect.width, 2) for i in range(page_count)]
        page_heights = [round(doc[i].rect.height, 2) for i in range(page_count)]
        # Compress: deflate streams, garbage-collect, deduplicate images
        original_size = len(pdf_bytes)
        pdf_bytes = doc.tobytes(garbage=4, deflate=True, clean=True)
        doc.close()
        logger.info(f"PDF template compressed: {original_size // 1024}KB → {len(pdf_bytes) // 1024}KB")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid PDF file: {e}")

    template_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    with get_conn() as conn:
        with conn.cursor() as cur:
            # Single global template — delete existing, insert new
            cur.execute("DELETE FROM pdf_templates")
            cur.execute(
                """INSERT INTO pdf_templates (id, pdf_data, filename, page_count, page_widths, page_heights, field_map, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, '{}', %s, %s)""",
                (template_id, psycopg2.Binary(pdf_bytes), file.filename, page_count,
                 psycopg2.extras.Json(page_widths), psycopg2.extras.Json(page_heights),
                 now, now),
            )

    return {
        "status": "uploaded",
        "id": template_id,
        "filename": file.filename,
        "page_count": page_count,
        "page_widths": page_widths,
        "page_heights": page_heights,
    }


@router.get("/current")
async def get_current_template(_user: dict = Depends(require_admin)):
    """Get metadata for the current global template (no binary data)."""
    with get_conn() as conn:
        row = _get_template_row(conn, include_data=False)

    if not row:
        raise HTTPException(status_code=404, detail="No PDF template uploaded")

    return {
        "id": str(row["id"]),
        "filename": row["filename"],
        "page_count": row["page_count"],
        "page_widths": row["page_widths"],
        "page_heights": row["page_heights"],
        "field_map": row["field_map"] or {},
        "updated_at": row["updated_at"].isoformat() if hasattr(row["updated_at"], "isoformat") else str(row["updated_at"]),
    }


@router.get("/page/{page_num}")
async def get_template_page(page_num: int, _user: dict = Depends(require_admin)):
    """Rasterize a single page of the template to PNG at 2x resolution."""
    with get_conn() as conn:
        row = _get_template_row(conn, include_data=True)

    if not row:
        raise HTTPException(status_code=404, detail="No PDF template uploaded")

    pdf_bytes = bytes(row["pdf_data"])

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to open template PDF")

    if page_num < 0 or page_num >= len(doc):
        doc.close()
        raise HTTPException(status_code=404, detail=f"Page {page_num} not found (template has {len(doc)} pages)")

    page = doc[page_num]
    mat = fitz.Matrix(2, 2)  # 2x zoom for retina clarity
    pix = page.get_pixmap(matrix=mat)
    png_bytes = pix.tobytes("png")
    doc.close()

    return Response(content=png_bytes, media_type="image/png")


@router.put("/field-map")
async def save_field_map(body: FieldMapUpdate, _user: dict = Depends(require_admin)):
    """Save field coordinate mappings for the current template."""
    db = get_db()
    existing = db.table("pdf_templates").select("id").execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="No PDF template uploaded")

    template_id = existing.data[0]["id"]
    now = datetime.now(timezone.utc).isoformat()
    db.table("pdf_templates").update({
        "field_map": body.field_map,
        "updated_at": now,
    }).eq("id", template_id).execute()

    return {"status": "saved"}


@router.post("/compress")
async def compress_existing_template(_user: dict = Depends(require_admin)):
    """Compress the current template in-place."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, pdf_data FROM pdf_templates LIMIT 1")
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="No template uploaded")

            template_id, raw = row
            original = bytes(raw)
            doc = fitz.open(stream=original, filetype="pdf")
            compressed = doc.tobytes(garbage=4, deflate=True, clean=True)
            doc.close()

            cur.execute(
                "UPDATE pdf_templates SET pdf_data = %s, updated_at = NOW() WHERE id = %s",
                (psycopg2.Binary(compressed), template_id),
            )

    return {
        "status": "compressed",
        "original_kb": len(original) // 1024,
        "compressed_kb": len(compressed) // 1024,
        "saved_pct": round((1 - len(compressed) / len(original)) * 100, 1),
    }


@router.delete("")
async def delete_template(_user: dict = Depends(require_admin)):
    """Delete the current global template."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM pdf_templates")
    return {"status": "deleted"}


@router.post("/preview")
async def preview_with_sample_data(_user: dict = Depends(require_admin)):
    """Generate a preview PDF with sample data to verify field placements."""
    with get_conn() as conn:
        row = _get_template_row(conn, include_data=True)

    if not row:
        raise HTTPException(status_code=404, detail="No PDF template uploaded")

    field_map = row["field_map"] or {}
    if not field_map:
        raise HTTPException(status_code=400, detail="No fields mapped yet. Map fields first.")

    sample_values = {
        "customer_name": "Jane Smith",
        "essential_price": "$1,200",
        "signature_price": "$1,500",
        "legacy_price": "$1,900",
        "essential_monthly": "$57/mo",
        "signature_monthly": "$71/mo",
        "legacy_monthly": "$90/mo",
    }

    pdf_bytes = bytes(row["pdf_data"])
    filled = generate_filled_pdf(pdf_bytes, field_map, sample_values)

    return Response(
        content=filled,
        media_type="application/pdf",
        headers={"Content-Disposition": "inline; filename=preview-sample.pdf"},
    )
