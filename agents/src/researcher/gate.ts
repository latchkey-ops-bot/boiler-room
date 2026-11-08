import { validateResearchParts } from '@boiler-room/schema';
import type { z } from 'zod';
import { fileIdOf, type ResearchOutput, researchOutputSchema } from './output.ts';
import { type Failure, PageIndex, type PagesBundle, verifyResearch } from './verify.ts';

/** A reason the result cannot be accepted, in the form the agent is sent to repair it. */
export interface GateFailure {
  code: string;
  path: string;
  message: string;
  fix: string;
  claimId?: string;
  /** The `brief.non_claims` item the failure belongs to, which can be dropped. */
  nonClaimIndex?: number;
  /** The `brief.pages` item the failure belongs to, which can be corrected or dropped. */
  pageIndex?: number;
}

export const PLACEHOLDER_MARK = 'PUBLISH:';
export const TODO_MARK = 'TODO';

function formatPath(segments: readonly PropertyKey[]): string {
  const path = segments.reduce<string>((joined, segment) => {
    if (typeof segment === 'number') return `${joined}[${segment}]`;
    return joined ? `${joined}.${String(segment)}` : String(segment);
  }, '');
  return path || '$';
}

function stringsIn(value: unknown, path: string): [string, string][] {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value))
    return value.flatMap((item, index) => stringsIn(item, `${path}[${index}]`));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) =>
      stringsIn(item, path === '$' ? key : `${path}.${key}`),
    );
  }
  return [];
}

/** Placeholders the template left for file ids, and fields still marked TODO. */
export function unfinished(raw: unknown): GateFailure[] {
  return stringsIn(raw, '$').flatMap(([path, value]): GateFailure[] => {
    if (value.includes(PLACEHOLDER_MARK)) {
      const file = value.slice(value.indexOf(PLACEHOLDER_MARK) + PLACEHOLDER_MARK.length);
      return [
        {
          code: 'PLACEHOLDER',
          path,
          message: `${path} still holds the placeholder for ${file}.`,
          fix: `Publish ${file} with publish_file and put the fil_ id it returns in ${path} (asset src values are "naive://files/<fil_ id>").`,
        },
      ];
    }
    if (value.trim() === TODO_MARK) {
      return [
        {
          code: 'TODO',
          path,
          message: `${path} is still TODO.`,
          fix: `Write ${path} from what the captured pages say.`,
        },
      ];
    }
    return [];
  });
}

function schemaFailures(issues: readonly z.core.$ZodIssue[]): GateFailure[] {
  return issues.map((issue) => {
    const path = formatPath(issue.path);
    const uncited = issue.code === 'too_small' && issue.path.at(-1) === 'claim_ids';
    return {
      code: 'SCHEMA_INVALID',
      path,
      message: uncited
        ? `${path} is empty: every brief fact must cite the claims that back it.`
        : `${path}: ${issue.message}`,
      fix: uncited
        ? `Put in ${path} the id of each claim whose quote says what this item says. If no claim backs it, quote one from a page's visible text, or remove the item (set it to null where it may be null).`
        : `Change ${path} so that it passes: ${issue.message}.`,
    };
  });
}

export interface CheckOptions {
  /** Whether a Naive file exists. Without it, asset files are not checked. */
  fileExists?: (fileId: string) => boolean | Promise<boolean>;
}

export interface CheckResult {
  output: ResearchOutput | undefined;
  failures: GateFailure[];
}

/**
 * Every check that needs only the result and the stored page text. The agent runs this on its own
 * computer before it submits; the gate runs it again on the bundle it downloaded itself.
 */
