// lib/javari/ingest/schema/adapter.ts
// Javari OS Memory Ingestion - Schema Adapter Layer
// 2026-02-27 - Adapts Stage 2 data to Real Supabase Schema
//
// Maps ingestion data structures to actual Supabase tables:
// - canonical_documents (15 columns, UUID-based)
// - canonical_chunks (13 columns, with offsets and hashing)
// - canonical_vectors (4 columns, linked to chunks)
// - memory_nodes (5 columns, document slugs)
// - memory_edges (7 columns, weighted relationships)

import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import type { CanonicalDocument, DocumentChunk } from '../types';

// Real Supabase Schema Types
export interface SupabaseDocument {
  id: string;  // UUID
  title: string;
  document_key: string;
  document_type: string;
  source_path: string;
  source_type: string;
  raw_content: string;
  content_hash: string;
  metadata: Record<string, unknown>;
  search_vector?: string;
  version: number;
  status: string;
  indexed_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SupabaseChunk {
  id: string;  // UUID
  document_id: string;  // UUID reference
  chunk_index: number;
  chunk_text: string;
  chunk_hash: string;
  start_offset: number;
  end_offset: number;
  token_count: number;
  section_title?: string;
  section_path?: string[];
  metadata: Record<string, unknown>;
  search_vector?: string;
  created_at?: string;
}

export interface SupabaseVector {
  id: string;  // UUID
  chunk_id: string;  // UUID reference
  embedding: number[];
  created_at?: string;
}

export interface SupabaseNode {
  id: string;  // UUID
  document_slug: string;
  label: string;
  metadata: Record<string, unknown>;
  created_at?: string;
}

export interface SupabaseEdge {
  id: string;  // UUID
  source: string;  // UUID reference
  target: string;  // UUID reference
  relationship: string;
  weight: number;
  metadata: Record<string, unknown>;
  created_at?: string;
}

/**
 * Schema Adapter - Converts Stage 2 data to Real Supabase format
 */
export class SchemaAdapter {
  /**
   * Convert CanonicalDocument to SupabaseDocument
   */
  static documentToSupabase(
    doc: CanonicalDocument,
    rawContent: string
  ): SupabaseDocument {
    return {
      id: uuidv4(),
      title: doc.title,
      document_key: doc.id,  // Stage 2 ID becomes document_key
      document_type: doc.category,
      source_path: doc.path,
      source_type: 'r2_storage',
      raw_content: rawContent,
      content_hash: crypto.createHash('sha256').update(rawContent).digest('hex'),
      metadata: {
        ...doc.metadata,
        original_id: doc.id,
        bucket: doc.bucket,
        version: doc.version
      },
      version: 1,
      status: 'indexed',
      indexed_at: new Date().toISOString()
    };
  }

  /**
   * Convert DocumentChunk to SupabaseChunk
   */
  static chunkToSupabase(
    chunk: DocumentChunk,
    documentUuid: string
  ): SupabaseChunk {
    // Extract section info from metadata
    const heading = chunk.metadata.heading;
    const sectionPath = this.buildSectionPath(heading);
    
    return {
      id: uuidv4(),
      document_id: documentUuid,
      chunk_index: chunk.chunkIndex,
      chunk_text: chunk.content,
      chunk_hash: chunk.contentHash,
      start_offset: chunk.startOffset,
      end_offset: chunk.endOffset,
      token_count: chunk.tokenCount,
      section_title: heading,
      section_path: sectionPath,
      metadata: {
        ...chunk.metadata,
        original_chunk_id: chunk.id
      }
    };
  }

  /**
   * Create SupabaseVector linked to chunk
   */
  static vectorToSupabase(
    chunkUuid: string,
    embedding: number[]
  ): SupabaseVector {
    return {
      id: uuidv4(),
      chunk_id: chunkUuid,
      embedding
    };
  }

  /**
   * Convert to SupabaseNode
   */
  static nodeToSupabase(
    documentKey: string,
    title: string,
    category: string,
    metadata: Record<string, unknown> = {}
  ): SupabaseNode {
    return {
      id: uuidv4(),
      document_slug: this.slugify(documentKey),
      label: title,
      metadata: {
        category,
        ...metadata
      }
    };
  }

  /**
   * Convert to SupabaseEdge
   */
  static edgeToSupabase(
    sourceUuid: string,
    targetUuid: string,
    relationship: string,
    weight: number = 1.0,
    metadata: Record<string, unknown> = {}
  ): SupabaseEdge {
    return {
      id: uuidv4(),
      source: sourceUuid,
      target: targetUuid,
      relationship,
      weight,
      metadata
    };
  }

  /**
   * Build hierarchical section path from heading
   */
  private static buildSectionPath(heading?: string): string[] | undefined {
    if (!heading) return undefined;
    
    // Extract heading hierarchy (e.g., "## Overview" -> ["Overview"])
    const cleaned = heading.replace(/^#+\s*/, '').trim();
    return cleaned ? [cleaned] : undefined;
  }

  /**
   * Generate URL-safe slug
   */
  private static slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }
}
