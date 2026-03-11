// lib/javari/ingest/pipeline_sql.ts
// SQL RPC-based Ingestion Pipeline
// 2026-02-27 - Direct SQL execution bypassing PostgREST

import { DocumentChunker } from '../chunker';
import { DocumentEmbedder } from '../embed';
import { SchemaAdapter } from './schema/adapter';
import { SQLWriter } from './schema/writer_sql';
import type { CanonicalDocument, IngestionConfig, IngestionResult } from '../types';

export class SQLIngestionPipeline {
  private chunker: DocumentChunker;
  private embedder: DocumentEmbedder;
  private sqlWriter: SQLWriter;

  constructor(private config: IngestionConfig) {
    this.chunker = new DocumentChunker({
      chunkSize: config.chunkSize,
      chunkOverlap: config.chunkOverlap,
      semanticBoundaries: config.semanticBoundaries,
      preserveCodeBlocks: config.preserveCodeBlocks
    });
    
    this.embedder = new DocumentEmbedder({
      provider: config.embeddingProvider,
      model: config.embeddingModel,
      dimensions: config.embeddingDimensions,
      batchSize: config.batchSize
    });

    this.sqlWriter = new SQLWriter(config.supabaseUrl, config.supabaseKey);
  }

  async ingestDocument(doc: CanonicalDocument, rawContent: string): Promise<IngestionResult> {
    const start = Date.now();
    const result: IngestionResult = {
      documentId: doc.id,
      documentTitle: doc.title,
      chunksCreated: 0,
      vectorsStored: 0,
      graphNodesCreated: 0,
      graphEdgesCreated: 0,
      totalTokens: 0,
      estimatedCost: 0,
      actualCost: 0,
      durationMs: 0,
      errors: [],
      success: false
    };

    try {
      // 1. Convert and insert document via SQL RPC
      const supabaseDoc = SchemaAdapter.documentToSupabase(doc, rawContent);
      const docResult = await this.sqlWriter.insertDocument(supabaseDoc);
      
      if (!docResult.success) {
        result.errors.push({ 
          code: 'DOC_INSERT_FAILED', 
          message: docResult.error || 'Unknown error',
          timestamp: new Date().toISOString(),
          recoverable: true
        });
        return result;
      }

      const documentUuid = docResult.id!;

      // 2. Chunk document
      const chunks = this.chunker.chunkDocument(doc.id, rawContent);
      result.chunksCreated = chunks.length;
      result.totalTokens = chunks.reduce((sum, c) => sum + c.tokenCount, 0);

      // 3. Convert chunks to Supabase format
      const supabaseChunks = chunks.map(chunk => 
        SchemaAdapter.chunkToSupabase(chunk, documentUuid)
      );

      // 4. Insert chunks via SQL RPC
      const chunkResult = await this.sqlWriter.batchInsertChunks(supabaseChunks);
      if (!chunkResult.success) {
        result.errors.push(...chunkResult.errors.map(e => ({
          code: 'CHUNK_INSERT_FAILED',
          message: e,
          timestamp: new Date().toISOString(),
          recoverable: true
        })));
      }

      // 5. Generate embeddings
      const embeddings = await this.embedder.embedBatch(chunks);
      
      // 6. Create vectors linked to chunks
      const vectors = embeddings.map((emb, idx) => 
        SchemaAdapter.vectorToSupabase(
          chunkResult.chunkIds[idx],
          emb.embedding
        )
      );

      // 7. Insert vectors via SQL RPC
      const vectorResult = await this.sqlWriter.batchInsertVectors(vectors);
      result.vectorsStored = vectorResult.inserted;
      result.actualCost = embeddings.reduce((sum, e) => sum + e.cost, 0);

      // 8. Create memory graph node
      const node = SchemaAdapter.nodeToSupabase(
        doc.id,
        doc.title,
        doc.category,
        doc.metadata
      );
      
      const nodeResult = await this.sqlWriter.insertNode(node);
      if (nodeResult.success) {
        result.graphNodesCreated = 1;
      }

      result.success = true;
    } catch (error) {
      result.errors.push({
        code: 'INGESTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
        recoverable: false
      });
    }

    result.durationMs = Date.now() - start;
    return result;
  }
}
