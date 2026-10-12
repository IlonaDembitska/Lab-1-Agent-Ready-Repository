/**
 * ЕМБЕДІНГИ (крок 04): локальна Ollama (шлях А) і підробка для тестів.
 * Індексатор не знає, хто рахує вектори, — він знає лише цей інтерфейс.
 */
export interface Embedder {
  /** Те, що піде в заголовок індексу: 'ollama:embeddinggemma-2:270m'. */
  readonly id: string;
  readonly dimensions: number;
  embedDocuments(texts: readonly string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
}

export function ollamaEmbedder(model = 'embeddinggemma-2:270m', dimensions = 768): Embedder {
  const base = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

  const call = async (input: readonly string[]): Promise<number[][]> => {
    const res = await fetch(`${base}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // truncate типово true — задовгий вхід обрізався б МОВЧКИ. Нам потрібне падіння.
      body: JSON.stringify({ model, input, dimensions, truncate: false }),
    });
    if (!res.ok) throw new Error(`/api/embed ${res.status}: ${await res.text()}`);
    const data: unknown = await res.json();
    const vectors = (data as { embeddings?: unknown }).embeddings;
    if (!Array.isArray(vectors) || vectors.length !== input.length) {
      throw new Error(`/api/embed: очікував ${input.length} векторів, прийшло інше`);
    }
    for (const v of vectors as number[][]) {
      if (v.length !== dimensions) throw new Error(`/api/embed: розмірність ${v.length}, очікував ${dimensions}`);
    }
    return vectors as number[][];
  };

  return {
    id: `ollama:${model}`,
    dimensions,
    embedDocuments: call,
    embedQuery: async (text) => {
      const [v] = await call([text]);
      if (!v) throw new Error('/api/embed: порожня відповідь');
      return v;
    },
  };
}

/**
 * Підробка для тестів: детерміновано, без мережі. Схожість — збіг слів, а не сенсу.
 * Це НЕ модель: це спосіб перевірити механіку індексу й пошуку в CI.
 */
export function fakeEmbedder(dimensions = 64): Embedder {
  const vector = (text: string): number[] => {
    const v = new Array<number>(dimensions).fill(0);
    for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
      let h = 2166136261; // FNV-1a
      for (let i = 0; i < word.length; i += 1) {
        h ^= word.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const idx = Math.abs(h) % dimensions;
      v[idx] = (v[idx] ?? 0) + 1;
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  };

  return {
    id: `fake:fnv@${dimensions}`,
    dimensions,
    embedDocuments: async (texts) => texts.map(vector),
    embedQuery: async (text) => vector(text),
  };
}
