import { readFileSync } from 'node:fs';
import type { Campaign } from '@boiler-room/schema';
import { describe, expect, it } from 'vitest';
import {
  checkSubmission,
  expectedSeams,
  expectedTemplate,
  onSite,
  researchFacts,
} from '../src/director/checks.ts';
import { OUTREACH_BRIEF } from '../src/director/output.ts';
import { frameSeconds, rowStarts, TEMPLATES } from '../src/director/templates.ts';
import {
  exampleBrief,
  exampleResearch,
  exampleSubmission,
  workedExample,
} from './director-fixtures.ts';

const skill = (name: string) =>
  readFileSync(new URL(`../../skills/${name}/SKILL.md`, import.meta.url), 'utf8');

async function codesAfter(edit: (submission: ReturnType<typeof exampleSubmission>) => void) {
  const submission = exampleSubmission();
  edit(submission);
  const verdict = await checkSubmission(submission, exampleResearch(), exampleBrief());
  return verdict.blocking.map((issue) => `${issue.code} ${issue.path}`);
}

const text = (campaign: Campaign, id: string) => {
  const item = [...campaign.scenes, ...campaign.variants.hooks]
    .flatMap((scene) => scene.text)
    .find((each) => each.id === id);
  if (!item) throw new Error(`no text item ${id}`);
  return item;
};

describe('the templates as data', () => {
  it.each(Object.values(TEMPLATES))('$label sums to its frames', (template) => {
    expect(template.rows.reduce((sum, row) => sum + row.frames, 0)).toBe(template.frames);
    expect(template.frames).toBe(template.durationSeconds * 30);
  });

  it.each(Object.values(TEMPLATES))(
    '$label has the default seams director-seams gives',
    (template) => {
      const line = skill('director-seams')
        .split('\n')
        .find((each) => each.startsWith(`| ${template.label} `));
      const seams = line?.split('|')[2]?.replaceAll('`', '').trim().split(/\s+/);
      expect(template.rows.slice(0, -1).map((row) => row.seam)).toEqual(seams);
      expect(template.rows.at(-1)?.seam).toBeNull();
    },
  );

  it.each(Object.values(TEMPLATES))(
    '$label has the rows, frames and seconds of director-beat-templates',
    (template) => {
      const body = skill('director-beat-templates');
      const section = body.split(`## ${template.label}\n`)[1]?.split('\n## ')[0] ?? '';
      const rows = section
        .split('\n')
        .filter((line) => /^\| \d+/.test(line))
        .map((line) => line.split('|').map((cell) => cell.trim()));
      const starts = rowStarts(template);
      expect(rows).toHaveLength(template.rows.length);
      for (const [index, cells] of rows.entries()) {
        const row = template.rows[index];
        const from = starts[index] ?? 0;
        expect(Number(cells[3]), `row ${index + 1} frames`).toBe(row?.frames);
        expect(Number(cells[4]), `row ${index + 1} from`).toBe(from);
        expect(Number(cells[6]), `row ${index + 1} start`).toBe(frameSeconds(from));
        expect(Number(cells[7]), `row ${index + 1} end`).toBe(
          frameSeconds(from + (row?.frames ?? 0)),
        );
        const types = [...(cells[2] ?? '').matchAll(/`([a-z-]+)`/g)].map((match) => match[1]);
        if (row?.slot === 'fixed') expect(types[0]).toBe(row.type);
        if (row?.variant) expect(cells[2]).toContain(`"${row.variant}"`);
      }
    },
  );
});

describe('expectedTemplate', () => {
  const facts = researchFacts(exampleResearch());
  const many = {
    ...facts,
    claims: 9,
    approvedClaimIds: ['a', 'b', 'c', 'd', 'e'],
    numericClaimIds: ['a', 'b', 'c'],
    surfaces: ['1', '2', '3'],
  };

  it('follows the rules of §1 in order', () => {
    expect(expectedTemplate(OUTREACH_BRIEF, many, 9).label).toBe('Short');
    const order = { ...OUTREACH_BRIEF, kind: 'customer-order' as const };
    expect(expectedTemplate(order, facts, 2).label).toBe('Short');
    expect(expectedTemplate(order, many, 9).label).toBe('Long');
    expect(expectedTemplate({ ...order, asksFor45s: true }, many, 9).label).toBe('Standard');
    expect(
      expectedTemplate(order, { ...many, approvedClaimIds: ['a', 'b', 'c', 'd'] }, 9).label,
    ).toBe('Standard');
  });
});

