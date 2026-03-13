// lib/javari/ingest/schema/writer_graph.ts
// Writes to memory_nodes and memory_edges using real schema

import type { SupabaseNode, SupabaseEdge } from './adapter';

export class GraphWriter {
  constructor(
    private supabaseUrl: string,
    private supabaseKey: string
  ) {}

  async writeNode(node: SupabaseNode): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/memory_nodes`, {
        method: 'POST',
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(node)
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

  async writeEdge(edge: SupabaseEdge): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/memory_edges`, {
        method: 'POST',
        headers: {
          'apikey': this.supabaseKey,
          'Authorization': `Bearer ${this.supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(edge)
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

  async batchWriteEdges(edges: SupabaseEdge[]): Promise<{ 
    success: boolean; 
    inserted: number; 
    errors: string[] 
  }> {
    const errors: string[] = [];
    let inserted = 0;

    for (const edge of edges) {
      const result = await this.writeEdge(edge);
      if (result.success) {
        inserted++;
      } else {
        errors.push(result.error || 'Unknown error');
      }
    }

    return { success: errors.length === 0, inserted, errors };
  }
}
