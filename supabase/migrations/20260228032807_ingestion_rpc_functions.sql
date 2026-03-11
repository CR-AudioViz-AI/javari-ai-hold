-- Migration: Create RPC functions for ingestion
-- Generated: 2026-02-27
-- Purpose: Direct SQL execution for canonical document ingestion

-- Enable pgvector if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- ═══════════════════════════════════════════════════════════════
-- RPC FUNCTION: insert_canonical_document
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION insert_canonical_document(
  p_id UUID,
  p_title TEXT,
  p_document_key TEXT,
  p_document_type TEXT,
  p_source_path TEXT,
  p_source_type TEXT,
  p_raw_content TEXT,
  p_content_hash TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb,
  p_version INTEGER DEFAULT 1,
  p_status TEXT DEFAULT 'indexed'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result UUID;
BEGIN
  INSERT INTO canonical_documents (
    id, title, document_key, document_type, source_path, source_type,
    raw_content, content_hash, metadata, version, status, indexed_at
  ) VALUES (
    p_id, p_title, p_document_key, p_document_type, p_source_path, p_source_type,
    p_raw_content, p_content_hash, p_metadata, p_version, p_status, NOW()
  )
  RETURNING id INTO v_result;
  
  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC FUNCTION: insert_canonical_chunk
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION insert_canonical_chunk(
  p_id UUID,
  p_document_id UUID,
  p_chunk_index INTEGER,
  p_chunk_text TEXT,
  p_chunk_hash TEXT,
  p_start_offset INTEGER DEFAULT 0,
  p_end_offset INTEGER DEFAULT 0,
  p_token_count INTEGER DEFAULT 0,
  p_section_title TEXT DEFAULT NULL,
  p_section_path TEXT[] DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result UUID;
BEGIN
  INSERT INTO canonical_chunks (
    id, document_id, chunk_index, chunk_text, chunk_hash,
    start_offset, end_offset, token_count, section_title, section_path, metadata
  ) VALUES (
    p_id, p_document_id, p_chunk_index, p_chunk_text, p_chunk_hash,
    p_start_offset, p_end_offset, p_token_count, p_section_title, p_section_path, p_metadata
  )
  RETURNING id INTO v_result;
  
  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC FUNCTION: insert_canonical_vector
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION insert_canonical_vector(
  p_id UUID,
  p_chunk_id UUID,
  p_embedding vector(1536)
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result UUID;
BEGIN
  INSERT INTO canonical_vectors (
    id, chunk_id, embedding
  ) VALUES (
    p_id, p_chunk_id, p_embedding
  )
  RETURNING id INTO v_result;
  
  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC FUNCTION: insert_memory_node
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION insert_memory_node(
  p_id UUID,
  p_document_slug TEXT,
  p_label TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result UUID;
BEGIN
  INSERT INTO memory_nodes (
    id, document_slug, label, metadata
  ) VALUES (
    p_id, p_document_slug, p_label, p_metadata
  )
  RETURNING id INTO v_result;
  
  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- RPC FUNCTION: insert_memory_edge
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION insert_memory_edge(
  p_id UUID,
  p_source UUID,
  p_target UUID,
  p_relationship TEXT,
  p_weight DOUBLE PRECISION DEFAULT 1.0,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result UUID;
BEGIN
  INSERT INTO memory_edges (
    id, source, target, relationship, weight, metadata
  ) VALUES (
    p_id, p_source, p_target, p_relationship, p_weight, p_metadata
  )
  RETURNING id INTO v_result;
  
  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- GRANT PERMISSIONS
-- ═══════════════════════════════════════════════════════════════
GRANT EXECUTE ON FUNCTION insert_canonical_document TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION insert_canonical_chunk TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION insert_canonical_vector TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION insert_memory_node TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION insert_memory_edge TO service_role, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- VERIFICATION QUERY
-- ═══════════════════════════════════════════════════════════════
DO $$
BEGIN
  RAISE NOTICE 'Migration complete: 5 RPC functions created';
  RAISE NOTICE 'Functions: insert_canonical_document, insert_canonical_chunk, insert_canonical_vector, insert_memory_node, insert_memory_edge';
END $$;
