import { describe, expect, it } from 'vitest';

import {
  listFiles,
  readTextFile,
} from '../src/agent/tools';

describe('agent tools', () => {
  it('lists repository files', async () => {
    const files = await listFiles('.');

    expect(files).toContain('src/');
    expect(files).toContain('tests/');
  });

  it('reads a normal text file', async () => {
    const content = await readTextFile('package.json');

    expect(content).toContain('"name"');
  });

  it('blocks .env', async () => {
    await expect(
      readTextFile('.env'),
    ).rejects.toThrow('Reading .env files is not allowed');
  });

  it('blocks .env.local', async () => {
    await expect(
      readTextFile('.env.local'),
    ).rejects.toThrow('Reading .env files is not allowed');
  });

  it('allows .env.example', async () => {
    const content = await readTextFile('.env.example');

    expect(content.length).toBeGreaterThan(0);
  });

  it('blocks paths outside repository', async () => {
    await expect(
      readTextFile('../package.json'),
    ).rejects.toThrow('Path must stay inside the repository');
  });
});