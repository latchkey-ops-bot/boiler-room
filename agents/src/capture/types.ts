/**
 * What the in-page collector returns. Colours are already converted to `#RRGGBB` plus alpha by
 * the browser, so a site's colour syntax (variables, `oklch()`, `color-mix()`) never reaches here.
 */

export interface SeenColor {
  hex: string;
  alpha: number;
}

export interface WeightedColor extends SeenColor {
  weight: number;
}

export interface RawCta {
  text: string;
  href: string | null;
  placement: 'nav' | 'hero' | 'body' | 'footer';
  background: SeenColor | null;
  color: SeenColor;
  border: SeenColor | null;
  radius: number;
  pill: boolean;
  area: number;
}

export interface RawStyles {
  /** The colour painted behind the body: its own, the root element's, or the canvas white. */
  root: string;
  /** The painted background at sample points across the first screens, weighted by count. */
  backgrounds: WeightedColor[];
  /**
   * Text colours weighted by the number of visible characters in that colour. `link` is text in a
   * link or button, which takes the link or button colour; `chrome` is text in the navigation,
   * header or footer. Neither is the colour of the body copy.
   */
  texts: (WeightedColor & { heading: boolean; link?: boolean; chrome?: boolean })[];
  links: WeightedColor[];
  ctas: RawCta[];
  /** Border radius in px of cards and panels, weighted by count. */
  cardRadii: { px: number; weight: number }[];
  /** Custom properties on the root element that resolve to a colour. */
  colorVariables: { name: string; hex: string; alpha: number }[];
  /** The `color-scheme` the page declares, from CSS or its meta tag, such as `light dark`. */
  colorScheme: string;
}

export interface RawFontUse {
  role: 'display' | 'body' | 'mono' | 'button';
  stack: string;
  weight: number;
}

export interface RawFontFace {
  family: string;
  src: string;
  weight: string;
  style: string;
  unicodeRange: string;
}

export interface RawFonts {
  uses: RawFontUse[];
  loaded: { family: string; weight: string; style: string }[];
  stylesheets: string[];
  faces: RawFontFace[];
  /** Stylesheets whose rules the page may not read, fetched by the tool instead. */
  unreadable: string[];
}

export interface RawLogoCandidate {
  kind: 'img' | 'inline-svg' | 'background' | 'icon' | 'apple-touch-icon' | 'manifest' | 'og-image';
  url: string | null;
  svg: string | null;
  alt: string;
  width: number;
  height: number;
  inHeader: boolean;
  homeLink: boolean;
  logoHint: boolean;
  type: string;
}

export interface RawUiCandidate {
  kind: 'img' | 'video' | 'iframe' | 'canvas' | 'frame';
  src: string | null;
  label: string;
  top: number;
  left: number;
  width: number;
  height: number;
  /** An HTML mockup, whose figures are samples, rather than a picture of the product. */
  mock: boolean;
  score: number;
}

export interface RawLink {
  url: string;
  text: string;
  where: 'nav' | 'header' | 'footer' | 'body';
}

export interface RawPage {
  url: string;
  title: string;
  lang: string;
  text: { rendered: string; dom: string; meta: string; clean: string; illustrative: string };
  headings: { level: number; text: string }[];
  links: RawLink[];
  external: RawLink[];
  ctas: RawCta[];
  loginLinks: RawLink[];
  ui: RawUiCandidate[];
  media: { kind: 'video' | 'iframe'; src: string }[];
  meta: Record<string, string>;
  height: number;
  /** Elements hidden for screenshots: cookie banners and pop-ups. Their text was read first. */
  hidden: number;
  styles: RawStyles | null;
  fonts: RawFonts | null;
  logos: RawLogoCandidate[];
}
