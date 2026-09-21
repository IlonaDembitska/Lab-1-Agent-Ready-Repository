import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  runAgentLoop,
  type Model,
} from '../src/agent/agent-loop';
import { createTools } from '../src/agent/tools';

const ZERO = {
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
};

describe('runAgentLoop', () => {
  it('завершується з валідним JSON', async () => {
    const model: Model = async () => ({
      text: '{"answer":"ok"}',
      calls: [],
      usage: ZERO,
    });

    const result = await runAgentLoop({
      model,
      tools: createTools(),
      system: 'test',
      task: 'test',
      output: z.object({
        answer: z.string(),
      }),
      maxSteps: 3,
      tokenBudget: 1000,
      session: 'test',
      log: () => {},
    });

    expect(result.stop).toBe('done');

    if (result.stop === 'done') {
      expect(result.output).toEqual({
        answer: 'ok',
      });
    }
  });

  it('зупиняється за maxSteps', async () => {
    const model: Model = async () => ({
      text: 'not json',
      calls: [],
      usage: ZERO,
    });

    const result = await runAgentLoop({
      model,
      tools: createTools(),
      system: 'test',
      task: 'test',
      output: z.object({
        answer: z.string(),
      }),
      maxSteps: 2,
      tokenBudget: 1000,
      session: 'test',
      log: () => {},
    });

    expect(result.stop).toBe('max-steps');
    expect(result.steps).toBe(2);
  });

  it('зупиняється за token budget', async () => {
    const model: Model = async () => ({
      text: 'continue',
      calls: [],
      usage: {
        inputTokens: 100,
        cachedTokens: 0,
        outputTokens: 100,
      },
    });

    const result = await runAgentLoop({
      model,
      tools: createTools(),
      system: 'test',
      task: 'test',
      output: z.object({
        answer: z.string(),
      }),
      maxSteps: 10,
      tokenBudget: 200,
      session: 'test',
      log: () => {},
    });

    expect(result.stop).toBe('token-budget');
  });

  it('виконує tool call і передає результат назад моделі', async () => {
    let turn = 0;

    const model: Model = async (
      _system,
      messages,
    ) => {
      turn += 1;

      if (turn === 1) {
        return {
          text: '',
          calls: [
            {
              id: 'call-1',
              name: 'list_files',
              input: {
                path: '.',
              },
            },
          ],
          usage: ZERO,
        };
      }

      const toolMessage = messages.find(
        (message) => message.role === 'tool',
      );

      expect(toolMessage).toBeDefined();

      return {
        text: '{"answer":"done"}',
        calls: [],
        usage: ZERO,
      };
    };

    const result = await runAgentLoop({
      model,
      tools: createTools(),
      system: 'test',
      task: 'list files',
      output: z.object({
        answer: z.string(),
      }),
      maxSteps: 3,
      tokenBudget: 1000,
      session: 'test',
      log: () => {},
    });

    expect(result.stop).toBe('done');
  });
});
