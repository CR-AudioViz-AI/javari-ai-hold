-- Migration: Auto-Update Triggers
-- Generated: 2026-02-28T03:35:36.875469
-- Purpose: Automatic timestamp and cascade operations

-- Update timestamps trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Apply to canonical_documents
DROP TRIGGER IF EXISTS update_canonical_documents_updated_at ON canonical_documents;
CREATE TRIGGER update_canonical_documents_updated_at
  BEFORE UPDATE ON canonical_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Apply to memory_nodes
DROP TRIGGER IF EXISTS update_memory_nodes_updated_at ON memory_nodes;
CREATE TRIGGER update_memory_nodes_updated_at
  BEFORE UPDATE ON memory_nodes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
