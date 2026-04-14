import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Prompt removal from client', () => {
  test('analyseJob.js does not send systemPrompt in request body', () => {
    const source = readFileSync(join(__dirname, '../utils/analyseJob.js'), 'utf8');
    expect(source).not.toContain('systemPrompt');
  });

  test('analyseJob.js does not accept systemPrompt as a parameter', () => {
    const source = readFileSync(join(__dirname, '../utils/analyseJob.js'), 'utf8');
    // The function signature should not include systemPrompt
    const match = source.match(/export async function runAnalysis\(\{([^}]+)\}/);
    expect(match).toBeTruthy();
    expect(match[1]).not.toContain('systemPrompt');
  });

  test('App.jsx does not import SYSTEM_PROMPT', () => {
    const source = readFileSync(join(__dirname, '../App.jsx'), 'utf8');
    expect(source).not.toContain('SYSTEM_PROMPT');
  });
});
