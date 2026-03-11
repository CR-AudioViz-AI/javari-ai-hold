// lib/javari/ingest/schema/writer_sql.ts
// SQL RPC-based writers - Bypass PostgREST RLS cache
// 2026-02-27 - Direct SQL execution via Postgres functions

import type { 
  SupabaseDocument, 
  SupabaseChunk, 
  SupabaseVector, 
  SupabaseNode, 
  SupabaseEdge 
} from './adapter';

export class SQLWriter {
  constructor(
    private supabaseUrl: string,
    private supabaseKey: string
  ) {}

  /**
   * Insert document via RPC function
   */
  async insertDocument(doc: SupabaseDocument): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/rpc/insert_canonical_document`, {
        method: 'POST',
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_id: doc.id,
          p_title: doc.title,
          p_document_key: doc.document_key,
          p_document_type: doc.document_type,
          p_source_path: doc.source_path,
          p_source_type: doc.source_type,
          p_raw_content: doc.raw_content,
          p_content_hash: doc.content_hash,
          p_metadata: doc.metadata,
          p_version: doc.version,
          p_status: doc.status
        })
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${error}` };
      }

      const result = await response.json();
      return { success: true, id: result };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Insert chunk via RPC function
   */
  async insertChunk(chunk: SupabaseChunk): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/rpc/insert_canonical_chunk`, {
        method: 'POST',
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_id: chunk.id,
          p_document_id: chunk.document_id,
          p_chunk_index: chunk.chunk_index,
          p_chunk_text: chunk.chunk_text,
          p_chunk_hash: chunk.chunk_hash,
          p_start_offset: chunk.start_offset,
          p_end_offset: chunk.end_offset,
          p_token_count: chunk.token_count,
          p_section_title: chunk.section_title || null,
          p_section_path: chunk.section_path || null,
          p_metadata: chunk.metadata
        })
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${error}` };
      }

      const result = await response.json();
      return { success: true, id: result };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Insert vector via RPC function
   */
  async insertVector(vector: SupabaseVector): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      // Format embedding as PostgreSQL vector literal
      const embeddingStr = `[${vector.embedding.join(',')}]`;
      
      const response = await fetch(`${this.supabaseUrl}/rest/v1/rpc/insert_canonical_vector`, {
        method: 'POST',
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_id: vector.id,
          p_chunk_id: vector.chunk_id,
          p_embedding: embeddingStr
        })
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${error}` };
      }

      const result = await response.json();
      return { success: true, id: result };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Insert memory node via RPC function
   */
  async insertNode(node: SupabaseNode): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/rpc/insert_memory_node`, {
        method: 'POST',
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_id: node.id,
          p_document_slug: node.document_slug,
          p_label: node.label,
          p_metadata: node.metadata
        })
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${error}` };
      }

      const result = await response.json();
      return { success: true, id: result };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Insert memory edge via RPC function
   */
  async insertEdge(edge: SupabaseEdge): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/rpc/insert_memory_edge`, {
        method: 'POST',
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          p_id: edge.id,
          p_source: edge.source,
          p_target: edge.target,
          p_relationship: edge.relationship,
          p_weight: edge.weight,
          p_metadata: edge.metadata
        })
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${error}` };
      }

      const result = await response.json();
      return { success: true, id: result };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  /**
   * Batch insert chunks
   */
  async batchInsertChunks(chunks: SupabaseChunk[]): Promise<{ 
    success: boolean; 
    inserted: number; 
    errors: string[];
    chunkIds: string[];
  }> {
    const errors: string[] = [];
    const chunkIds: string[] = [];
    let inserted = 0;

    for (const chunk of chunks) {
      const result = await this.insertChunk(chunk);
      if (result.success) {
        inserted++;
        chunkIds.push(result.id!);
      } else {
        errors.push(result.error || 'Unknown error');
      }
    }

    return { success: errors.length === 0, inserted, errors, chunkIds };
  }

  /**
   * Batch insert vectors
   */
  async batchInsertVectors(vectors: SupabaseVector[]): Promise<{ 
    success: boolean; 
    inserted: number; 
    errors: string[] 
  }> {
    const errors: string[] = [];
    let inserted = 0;

    for (const vector of vectors) {
      const result = await this.insertVector(vector);
      if (result.success) {
        inserted++;
      } else {
        errors.push(result.error || 'Unknown error');
      }
    }

    return { success: errors.length === 0, inserted, errors };
  }
}
