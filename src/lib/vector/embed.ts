import 'server-only';

/**
 * Sentence embeddings, computed locally (no external API, no API key).
 * Model : all-MiniLM-L6-v2 (sentence-transformers), ONNX build via transformers.js
 * Output: 384-dimensional vector, mean-pooled and L2-normalised
 *         -> cosine similarity == dot product
 * The model (~23 MB) downloads once from Hugging Face on first use and is cached.
 * Set EMBEDDING_MODEL_DIR to load it from a local folder instead (offline demo).
 */
export const EMBEDDING_DIM = 384;

type Extractor = (text: string | string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;

const g = globalThis as unknown as { __reliefExtractor?: Promise<Extractor> };

async function extractor(): Promise<Extractor> {
  if (!g.__reliefExtractor) {
    g.__reliefExtractor = (async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      if (process.env.EMBEDDING_MODEL_DIR) {
        env.localModelPath = process.env.EMBEDDING_MODEL_DIR;
        env.allowRemoteModels = false;
      }
      const model = process.env.EMBEDDING_MODEL ?? 'Xenova/all-MiniLM-L6-v2';
      return (await pipeline('feature-extraction', model, { quantized: true })) as unknown as Extractor;
    })().catch((e) => {
      g.__reliefExtractor = undefined;
      throw e;
    });
  }
  return g.__reliefExtractor;
}

export async function embed(text: string): Promise<number[]> {
  const ex = await extractor();
  const out = await ex(text.trim().slice(0, 2000), { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

export async function embedMany(texts: string[]): Promise<number[][]> {
  const result: number[][] = [];
  for (const t of texts) result.push(await embed(t));
  return result;
}

/** Text that represents an SOS in vector space */
export function sosEmbeddingText(description: string, needs: string[] = [], disasterType?: string): string {
  const parts = [description.trim()];
  if (disasterType) parts.push(`Disaster: ${disasterType.replace('_', ' ')}`);
  if (needs.length) parts.push(`Needs: ${needs.join(', ')}`);
  return parts.join('. ');
}

/** Text that represents a relief item in vector space */
export function itemEmbeddingText(item: { item_name: string; category: string; usage_notes?: string | null }): string {
  return `${item.item_name} (${item.category}). ${item.usage_notes ?? ''}`.trim();
}
