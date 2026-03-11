-- Migration: Batch Insert Functions
-- Generated: 2026-02-28T03:35:36.874535
-- Purpose: High-performance batch operations for ingestion

-- Batch insert canonical documents
CREATE OR REPLACE FUNCTION batch_insert_canonical_documents(
  p_documents JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_doc JSONB;
BEGIN
  FOR v_doc IN SELECT * FROM jsonb_array_elements(p_documents)
  LOOP
    INSERT INTO canonical_documents (
      id, title, document_key, document_type, source_path, source_type,
      raw_content, content_hash, metadata, version, status, indexed_at
    ) VALUES (
      (v_doc->>'id')::UUID,
      v_doc->>'title',
      v_doc->>'document_key',
      v_doc->>'document_type',
      v_doc->>'source_path',
      v_doc->>'source_type',
      v_doc->>'raw_content',
      v_doc->>'content_hash',
      COALESCE(v_doc->'metadata', '{}'::jsonb),
      COALESCE((v_doc->>'version')::INTEGER, 1),
      COALESCE(v_doc->>'status', 'indexed'),
      NOW()
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- Batch insert canonical chunks
CREATE OR REPLACE FUNCTION batch_insert_canonical_chunks(
  p_chunks JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_chunk JSONB;
BEGIN
  FOR v_chunk IN SELECT * FROM jsonb_array_elements(p_chunks)
  LOOP
    INSERT INTO canonical_chunks (
      id, document_id, chunk_index, chunk_text, chunk_hash,
      start_offset, end_offset, token_count, section_title, section_path, metadata
    ) VALUES (
      (v_chunk->>'id')::UUID,
      (v_chunk->>'document_id')::UUID,
      (v_chunk->>'chunk_index')::INTEGER,
      v_chunk->>'chunk_text',
      v_chunk->>'chunk_hash',
      COALESCE((v_chunk->>'start_offset')::INTEGER, 0),
      COALESCE((v_chunk->>'end_offset')::INTEGER, 0),
      COALESCE((v_chunk->>'token_count')::INTEGER, 0),
      v_chunk->>'section_title',
      CASE WHEN v_chunk->'section_path' IS NOT NULL 
           THEN ARRAY(SELECT jsonb_array_elements_text(v_chunk->'section_path'))
           ELSE NULL END,
      COALESCE(v_chunk->'metadata', '{}'::jsonb)
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION batch_insert_canonical_documents TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION batch_insert_canonical_chunks TO service_role, authenticated;
