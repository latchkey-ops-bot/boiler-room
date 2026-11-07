import type { NeedUpload, ResearchOutput } from '../researcher/output.ts';
import { NAIVE_FILE_PREFIX } from '../researcher/output.ts';
import type { ResolvedFont } from './fonts.ts';
import type { LogoSource } from './logo.ts';
import type { LinkKind, ProbeResult } from './pages.ts';
import type { DerivedColors } from './tokens.ts';
import type { RawCta, RawLink, RawUiCandidate } from './types.ts';

/** A file the agent must publish, and the placeholder in the template its `fil_` id replaces. */
export interface PublishItem {
  path: string;
  placeholder: string;
  what: string;
}

export interface Shot {
  file: string;
  assetId: string;
  kind: 'page' | 'ui';
  label: string;
  mock: boolean;
  /** Product UI candidates this shot shows. */
  ui: { label: string; mock: boolean }[];
  width: number;
  height: number;
  sourceUrl: string;
}

export interface CapturedPage {
  url: string;
  final_url: string;
  slug: string;
  kind: LinkKind;
  status: number | null;
  content_type: string | null;
  title: string;
  text_file: string;
  shots: Shot[];
  ctas: RawCta[];
  ui: RawUiCandidate[];
  hidden_overlays: number;
  error: string | null;
}

export interface MaterialEntry {
  name: string;
  file_id: string;
  source_url: string;
  content_type: string;
  origin: 'file' | 'url';
  /** Where the tool found it on this computer, or null when it was not fetched. */
  path: string | null;
  text_chars: number;
  image: { width: number | null; height: number | null } | null;
}

export interface CaptureManifest {
  version: 1;
  site: string;
  host: string;
  captured_at: string;
  pages: CapturedPage[];
  skipped: { url: string; reason: string }[];
  probes: ProbeResult[];
  llms_txt: boolean;
  brand: {
    name: string;
    colors: DerivedColors;
    fonts: ResolvedFont[];
    logo: {
      source: LogoSource;
      file: string;
      url: string | null;
      kind: 'svg' | 'image';
      width: number | null;
      height: number | null;
    };
  };
  login_links: RawLink[];
  media: { kind: string; src: string; page: string }[];
  material: MaterialEntry[];
  publish: PublishItem[];
  errors: string[];
}

export const PLACEHOLDER = 'PUBLISH:';
export const TODO = 'TODO';

export const placeholderFor = (relativePath: string) => `${PLACEHOLDER}${relativePath}`;

function productUiStatus(
  manifest: CaptureManifest,
): ResearchOutput['brief']['product_ui']['status'] {
  const seen = manifest.pages.flatMap((page) => page.shots.flatMap((shot) => shot.ui));
  if (seen.some((ui) => !ui.mock)) return 'public';
  if (seen.length > 0) return 'mock-only';
  return manifest.login_links.length > 0 ? 'login-required' : 'none';
}

function needs(manifest: CaptureManifest, status: string): NeedUpload[] {
  const list: NeedUpload[] = [];
  const signIn = manifest.login_links[0]?.url ?? null;
  if (manifest.brand.logo.source === 'generated') {
    list.push({
      id: 'logo',
      kind: 'logo',
      what: 'The logo. The site shows no logo file, inline logo or favicon that could be downloaded.',
      why: 'Without it the film opens and closes on the product name set in type instead of the real mark.',
      request:
        'Please send your logo as an SVG, or a PNG at least 1000 px wide, ideally one version for light and one for dark backgrounds.',
      blocking: false,
      evidence_url: manifest.site,
    });
  }
  if (manifest.brand.fonts.some((font) => font.method === 'substitute')) {
    list.push({
      id: 'brand-fonts',
      kind: 'font',
      what: 'The brand typefaces. The site uses fonts built into the visitor’s device, so an open font stands in.',
      why: 'The film will use the stand-in font, which may not match how the brand is set elsewhere.',
      request: 'If you have brand fonts, please send the font files or tell us their names.',
      blocking: false,
      evidence_url: manifest.site,
    });
  }
  if (status === 'login-required' || status === 'none' || status === 'mock-only') {
    list.push({
      id: 'product-ui',
      kind: 'product-ui',
      what:
        status === 'mock-only'
          ? 'Screens of the real product. The public pages only show illustrated mockups with sample data.'
          : 'Screens of the real product. No public page shows the product itself.',
      why: 'A launch film is strongest when it shows the product working. Without real screens it can only show the marketing site.',
      request:
        'Please send 3 to 6 screenshots (1920x1080 or larger) or a short screen recording of the main workflow, from a demo account with no real customer data.',
      blocking: status !== 'mock-only',
      evidence_url: status === 'login-required' ? signIn : manifest.site,
    });
  }
  return list;
}

/**
 * The result the agent starts from. Everything code can measure is filled in: brand tokens, fonts,
 * logo, screenshots as assets, pages read, calls to action seen and likely gaps. The agent replaces
 * every `PUBLISH:` placeholder with the `fil_` id `publish_file` gives that file, writes the claims
 * and the brief, and removes whatever is wrong.
 */
