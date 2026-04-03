-- Add PDF data storage and proposal version tracking to proposals table
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS pdf_data BYTEA;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS proposal_version TEXT DEFAULT 'v1';
