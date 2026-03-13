// lib/javari/ingest/schema/writer_documents.ts
// Writes to canonical_documents table using real schema

import type { SupabaseDocument } from './adapter';

export class DocumentWriter {
  constructor(
    private supabaseUrl: string,
    private supabaseKey: string
  ) {}

  async write(doc: SupabaseDocument): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/canonical_documents`, {
        method: 'POST',
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(doc)
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

  async batchWrite(docs: SupabaseDocument[]): Promise<{ 
    success: boolean; 
    inserted: number; 
    errors: string[] 
  }> {
    const errors: string[] = [];
    let inserted = 0;

    // Insert in batches of 10
    for (let i = 0; i < docs.length; i += 10) {
      const batch = docs.slice(i, i + 10);
      
      try {
        const response = await fetch(`${this.supabaseUrl}/rest/v1/canonical_documents`, {
          method: 'POST',
          headers: {
            'apikey': this.supabaseKey,
            'Authorization': `Bearer ${this.supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(batch)
        });

        if (response.ok) {
          inserted += batch.length;
        } else {
          const error = await response.text();
          errors.push(`Batch ${i / 10 + 1}: ${error}`);
        }
      } catch (error) {
        errors.push(`Batch ${i / 10 + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { success: errors.length === 0, inserted, errors };
  }
}