export function buildTemplate(manifest: CaptureManifest): ResearchOutput {
  const { brand } = manifest;
  const colors = brand.colors;
  const font = (role: 'display' | 'body') => {
    const resolved =
      brand.fonts.find((item) => item.role === role) ??
      brand.fonts.find((item) => item.role === 'body');
    return {
      family: resolved?.family ?? 'Inter',
      source: resolved?.url ?? 'https://fonts.googleapis.com/css2?family=Inter',
    };
  };
  const assets: ResearchOutput['assets'] = {
    logo: {
      kind: brand.logo.kind,
      src: `${NAIVE_FILE_PREFIX}${placeholderFor(brand.logo.file)}`,
      provenance: brand.logo.source === 'generated' ? 'generated' : 'captured',
      ...(brand.logo.width ? { width: brand.logo.width } : {}),
      ...(brand.logo.height ? { height: brand.logo.height } : {}),
      ...(brand.logo.url?.startsWith('http') ? { sourceUrl: brand.logo.url } : {}),
    },
  };
  for (const page of manifest.pages) {
    for (const shot of page.shots) {
      assets[shot.assetId] = {
        kind: 'image',
        src: `${NAIVE_FILE_PREFIX}${placeholderFor(shot.file)}`,
        provenance: 'captured',
        width: shot.width,
        height: shot.height,
        sourceUrl: shot.sourceUrl,
      };
    }
  }
  for (const item of manifest.material) {
    if (!item.image) continue;
    assets[
      item.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'material'
    ] = {
      kind: /svg/.test(item.content_type) ? 'svg' : 'image',
      src: `${NAIVE_FILE_PREFIX}${item.file_id}`,
      provenance: 'uploaded',
      ...(item.image.width ? { width: item.image.width } : {}),
      ...(item.image.height ? { height: item.image.height } : {}),
    };
  }

  const status = productUiStatus(manifest);
  const seenCtas = new Set<string>();
  const ctas: ResearchOutput['brief']['ctas'] = [];
  for (const page of manifest.pages) {
    for (const cta of page.ctas) {
      if (!cta.href?.startsWith('http') || seenCtas.has(cta.text.toLowerCase()) || ctas.length >= 8)
        continue;
      if (cta.placement === 'footer') continue;
      seenCtas.add(cta.text.toLowerCase());
      ctas.push({
        label: cta.text,
        href: cta.href,
        source_url: page.final_url,
        placement: page.kind === 'pricing' ? 'pricing' : cta.placement,
      });
    }
  }

  const display = brand.fonts.find((item) => item.role === 'display');
  return {
    brand: {
      name: brand.name,
      colors: {
        background: colors.background,
        foreground: colors.foreground,
        primary: colors.primary,
        ...(colors.accent ? { accent: colors.accent } : {}),
        ...(colors.muted ? { muted: colors.muted } : {}),
      },
      fonts: { display: font('display'), body: font('body') },
      logoAssetId: 'logo',
      ...(colors.radius !== null ? { radius: colors.radius } : {}),
    },
    assets,
    claims: [],
    brand_details: {
      mode: colors.mode,
      accents: colors.accents,
      fonts: brand.fonts.map((item) => ({
        role: item.role,
        family: item.family,
        method: item.method,
        url: item.url,
      })),
      radius_px: colors.radius,
      css_variables: colors.cssVariables,
      notes: [
        ...colors.notes,
        ...brand.fonts
          .filter((item) => item.method === 'substitute')
          .map(
            (item) =>
              `${item.role} text uses ${item.siteFamily ?? 'system fonts'} on the site, which loads no font file, so ${item.family} stands in.`,
          ),
        ...(display ? [] : ['No heading was found, so the display font is the body font.']),
      ],
    },
    brief: {
      product_name: brand.name,
      one_liner: TODO,
      what_it_is: TODO,
      audiences: [],
      features: [],
      pricing: null,
      ctas,
      headline_claim_id: null,
      positioning_note: null,
      non_claims: [],
      conflicts: [],
      pages: manifest.pages
        .filter((page) => !page.error)
        .map((page) => ({
          url: page.final_url,
          kind:
            page.kind === 'login' ||
            page.kind === 'legal' ||
            page.kind === 'careers' ||
            page.kind === 'contact'
              ? 'other'
              : page.kind,
          title: page.title,
          screenshot_asset_id: page.shots.find((shot) => shot.kind === 'page')?.assetId ?? null,
        })),
      product_ui: {
        status,
        notes: TODO,
        asset_ids: manifest.pages.flatMap((page) =>
          page.shots.filter((shot) => shot.ui.length > 0).map((shot) => shot.assetId),
        ),
      },
    },
    needs_upload: needs(manifest, status),
    evidence: {
      pages_file_id: placeholderFor('pages.json'),
      capture_file_id: placeholderFor('capture.json'),
      logo: {
        asset_id: 'logo',
        source: brand.logo.source,
        url: brand.logo.url?.startsWith('http') ? brand.logo.url : null,
      },
      material: manifest.material.map((item) => ({
        file_id: item.file_id,
        name: item.name,
        used_for: TODO,
      })),
    },
  };
}

/**
 * A first guess at the product's name: the site name the page declares, else the part of the title
 * that matches the domain, else the shortest part of the title, else the domain itself.
 */
export function guessBrandName(
  meta: Record<string, string>,
  title: string,
  host: string,
  logoAlt = '',
): string {
  const declared = (meta['og:site_name'] ?? meta['application-name'] ?? '').trim();
  if (declared && declared.length <= 40) return declared;
  const label = host.replace(/^www\./, '').split('.')[0] ?? host;
  const segments = title
    .split(/\s+[|–—·:-]\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 40);
  const matching = segments.find((part) =>
    part.toLowerCase().replace(/\s+/g, '').includes(label.toLowerCase()),
  );
  if (matching) return matching;
  const alt = logoAlt.replace(/\blogo\b/gi, '').trim();
  if (alt && alt.length <= 40) return alt;
  const shortest = [...segments].sort((a, b) => a.length - b.length)[0];
  if (shortest && shortest.length <= 30) return shortest;
  return label.charAt(0).toUpperCase() + label.slice(1);
}