describe('expectedSeams', () => {
  const standard = (types: string[]): Campaign =>
    ({
      scenes: TEMPLATES.standard.rows.map((row, index) => ({ type: types[index] ?? row.type })),
    }) as unknown as Campaign;
  const proof = (a: string, b: string, c: string) => {
    const types = TEMPLATES.standard.rows.map((row) => row.type);
    types.splice(5, 3, a, b, c);
    return standard(types);
  };

  it('applies the seams director-beat-templates gives after each proof swap', () => {
    const plan = TEMPLATES.standard.rows.map((row) => row.seam);
    expect(
      expectedSeams(proof('stat-counter', 'stat-counter', 'stat-counter'), TEMPLATES.standard),
    ).toEqual(plan);
    expect(
      expectedSeams(
        proof('stat-counter', 'stat-counter', 'feature-card'),
        TEMPLATES.standard,
      ).slice(5, 8),
    ).toEqual(['t5', 't1', 't5']);
    expect(
      expectedSeams(
        proof('stat-counter', 'feature-card', 'feature-card'),
        TEMPLATES.standard,
      ).slice(5, 8),
    ).toEqual(['t1', 't5', 't5']);
    expect(
      expectedSeams(proof('feature-card', 'feature-card', 'feature-card'), TEMPLATES.standard),
    ).toEqual(plan);
  });

  it('joins the three feature cards of a Short film with no numeric proof', () => {
    const scenes = TEMPLATES.short.rows.map((row, index) => ({
      type: index === 6 ? 'feature-card' : row.type,
    }));
    expect(expectedSeams({ scenes } as unknown as Campaign, TEMPLATES.short)[5]).toBe('t5');
  });
});