export async function checkResearch(
  raw: unknown,
  bundle: PagesBundle,
  options: CheckOptions = {},
): Promise<CheckResult> {
  const failures = unfinished(raw);
  const parsed = researchOutputSchema.safeParse(raw);
  if (!parsed.success)
    return { output: undefined, failures: [...failures, ...schemaFailures(parsed.error.issues)] };
  const output = parsed.data;

  for (const [id, asset] of Object.entries(output.assets)) {
    if (!fileIdOf(asset.src) && !asset.src.includes(PLACEHOLDER_MARK)) {
      failures.push({
        code: 'ASSET_SRC',
        path: `assets.${id}.src`,
        message: `assets.${id}.src is "${asset.src}", which does not name a Naive file.`,
        fix: `Publish the file and set assets.${id}.src to "naive://files/<fil_ id>".`,
      });
    }
  }

  const { fileExists } = options;
  const parts = await validateResearchParts(output, {
    assetExists: fileExists
      ? async (src) => {
          const id = fileIdOf(src);
          return id ? fileExists(id) : false;
        }
      : undefined,
  });
  for (const issue of parts.issues) {
    if (issue.severity !== 'error') continue;
    failures.push({ code: issue.code, path: issue.path, message: issue.message, fix: issue.fix });
  }

  failures.push(
    ...verifyResearch(output, bundle).map((failure: Failure): GateFailure => ({ ...failure })),
  );
  return { output, failures };
}

export interface Evidence {
  /** SHA-256 of the pages.json the gate downloaded. */
  bundleSha256: string;
  /** Digests the capture tool printed in this session's tool output. */
  captureDigests: ReadonlySet<string>;
  /** Files `publish_file` stored in this session, by id, with the path each came from. */
  published: ReadonlyMap<string, string>;
  /** Customer material the run uploaded, by file id. */
  material: ReadonlySet<string>;
}

/**
 * Checks that the result rests on what this run produced: the stored text is the bundle the
 * capture tool wrote (its digest was printed by the tool, in output the platform recorded), the
 * evidence files are the tool's own, and every asset is a file this session published or material
 * the customer supplied, with matching provenance.
 */
export function checkProvenance(output: ResearchOutput, evidence: Evidence): GateFailure[] {
  const failures: GateFailure[] = [];
  if (!evidence.captureDigests.has(evidence.bundleSha256)) {
    failures.push({
      code: 'CAPTURE_UNBOUND',
      path: 'evidence.pages_file_id',
      message: `The published pages.json (sha256 ${evidence.bundleSha256.slice(0, 12)}...) is not the bundle any capture in this session reported. It was changed after the capture, or it is from another run.`,
      fix: 'Publish the pages.json that the capture tool wrote, unchanged, and set evidence.pages_file_id to its id. Never edit stored page text: fix the claims instead.',
    });
  }
  const expect = (path: string, id: string, ending: string) => {
    const from = evidence.published.get(id);
    if (!from?.endsWith(ending)) {
      failures.push({
        code: 'EVIDENCE_UNPUBLISHED',
        path,
        message: `${path} is ${id}, which this session did not publish from the capture's ${ending}.`,
        fix: `Publish the capture tool's ${ending} with publish_file and set ${path} to the id it returns.`,
      });
    }
  };
  expect('evidence.pages_file_id', output.evidence.pages_file_id, '/pages.json');
  expect('evidence.capture_file_id', output.evidence.capture_file_id, '/capture.json');

  for (const [id, asset] of Object.entries(output.assets)) {
    const fileId = fileIdOf(asset.src);
    if (!fileId) continue;
    const path = `assets.${id}`;
    if (evidence.material.has(fileId)) {
      if (asset.provenance !== 'uploaded') {
        failures.push({
          code: 'ASSET_PROVENANCE',
          path: `${path}.provenance`,
          message: `${path} is customer material, so its provenance is "uploaded", not "${asset.provenance}".`,
          fix: `Set ${path}.provenance to "uploaded".`,
        });
      }
    } else if (!evidence.published.has(fileId)) {
      failures.push({
        code: 'ASSET_PROVENANCE',
        path: `${path}.src`,
        message: `${path}.src names ${fileId}, which this session did not publish and the customer did not supply.`,
        fix: `Publish the captured file with publish_file and use the id it returns, or remove ${path}.`,
      });
    } else if (asset.provenance === 'uploaded') {
      failures.push({
        code: 'ASSET_PROVENANCE',
        path: `${path}.provenance`,
        message: `${path} was captured or generated in this session, so it is not "uploaded".`,
        fix: `Set ${path}.provenance to "captured", or "generated" for a generated wordmark.`,
      });
    }
  }
  return failures;
}

