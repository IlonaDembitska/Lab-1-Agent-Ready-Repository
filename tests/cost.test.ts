import { describe, expect, it } from 'vitest';

import {
  addUsage,
  errorPct,
  fromChatUsage,
  fromGeminiUsage,
  fromMessagesUsage,
  languageMultiplier,
  priceUsd,
  withinTolerance,
  ZERO_USAGE,
} from '../src/cost';

import { MODELS } from '../src/models';

describe('usage helpers', () => {
  it('adds usage values', () => {
    expect(
      addUsage(
        {
          inputTokens: 100,
          cachedTokens: 20,
          outputTokens: 30,
        },
        {
          inputTokens: 50,
          cachedTokens: 10,
          outputTokens: 15,
        },
      ),
    ).toEqual({
      inputTokens: 150,
      cachedTokens: 30,
      outputTokens: 45,
    });
  });

  it('starts with zero usage', () => {
    expect(ZERO_USAGE).toEqual({
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
    });
  });
});

describe('provider usage normalization', () => {
  it('normalizes Anthropic-style usage', () => {
    expect(
      fromMessagesUsage({
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 10,
      }),
    ).toEqual({
      inputTokens: 140,
      cachedTokens: 30,
      outputTokens: 20,
    });
  });

  it('normalizes OpenAI-style usage', () => {
    expect(
      fromChatUsage({
        prompt_tokens: 100,
        completion_tokens: 20,
        prompt_tokens_details: {
          cached_tokens: 25,
        },
      }),
    ).toEqual({
      inputTokens: 100,
      cachedTokens: 25,
      outputTokens: 20,
    });
  });

  it('normalizes Gemini-style usage', () => {
    expect(
      fromGeminiUsage({
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        cachedContentTokenCount: 10,
        thoughtsTokenCount: 5,
      }),
    ).toEqual({
      inputTokens: 100,
      cachedTokens: 10,
      outputTokens: 25,
    });
  });
});

describe('measurement helpers', () => {
  it('calculates percentage error', () => {
    expect(errorPct(90, 100)).toBe(10);
  });

  it('checks tolerance', () => {
    expect(withinTolerance(95, 100, 10)).toBe(true);
    expect(withinTolerance(80, 100, 10)).toBe(false);
  });

  it('calculates language multiplier', () => {
    expect(languageMultiplier(150, 100)).toBe(1.5);
  });
});

describe('cost calculation', () => {
  it('calculates price from models.ts', () => {
    const cost = priceUsd(MODELS.cheap, {
      inputTokens: 1000,
      cachedTokens: 0,
      outputTokens: 500,
    });

    expect(cost).toBeGreaterThan(0);
  });
});