describe('checkSubmission', () => {
  it('passes the worked example of the director skill with nothing to repair', async () => {
    const verdict = await checkSubmission(exampleSubmission(), exampleResearch(), exampleBrief());
    expect(verdict.blocking).toEqual([]);
    expect(verdict.other).toEqual([]);
    expect(verdict.campaign?.id).toBe('fernhook-launch');
  });

  it('refuses a submission that does not match the output schema', async () => {
    const verdict = await checkSubmission(
      { campaign: workedExample() },
      exampleResearch(),
      exampleBrief(),
    );
    expect(verdict.blocking.map((issue) => issue.code)).toEqual(['HANDOFF_INVALID']);
  });

  it.each([
    {
      name: 'a number no cited quote states',
      edit: (s: ReturnType<typeof exampleSubmission>) => {
        text(s.campaign, 'proof-number').value = 'Under 60 s';
      },
      expected: 'CLAIM_UNBACKED campaign.scenes[6].text[0].value',
    },
    {
      name: 'an uncited superlative, which the validator only warns on',
      edit: (s: ReturnType<typeof exampleSubmission>) => {
        text(s.campaign, 'payoff-line').value = 'The best previews.';
      },
      expected: 'CLAIM_SUPERLATIVE campaign.scenes[7].text[0].value',
    },
    {
      name: 'a cited superlative its quote does not state',
      edit: (s: ReturnType<typeof exampleSubmission>) => {
        text(s.campaign, 'value-line').value = 'The fastest previews anywhere.';
      },
      expected: 'CLAIM_SUPERLATIVE campaign.scenes[3].text[0].value',
    },
    {
      name: 'a scene off its row frames',
      edit: (s: ReturnType<typeof exampleSubmission>) => {
        const [, mark, hero] = s.campaign.scenes;
        if (mark && hero) {
          mark.end = 5.5;
          hero.start = 5.5;
        }
      },
      expected: 'TEMPLATE_FRAMES campaign.scenes[1]',
    },
    {
      name: 'a missing row',
      edit: (s: ReturnType<typeof exampleSubmission>) => {
        s.campaign.scenes.splice(8, 1);
      },
      expected: 'TEMPLATE_ROWS campaign.scenes',
    },
    {
      name: 'a row of the wrong type',
      edit: (s: ReturnType<typeof exampleSubmission>) => {
        const scene = s.campaign.scenes[7];
        if (scene) scene.type = 'type-card';
      },
      expected: 'TEMPLATE_ROWS campaign.scenes[7].type',
    },
    {
      name: 'a seam off the plan',
      edit: (s: ReturnType<typeof exampleSubmission>) => {
        const scene = s.campaign.scenes[2];
        if (scene) scene.transitionOut = 't16';
      },
      expected: 'SEAM campaign.scenes[2].transitionOut',
    },
    {
      name: 'a hook with its own seam',
      edit: (s: ReturnType<typeof exampleSubmission>) => {
        const hook = s.campaign.variants.hooks[0];
        if (hook) hook.transitionOut = 't1';
      },
      expected: 'HOOK campaign.variants.hooks[0].transitionOut',
    },
    {
      name: 'the wrong length for the brief',
      edit: (s: ReturnType<typeof exampleSubmission>) => {
        s.handoff.template = 'Standard';
      },
      expected: 'TEMPLATE_LENGTH handoff.template',
    },
    {
      name: 'a reworded quote',
      edit: (s: ReturnType<typeof exampleSubmission>) => {
        const claim = s.campaign.claims[0];
        if (claim) claim.quote = 'Every pull request gets a live preview in under 60 seconds.';
      },
      expected: 'CLAIM_ALTERED campaign.claims[0]',
    },
    {
      name: 'a recoloured brand',
      edit: (s: ReturnType<typeof exampleSubmission>) => {
        s.campaign.brand.colors.primary = '#000000';
      },
      expected: 'BRAND_ALTERED campaign.brand',
    },
    {
      name: 'an extracted claim on screen when the brief allows only approved ones',
      edit: (s: ReturnType<typeof exampleSubmission>) => {
        text(s.campaign, 'callback-line').claimIds = ['team-count'];
      },
      expected: 'CLAIM_STATUS campaign.scenes[8].text[0].claimIds',
    },
    {
      name: 'a CTA label over 4 words',
      edit: (s: ReturnType<typeof exampleSubmission>) => {
        const cta = s.campaign.variants.ctas[1];
        if (cta) cta.label = 'Book a demo with us';
      },
      expected: 'CTA campaign.variants.ctas[1].label',
    },
    {
      name: 'an end card CTA that is not the first label',
      edit: (s: ReturnType<typeof exampleSubmission>) => {
        text(s.campaign, 'end-cta').value = 'Book a demo';
      },
      expected: 'CTA campaign.scenes[10].text',
    },
    {
      name: 'a type card over card.min',
      edit: (s: ReturnType<typeof exampleSubmission>) => {
        text(s.campaign, 'value-line').value = 'A live preview for every single pull request.';
      },
      expected: 'CARD_TIME campaign.scenes[3].text',
    },
    {
      name: 'invented capture data',
      edit: (s: ReturnType<typeof exampleSubmission>) => {
        const hero = s.campaign.scenes[2];
        if (hero) hero.props.focus = { x: 10, y: 20, w: 300, h: 80 };
      },
      expected: 'PROPS campaign.scenes[2].props.focus',
    },
    {
      name: 'a role the scene type does not take',
      edit: (s: ReturnType<typeof exampleSubmission>) => {
        s.campaign.scenes[7]?.text.push({
          id: 'payoff-sub',
          role: 'subhead',
          value: 'Really.',
          claimIds: [],
        });
      },
      expected: 'ROLE campaign.scenes[7].text[1].role',
    },
  ])('sends back $name', async ({ edit, expected }) => {
    expect(await codesAfter(edit)).toContain(expected);
  });

  describe('superlatives against the cited quotes', () => {
    const growth = {
      id: 'growth',
      text: 'The fastest-growing teams review with Fernhook',
      sourceUrl: 'https://fernhook.example.com/customers',
      quote: 'The fastest-growing teams review with Fernhook. Our best-seller is the preview link.',
      status: 'approved' as const,
    };
    async function superlativeIssues(value: string, claimIds: string[]) {
      const submission = exampleSubmission();
      const research = exampleResearch();
      research.claims.push(structuredClone(growth));
      submission.campaign.claims.push(structuredClone(growth));
      const line = text(submission.campaign, 'value-line');
      line.value = value;
      line.claimIds = claimIds;
      const verdict = await checkSubmission(submission, research, exampleBrief());
      return verdict.blocking
        .filter((issue) => issue.code === 'CLAIM_SUPERLATIVE')
        .map((issue) => `${issue.path}: ${issue.message}`);
    }

    it.each([
      ['Fastest previews.', 'fastest', 'fastest-growing'],
      ['The best preview link.', 'best', 'best-seller'],
    ])(
      'refuses "%s", whose quote only says it inside a compound',
      async (value, word, compound) => {
        const issues = await superlativeIssues(value, ['growth']);
        expect(issues).toHaveLength(1);
        expect(issues[0]).toContain('campaign.scenes[3].text[0].value');
        expect(issues[0]).toContain(`"${word}"`);
        expect(issues[0]).toContain(`"${compound}"`);
      },
    );

    it('accepts copy that repeats the compound the quote uses', async () => {
      expect(await superlativeIssues('Fastest-growing teams.', ['growth'])).toEqual([]);
    });

    it('refuses a superlative only the Director lists, cited or not', async () => {
      expect(await superlativeIssues('World-class previews.', [])).toHaveLength(1);
      expect(await superlativeIssues('World-class previews.', ['growth'])).toHaveLength(1);
    });
  });

  describe('numbers a quote states as a goal', () => {
    const mission = {
      id: 'mission',
      text: 'Fernhook aims to reach 10,000 teams by 2030',
      sourceUrl: 'https://fernhook.example.com/about',
      quote: 'Our mission is to give 10,000 teams a live preview by 2030.',
      status: 'approved' as const,
    };
    async function goalIssues(headline: string, subhead?: string) {
      const submission = exampleSubmission();
      const research = exampleResearch();
      research.claims.push(structuredClone(mission));
      submission.campaign.claims.push(structuredClone(mission));
      const scene = submission.campaign.scenes[3];
      if (!scene) throw new Error('no scene 4');
      scene.text = [
        { id: 'value-line', role: 'headline', value: headline, claimIds: ['mission'] },
        ...(subhead
          ? [{ id: 'value-sub', role: 'subhead' as const, value: subhead, claimIds: ['mission'] }]
          : []),
      ];
      const verdict = await checkSubmission(submission, research, exampleBrief());
      return verdict.blocking
        .filter((issue) => issue.code === 'CLAIM_GOAL')
        .map((issue) => issue.path);
    }

    it('refuses a goal stated as a fact', async () => {
      expect(await goalIssues('10,000 teams.')).toEqual(['campaign.scenes[3].text[0].value']);
    });

    it('accepts the number said as the goal it is', async () => {
      expect(await goalIssues('10,000 teams by 2030.')).toEqual([]);
      expect(await goalIssues('10,000 teams.', 'Our mission.')).toEqual([]);
    });
  });

  describe('names in copy', () => {
    const deel = {
      id: 'deel',
      text: 'Deel reviews with Fernhook',
      sourceUrl: 'https://fernhook.example.com/customers',
      quote: 'Deel reviews every pull request with Fernhook.',
      status: 'approved' as const,
    };
    async function nameIssues(edit: (s: ReturnType<typeof exampleSubmission>) => void) {
      const submission = exampleSubmission();
      const research = exampleResearch();
      research.claims.push(structuredClone(deel));
      submission.campaign.claims.push(structuredClone(deel));
      edit(submission);
      const verdict = await checkSubmission(submission, research, exampleBrief());
      return verdict.blocking
        .filter((issue) => issue.code === 'CLAIM_NAME')
        .map((issue) => `${issue.path}: ${issue.message}`);
    }

    it('refuses customers no claim names', async () => {
      const issues = await nameIssues((s) => {
        const line = text(s.campaign, 'callback-line');
        line.value = 'Used at Stripe, Notion and Figma.';
        line.claimIds = [];
      });
      expect(issues).toEqual([
        expect.stringMatching(
          /^campaign\.scenes\[8\]\.text\[0\]\.value: .*"Stripe", "Notion" and "Figma"/,
        ),
      ]);
    });

    it('refuses names the cited quote does not name, and passes the one it does', async () => {
      const issues = await nameIssues((s) => {
        const line = text(s.campaign, 'callback-line');
        line.value = 'Deel, Vercel and Ramp review here.';
        line.claimIds = ['deel'];
      });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain('"Vercel" and "Ramp"');
      expect(issues[0]).not.toContain('"Deel"');
    });

    it('reads hooks too', async () => {
      const issues = await nameIssues((s) => {
        const hook = s.campaign.variants.hooks[0];
        const headline = hook?.text[0];
        if (headline) headline.value = 'Previews like Vercel.';
      });
      expect(issues).toEqual([
        expect.stringMatching(/^campaign\.variants\.hooks\[0\]\.text\[0\]\.value/),
      ]);
    });

    it('passes the brand and the worked example', async () => {
      expect(await nameIssues(() => {})).toEqual([]);
    });
  });

  it('refuses a CTA on a lookalike host that only ends with the site host', async () => {
    const edited = await codesAfter((s) => {
      for (const cta of s.campaign.variants.ctas)
        cta.href = 'https://getfernhook.example.com/signup';
    });
    expect(edited).toEqual([
      'CTA campaign.variants.ctas[0].href',
      'CTA campaign.variants.ctas[1].href',
    ]);
    const subdomain = await codesAfter((s) => {
      for (const cta of s.campaign.variants.ctas)
        cta.href = 'https://docs.fernhook.example.com/signup';
    });
    expect(subdomain).toEqual([]);
  });

  it('compares hosts on a label boundary', () => {
    expect(onSite('https://getlinear.app/signup', 'linear.app')).toBe(false);
    expect(onSite('https://linear.app.evil.example/signup', 'linear.app')).toBe(false);
    expect(onSite('https://docs.linear.app/signup', 'linear.app')).toBe(true);
    expect(onSite('https://www.linear.app/signup', 'linear.app')).toBe(true);
    expect(onSite('https://linear.app', 'linear.app')).toBe(true);
    expect(onSite('not a url', '')).toBe(false);
  });

  it('counts only captured tiles from the site or its subdomains', () => {
    const research = exampleResearch();
    const before = researchFacts(research).capturedTiles;
    const [id, asset] = Object.entries(research.assets).find(
      ([, each]) => each.kind === 'image' && each.provenance === 'captured',
    ) ?? ['', undefined];
    if (!asset) throw new Error('the example research has no captured image');
    research.assets[id] = { ...asset, sourceUrl: 'https://getfernhook.example.com/' };
    expect(researchFacts(research).capturedTiles).toBe(before - 1);
  });

  it('leaves contrast to the Art Director without blocking the Director', async () => {
    const submission = exampleSubmission();
    const research = exampleResearch();
    for (const target of [submission.campaign.brand, research.brand])
      target.colors.foreground = '#DDDDDD';
    const verdict = await checkSubmission(submission, research, exampleBrief());
    expect(verdict.blocking).toEqual([]);
    expect(verdict.other).toEqual([
      expect.objectContaining({
        code: 'CONTRAST_LOW',
        owner: 'art-director',
        path: 'campaign.brand.colors.foreground',
      }),
    ]);
  });

  it('wants audio omitted when no music was given', async () => {
    const verdict = await checkSubmission(exampleSubmission(), exampleResearch(), {
      ...exampleBrief(),
      music: null,
    });
    expect(verdict.blocking.map((issue) => issue.code)).toEqual(['ASSET_INVENTED', 'AUDIO']);
  });

  it('sends every issue with a fix the agent can apply', async () => {
    const submission = exampleSubmission();
    text(submission.campaign, 'proof-number').value = 'Under 60 s';
    const verdict = await checkSubmission(submission, exampleResearch(), exampleBrief());
    expect(verdict.blocking).toHaveLength(1);
    expect(verdict.blocking[0]?.fix).toBe(
      'Cite a claim whose quote states "60" in scenes[6].text[0].claimIds, or remove "60" from the text.',
    );
  });
});
