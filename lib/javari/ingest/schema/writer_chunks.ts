// lib/javari/ingest/schema/writer_chunks.ts
// Writes to canonical_chunks table using real schema

import type { SupabaseChunk } from './adapter';

export class ChunkWriter {
  constructor(
    private supabaseUrl: string,
    private supabaseKey: string
  ) {}

  async write(chunk: SupabaseChunk): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/canonical_chunks`, {
        method: 'POST',
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(chunk)
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${error}` };
      }

      const result = await response.json();
      return { success: true, id: Array.isArray(result) ? result[0]?.id : result.id };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  }

  async batchWrite(chunks: SupabaseChunk[]): Promise<{ 
    success: boolean; 
    inserted: number; 
    errors: string[];
    chunkIds: string[];
  }> {
    const errors: string[] = [];
    const chunkIds: string[] = [];
    let inserted = 0;

    // Insert in batches of 20
    for (let i = 0; i < chunks.length; i += 20) {
      const batch = chunks.slice(i, i + 20);
      
      try {
        const response = await fetch(`${this.supabaseUrl}/rest/v1/canonical_chunks`, {
          method: 'POST',
          headers: {
            'apikey': this.supabaseKey,
            'Authorization': `Bearer ${this.supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(batch)
        });

        if (response.ok) {
          const result = await response.json();
          inserted += batch.length;
          
          // Collect chunk IDs for vector linking
          if (Array.isArray(result)) {
            chunkIds.push(...result.map(r => r.id));
          }
        } else {
          const error = await response.text();
          errors.push(`Batch ${i / 20 + 1}: ${error}`);
        }
      } catch (error) {
        errors.push(`Batch ${i / 20 + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { success: errors.length === 0, inserted, errors, chunkIds };
  }
}
