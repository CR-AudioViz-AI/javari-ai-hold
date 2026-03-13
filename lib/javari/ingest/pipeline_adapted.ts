// lib/javari/ingest/pipeline_adapted.ts
// Adapted Ingestion Pipeline - Uses Real Supabase Schema
// 2026-02-27 - Production Schema Compliant

import { DocumentChunker } from '../chunker';
import { DocumentEmbedder } from '../embed';
import { SchemaAdapter } from './schema/adapter';
import { DocumentWriter } from './schema/writer_documents';
import { ChunkWriter } from './schema/writer_chunks';
import { VectorWriter } from './schema/writer_vectors';
import { GraphWriter } from './schema/writer_graph';
import type { CanonicalDocument, IngestionConfig, IngestionResult } from '../types';

export class AdaptedIngestionPipeline {
  private chunker: DocumentChunker;
  private embedder: DocumentEmbedder;
  private docWriter: DocumentWriter;
  private chunkWriter: ChunkWriter;
  private vectorWriter: VectorWriter;
  private graphWriter: GraphWriter;

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

    this.docWriter = new DocumentWriter(config.supabaseUrl, config.supabaseKey);
    this.chunkWriter = new ChunkWriter(config.supabaseUrl, config.supabaseKey);
    this.vectorWriter = new VectorWriter(config.supabaseUrl, config.supabaseKey);
    this.graphWriter = new GraphWriter(config.supabaseUrl, config.supabaseKey);
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
      // 1. Convert and write document
      const supabaseDoc = SchemaAdapter.documentToSupabase(doc, rawContent);
      const docResult = await this.docWriter.write(supabaseDoc);
      
      if (!docResult.success) {
        result.errors.push({ 
          code: 'DOC_WRITE_FAILED', 
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

      // 4. Write chunks
      const chunkResult = await this.chunkWriter.batchWrite(supabaseChunks);
      if (!chunkResult.success) {
        result.errors.push(...chunkResult.errors.map(e => ({
          code: 'CHUNK_WRITE_FAILED',
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

      // 7. Write vectors
      const vectorResult = await this.vectorWriter.batchWrite(vectors);
      result.vectorsStored = vectorResult.inserted;
      result.actualCost = embeddings.reduce((sum, e) => sum + e.cost, 0);

      // 8. Create memory graph node
      const node = SchemaAdapter.nodeToSupabase(
        doc.id,
        doc.title,
        doc.category,
        doc.metadata
      );
      
      const nodeResult = await this.graphWriter.writeNode(node);
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
