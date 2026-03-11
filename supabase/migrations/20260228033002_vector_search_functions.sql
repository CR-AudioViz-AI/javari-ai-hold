-- Migration: Vector Search Functions
-- Generated: 2026-02-28T03:35:36.874906
-- Purpose: Similarity search and vector operations

-- Similarity search
CREATE OR REPLACE FUNCTION similarity_search_vectors(
  p_query_embedding vector(1536),
  p_limit INTEGER DEFAULT 10,
  p_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  content TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cv.chunk_id,
    cc.document_id,
    cc.chunk_text,
    1 - (cv.embedding <=> p_query_embedding) AS similarity
  FROM canonical_vectors cv
  JOIN canonical_chunks cc ON cc.id = cv.chunk_id
  WHERE 1 - (cv.embedding <=> p_query_embedding) >= p_threshold
  ORDER BY cv.embedding <=> p_query_embedding
  LIMIT p_limit;
END;
$$;

-- Hybrid search (text + vector)
CREATE OR REPLACE FUNCTION hybrid_search_text_and_vector(
  p_query_text TEXT,
  p_query_embedding vector(1536),
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  chunk_id UUID,
  document_id UUID,
  content TEXT,
  text_score FLOAT,
  vector_score FLOAT,
  combined_score FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cv.chunk_id,
    cc.document_id,
    cc.chunk_text,
    ts_rank(cc.search_vector, plainto_tsquery('english', p_query_text)) AS text_score,
    (1 - (cv.embedding <=> p_query_embedding)) AS vector_score,
    (0.5 * ts_rank(cc.search_vector, plainto_tsquery('english', p_query_text)) +
     0.5 * (1 - (cv.embedding <=> p_query_embedding))) AS combined_score
  FROM canonical_vectors cv
  JOIN canonical_chunks cc ON cc.id = cv.chunk_id
  WHERE cc.search_vector @@ plainto_tsquery('english', p_query_text)
     OR (1 - (cv.embedding <=> p_query_embedding)) >= 0.7
  ORDER BY combined_score DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION similarity_search_vectors TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION hybrid_search_text_and_vector TO service_role, authenticated;
