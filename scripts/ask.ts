/**
 * Асистент із джерелами (крок 05).
 *   npx tsx --env-file=.env.local scripts/ask.ts "питання"
 * Ембедінг запиту — локальна Ollama (той самий ембедер, що й індекс); відповідь — Gemini.
 */
import { google } from '@ai-sdk/google';
import { generateText } from 'ai';

import { CATALOG } from '../src/models';
import { ANSWER_SYSTEM, buildAnswerPrompt, REFUSAL, REFUSE_BELOW, shouldRefuse } from '../src/rag/answer';
import { renderCitation, validateAnswer } from '../src/rag/cite';
import { ollamaEmbedder } from '../src/rag/embed';
import { bm25From, retrieve } from '../src/rag/search';
import { loadIndex } from '../src/rag/store';

async function main(): Promise<void> {
  const query = process.argv.slice(2).join(' ').trim();
  if (query === '') throw new Error('використання: npx tsx --env-file=.env.local scripts/ask.ts "питання"');
  const embedder = ollamaEmbedder();
  const index = loadIndex('data/index.json', embedder);
  const { hits, bestCosine } = await retrieve(index, bm25From(index), embedder, query);

  console.log(`Питання: ${query}`);
  console.log(`найкращий косинус: ${bestCosine.toFixed(3)} (поріг відмови ${REFUSE_BELOW})`);
  console.log(`видано фрагменти: ${hits.map((h) => h.chunk.id).join(", ")}`);
  if (shouldRefuse(bestCosine)) {
    console.log(`\nВідповідь:\n${REFUSAL} (відмова за порогом — модель не викликалась)`);
    return;
  }
  const { text } = await generateText({
    model: google(CATALOG['gemini-3.1-flash-lite'].id),
    system: ANSWER_SYSTEM,
    prompt: buildAnswerPrompt(query, hits),
    temperature: 0,
  });
  console.log(`\nВідповідь:\n${text.trim()}`);
  console.log('\nДжерела:');
  for (const h of hits) if (text.includes(`[${h.chunk.id}]`)) console.log(`  ${renderCitation(h.chunk)}`);
  const problems = text.includes(REFUSAL) ? [] : validateAnswer(text, hits.map((h) => h.chunk));
  console.log(problems.length > 0 ? `\nПЕРЕВІРКА ЦИТАТ: ${problems.join('; ')}` : '\nперевірка цитат: ок');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
