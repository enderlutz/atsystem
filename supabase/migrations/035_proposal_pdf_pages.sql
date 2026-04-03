-- Pre-rasterized PDF page images for fast serving
-- Each page stored as a small JPEG (~200-400KB) instead of serving the 4.7MB PDF blob
CREATE TABLE IF NOT EXISTS proposal_pdf_pages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    token       TEXT NOT NULL,
    page_num    INTEGER NOT NULL,
    image_data  BYTEA NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposal_pdf_pages_token_page
  ON proposal_pdf_pages(token, page_num);

-- Add page count to proposals for quick lookup without joining
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS pdf_page_count INTEGER;
