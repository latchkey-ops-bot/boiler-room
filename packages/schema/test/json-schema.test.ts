import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import nova from '../examples/nova.campaign.json' with { type: 'json' };
import { campaignJsonSchema } from '../src/json-schema.ts';
import { negativeFixtures, novaCopy } from './negative-fixtures.ts';

const ajv = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true });
addFormats.default(ajv);

describe('campaignJsonSchema', () => {
  it('is a valid draft 2020-12 schema', () => {
    expect(campaignJsonSchema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(ajv.validateSchema(campaignJsonSchema)).toBe(true);
    expect(ajv.errors).toBeNull();
  });

  it('is plain JSON', () => {
    expect(JSON.parse(JSON.stringify(campaignJsonSchema))).toEqual(campaignJsonSchema);
  });

  it('accepts the Nova example', () => {
    const validate = ajv.compile(campaignJsonSchema);
    expect(validate(nova), JSON.stringify(validate.errors)).toBe(true);
  });

  it('inlines every definition, so no consumer has to resolve a $ref', () => {
    expect(JSON.stringify(campaignJsonSchema)).not.toContain('$ref');
  });

  it('rejects unknown fields, as the Zod schema does', () => {
    expect(campaignJsonSchema.additionalProperties).toBe(false);
    const validate = ajv.compile(campaignJsonSchema);
    expect(validate({ ...nova, extra: true })).toBe(false);
  });

  it('marks every field the contract requires', () => {
    expect(campaignJsonSchema.required).toEqual(
      expect.arrayContaining([
        'schemaVersion',
        'id',
        'sourceUrl',
        'fps',
        'durationSeconds',
        'brand',
        'assets',
        'claims',
        'scenes',
        'variants',
      ]),
    );
    expect(campaignJsonSchema.required).not.toContain('audio');
  });

  it('tells agents how to fill the fields that carry rules', () => {
    expect(JSON.stringify(campaignJsonSchema)).toContain('Every number in the text must appear');
  });

  it('tells agents that a transition takes no time from the scenes', () => {
    expect(JSON.stringify(campaignJsonSchema)).toContain('take no timeline time');
  });

  it('agrees with the Zod schema on the structural fixtures', () => {
    const validate = ajv.compile(campaignJsonSchema);
    const structural = negativeFixtures.filter(
      ({ name }) => name === 'a missing required field' || name === 'a value outside an enum',
    );
    expect(structural).toHaveLength(2);
    for (const fixture of structural) {
      const copy = novaCopy();
      fixture.build(copy);
      expect(validate(copy), fixture.name).toBe(false);
    }
  });
});
