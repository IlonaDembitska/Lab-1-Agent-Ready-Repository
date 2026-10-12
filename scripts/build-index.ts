/**
 * Побудова індексу (крок 04). Мережа (локальна Ollama) тут потрібна, тому це scripts/, а не src/.
 *   npm run index
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { chunkDocument, normalize, RULE } from '../src/rag/chunk';
import { ollamaEmbedder } from '../src/rag/embed';
import { round6, saveIndex, sha256, type IndexedChunk, type IndexFile } from '../src/rag/store';

const CORPUS = 'data/pdr';
const OUT = 'data/index.json';
const NORMALIZATION = 'BOM прибрано, CRLF→LF, пробіли в кінці рядків прибрано';

async function main(): Promise<void> {
  const embedder = ollamaEmbedder();
  const started = performance.now();
  const documents: IndexFile['documents'] = [];
  const chunks: IndexedChunk[] = [];

  const files = readdirSync(CORPUS).filter((f) => /\.(md|txt)$/i.test(f)).sort();
  if (files.length < 10) throw new Error(`у ${CORPUS}/ лише ${files.length} файлів, специфікація вимагає 10–40`);

  for (const file of files) {
    const docId = file.replace(/\.(md|txt)$/i, ''); // імʼя файлу = id зі spec.md
    const text = normalize(readFileSync(join(CORPUS, file), 'utf8'));
    const parts = chunkDocument(docId, text, RULE);
    const vectors = await embedder.embedDocuments(parts.map((p) => p.text));
    parts.forEach((part, i) => {
      const v = vectors[i];
      if (!v) throw new Error(`${part.id}: немає вектора`);
      chunks.push({ ...part, vector: v.map(round6) });
    });
    documents.push({ id: docId, path: join(CORPUS, file), chars: text.length, sha256: sha256(text) });
    console.log(`  ${docId}: ${text.length} симв. → ${parts.length} фрагм.`);
  }

  saveIndex(OUT, {
    version: 1,
    builtAt: new Date().toISOString(),
    embedder: embedder.id,
    dimensions: embedder.dimensions,
    rule: RULE,
    normalization: NORMALIZATION,
    documents,
    chunks,
  });

  const seconds = (performance.now() - started) / 1000;
  const lengths = chunks.map((c) => c.text.length).sort((a, b) => a - b);
  console.log(`
документів:    ${documents.length}
фрагментів:    ${chunks.length}
довжина:       медіана ${lengths[Math.floor(lengths.length / 2)] ?? 0}, мін ${lengths[0] ?? 0}, макс ${lengths[lengths.length - 1] ?? 0} симв.
ембедер:       ${embedder.id}, ${embedder.dimensions} вимірів
${OUT}:        ${(statSync(OUT).size / 1024 / 1024).toFixed(1)} МБ
час побудови:  ${seconds.toFixed(1)} с
`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
