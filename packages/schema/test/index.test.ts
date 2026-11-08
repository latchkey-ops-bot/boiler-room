import { describe, expect, it } from 'vitest';
import * as schema from '../src/index.ts';

describe('@boiler-room/schema', () => {
  it('exports the whole public surface', () => {
    expect(Object.keys(schema).sort()).toEqual(
      [
        'ASSET_KINDS',
        'ASSET_PROVENANCES',
        'CLAIM_STATUSES',
        'DEFAULT_TEXT_LIMITS',
        'FORMATS',
        'ISSUE_CODES',
        'MIN_CONTRAST',
        'TEXT_ROLES',
        'campaignJsonSchema',
        'campaignSchema',
        'researchPartsSchema',
        'sceneRegistry',
        'sceneFrames',
        'toFrame',
        'validateCampaign',
        'validateResearchParts',
      ].sort(),
    );
  });
});
