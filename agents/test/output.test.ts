import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import {
  fileIdOf,
  naiveFileSrc,
  researchOutputJsonSchema,
  researchOutputSchema,
} from '../src/researcher/output.ts';
import { output } from './fixtures.ts';

describe('researchOutputSchema', () => {
  it('accepts a complete result and refuses unknown fields', () => {
    expect(researchOutputSchema.safeParse(output()).success).toBe(true);
    expect(researchOutputSchema.safeParse({ ...output(), score: 1 }).success).toBe(false);
    const brief = { ...output().brief, extra: 'x' };
    expect(researchOutputSchema.safeParse({ ...output(), brief }).success).toBe(false);
  });

  it('carries the campaign brand, assets and claims parts unchanged', () => {
    const bad = output();
    bad.brand.colors.primary = 'indigo';
    expect(researchOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('names Naive files in asset src', () => {
    expect(naiveFileSrc('fil_abc123')).toBe('naive://files/fil_abc123');
    expect(fileIdOf('naive://files/fil_abc123')).toBe('fil_abc123');
    expect(fileIdOf('naive://files/PUBLISH:logo.svg')).toBeUndefined();
    expect(fileIdOf('https://site.example.org/logo.svg')).toBeUndefined();
  });
});

describe('researchOutputJsonSchema', () => {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats.default(ajv);
  const validate = ajv.compile(researchOutputJsonSchema);

  it('is what submit_output checks: a valid result passes it', () => {
    expect(validate(output())).toBe(true);
  });

  it('refuses what the zod schema refuses', () => {
    const bad = output() as unknown as Record<string, unknown>;
    delete bad.needs_upload;
    expect(validate(bad)).toBe(false);
    expect(
      validate({
        ...output(),
        claims: [
          { id: 'x', text: 'x', sourceUrl: 'https://a.example', quote: 'q', status: 'approved?' },
        ],
      }),
    ).toBe(false);
  });

  it('requires every section the Researcher hands on', () => {
    expect(researchOutputJsonSchema.required).toEqual([
      'brand',
      'assets',
      'claims',
      'brand_details',
      'brief',
      'needs_upload',
      'evidence',
    ]);
  });
});