/**
 * The result without these claims, and with every reference to them removed from the brief. Used
 * when repair rounds run out: a claim that cannot be verified never reaches the output. A brief
 * fact left citing no claim has nothing behind it, so it goes too: a list item is dropped, an
 * optional fact (pricing, the free trial, the positioning note) becomes null. The one-liner and
 * what-it-is cannot go; left uncited, they fail the schema and the result is not accepted.
 */
export function withoutClaims(output: ResearchOutput, ids: ReadonlySet<string>): ResearchOutput {
  const keep = <T extends { claim_ids: string[] }>(item: T): T => ({
    ...item,
    claim_ids: item.claim_ids.filter((id) => !ids.has(id)),
  });
  const backed = <T extends { claim_ids: string[] }>(items: T[]): T[] =>
    items.map(keep).filter((item) => item.claim_ids.length > 0);
  const optional = <T extends { claim_ids: string[] }>(item: T | null): T | null => {
    const kept = item ? keep(item) : null;
    return kept && kept.claim_ids.length > 0 ? kept : null;
  };
  const { brief } = output;
  const pricing = optional(brief.pricing);
  return {
    ...output,
    claims: output.claims.filter((claim) => !ids.has(claim.id)),
    brief: {
      ...brief,
      one_liner: keep(brief.one_liner),
      what_it_is: keep(brief.what_it_is),
      audiences: backed(brief.audiences),
      features: backed(brief.features),
      conflicts: backed(brief.conflicts),
      positioning_note: optional(brief.positioning_note),
      pricing: pricing
        ? { ...pricing, free_trial: optional(pricing.free_trial), plans: backed(pricing.plans) }
        : null,
      headline_claim_id:
        brief.headline_claim_id && ids.has(brief.headline_claim_id)
          ? null
          : brief.headline_claim_id,
    },
  };
}

/** Whether the gate can settle a failure itself when repair rounds run out. */
export function prunable(failure: GateFailure): boolean {
  return (
    failure.claimId !== undefined ||
    failure.nonClaimIndex !== undefined ||
    failure.pageIndex !== undefined
  );
}

/**
 * The result with every failure the gate can settle itself settled: failing claims dropped with
 * every reference to them, failing non-claims dropped, pages that were not captured dropped from
 * the brief, and each listed page's title set to the one the capture stored. Used when repair
 * rounds run out, so a wrong note never fails a result whose claims are verified, and an
 * unverified claim never reaches the output.
 */
export function withoutFailures(
  output: ResearchOutput,
  failures: readonly GateFailure[],
  bundle: PagesBundle,
): ResearchOutput {
  const claims = new Set(failures.flatMap((failure) => (failure.claimId ? [failure.claimId] : [])));
  const nonClaims = new Set(failures.flatMap((failure) => failure.nonClaimIndex ?? []));
  const uncaptured = new Set(
    failures.flatMap((failure) =>
      failure.code === 'PAGE_NOT_CAPTURED' && failure.pageIndex !== undefined
        ? [failure.pageIndex]
        : [],
    ),
  );
  const pages = new PageIndex(bundle);
  const trimmed = withoutClaims(output, claims);
  return {
    ...trimmed,
    brief: {
      ...trimmed.brief,
      non_claims: trimmed.brief.non_claims.filter((_, index) => !nonClaims.has(index)),
      pages: trimmed.brief.pages
        .filter((_, index) => !uncaptured.has(index))
        .map((page) => ({ ...page, title: pages.find(page.url)?.page.title ?? page.title })),
    },
  };
}

/** A failure message the agent can act on, one numbered item per failure. */
export function formatFailures(failures: readonly GateFailure[]): string {
  return failures
    .map(
      (failure, index) =>
        `${index + 1}. [${failure.code}] ${failure.path}: ${failure.message}\n   Fix: ${failure.fix}`,
    )
    .join('\n');
}
