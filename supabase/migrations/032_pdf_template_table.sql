-- PDF template storage (single global template for PDF proposal generation)
CREATE TABLE IF NOT EXISTS pdf_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pdf_data    BYTEA NOT NULL,
    filename    TEXT NOT NULL,
    page_count  INTEGER NOT NULL DEFAULT 1,
    page_widths  JSONB NOT NULL DEFAULT '[]',   -- [612.0, 612.0, ...] per-page width in pts
    page_heights JSONB NOT NULL DEFAULT '[]',   -- [792.0, 792.0, ...] per-page height in pts
    field_map   JSONB NOT NULL DEFAULT '{}',
    -- field_map structure:
    -- { "customer_name": { "page": 0, "x": 120.5, "y": 340.2, "font_size": 12 }, ... }
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
