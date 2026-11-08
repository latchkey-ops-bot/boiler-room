import { FORMATS as SCHEMA_FORMATS } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import { ICON_PATHS } from '../src/components/icons.generated.ts';
import { CREW, CREW_ICONS, FORMATS, STAGE_ICONS, STAGES } from '../src/lib/film.ts';

describe('film vocabulary', () => {
  it('has the same shapes as campaign.json', () => {
    expect([...FORMATS]).toEqual([...SCHEMA_FORMATS]);
  });

  it('has ten stations, as on the pipeline tracker', () => {
    expect(STAGES).toHaveLength(10);
  });

  it('draws every crew member and station with a design system icon', () => {
    for (const member of CREW) expect(ICON_PATHS).toHaveProperty(CREW_ICONS[member]);
    for (const stage of STAGES) expect(ICON_PATHS).toHaveProperty(STAGE_ICONS[stage]);
  });

  it('has all 20 icons from the design system', () => {
    expect(Object.keys(ICON_PATHS)).toHaveLength(20);
  });
});
