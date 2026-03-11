-- Migration: Performance Indexes
-- Generated: 2026-02-28T03:35:36.875110
-- Purpose: Critical indexes for query performance

-- Canonical documents indexes
CREATE INDEX IF NOT EXISTS idx_canonical_documents_document_key 
  ON canonical_documents(document_key);
  
CREATE INDEX IF NOT EXISTS idx_canonical_documents_document_type 
  ON canonical_documents(document_type);
  
CREATE INDEX IF NOT EXISTS idx_canonical_documents_status 
  ON canonical_documents(status);

-- Canonical chunks indexes
CREATE INDEX IF NOT EXISTS idx_canonical_chunks_document_id_chunk_index 
  ON canonical_chunks(document_id, chunk_index);
  
CREATE INDEX IF NOT EXISTS idx_canonical_chunks_section_title 
  ON canonical_chunks(section_title) WHERE section_title IS NOT NULL;

-- Canonical vectors unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_vectors_chunk_id_unique 
  ON canonical_vectors(chunk_id);

-- Memory graph indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_nodes_document_slug_unique 
  ON memory_nodes(document_slug);
  
CREATE INDEX IF NOT EXISTS idx_memory_edges_source_target 
  ON memory_edges(source, target);
  
CREATE INDEX IF NOT EXISTS idx_memory_edges_relationship 
  ON memory_edges(relationship);
