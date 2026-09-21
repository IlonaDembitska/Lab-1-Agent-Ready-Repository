import { describe, expect, it, vi } from 'vitest';

import { MockLanguageModelV3 } from 'ai/test';

import {
  createAgent,
  runWithApproval,
  type FileOps,
} from '../src/agent/agent-aisdk';

function usage() {
  return {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: 5,
      text: 5,
      reasoning: undefined,
    },
  };
}

function createMockModel() {
  let call = 0;

  return new MockLanguageModelV3({
    doGenerate: async () => {
      call += 1;

      if (call === 1) {
        return {
          content: [
            {
              type: 'tool-call' as const,
              toolCallType: 'function' as const,
              toolCallId: 'call-1',
              toolName: 'write_file',
              input: JSON.stringify({
                path: 'notes.txt',
                content: 'hi',
              }),
            },
          ],
          finishReason: {
            unified: 'tool-calls' as const,
            raw: undefined,
          },
          usage: usage(),
          warnings: [],
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              summary: 'done',
              written: ['notes.txt'],
            }),
          },
        ],
        finishReason: {
          unified: 'stop' as const,
          raw: undefined,
        },
        usage: usage(),
        warnings: [],
      };
    },
  });
}

function createFs() {
  const write = vi.fn(
    async (_path: string, _content: string) => {},
  );

  const fs: FileOps = {
    list: vi.fn(async () => []),
    read: vi.fn(async () => ''),
    write,
  };

  return {
    fs,
    write,
  };
}

describe('AI SDK tool approval', () => {
  it('не виконує write_file без approval', async () => {
    const { fs, write } = createFs();

    const agent = createAgent(
      createMockModel(),
      fs,
    );

    const result = await runWithApproval(
      agent,
      'Створи notes.txt з текстом hi',
      async () => false,
    );

    expect(result.approvals).toHaveLength(1);
    expect(result.approvals[0]?.approved).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('виконує write_file після approval', async () => {
    const { fs, write } = createFs();

    const agent = createAgent(
      createMockModel(),
      fs,
    );

    const result = await runWithApproval(
      agent,
      'Створи notes.txt з текстом hi',
      async () => true,
    );

    expect(result.approvals).toHaveLength(1);
    expect(result.approvals[0]?.approved).toBe(true);

    expect(write).toHaveBeenCalledWith(
      'notes.txt',
      'hi',
    );
  });
});
