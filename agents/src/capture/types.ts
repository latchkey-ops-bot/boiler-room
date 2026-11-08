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
  /** The page background html and body paint: the body's opaque colour, else html's, else white. */
  root: string;
  /**
   * Whether html or body paints an opaque colour. False when both are transparent, so `root` is
   * only the browser's white canvas. Absent in captures from before it was measured.
   */
  rootSet?: boolean;
  /** Cookie banners, dialogs, scrims and fixed overlays hidden before the colours were measured. */
  overlays?: number;
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
  /** The stylesheet the rule is in. Its relative `url()`s resolve against this, not the page. */
  base?: string;
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
  /**
   * Whether any style the page could read sets a font. False means the text is in the browser's
   * default font, which is no choice of the site's.
   */
  declared?: boolean;
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
  /**
   * How likely it shows the product: `product` for a mockup, an interactive demo embed or an
   * image named as a screen of the product; `image` for any other large image; `media` for video,
   * video embeds and canvases, which show people, animations or nothing in a still frame.
   */
  grade: UiGrade;
  score: number;
}

export type UiGrade = 'product' | 'image' | 'media';

export interface RawLink {
  url: string;
  text: string;
  where: 'nav' | 'header' | 'footer' | 'body';
}

/**
 * A control that sets the billing period prices are shown for, as the page loads: a switch, tab,
 * radio or toggle button whose label names a year or a month, and whether it is on (checked,
 * selected or pressed).
 */
export interface RawControl {
  role: string;
  label: string;
  on: boolean;
}

export interface RawPage {
  url: string;
  title: string;
  lang: string;
  /**
   * `rendered` is what a visitor sees, `dom` all text, `clean` the visible text outside mockups,
   * `illustrative` the mockup text, `concealed` text styled so nobody can see it (the colour of
   * what is behind it, too small, or in a box too small to show it), and `hidden` text the page
   * does not show as it loads: aria-hidden, not displayed or not visible, in a closed `<details>`
   * or a collapsed accordion panel.
   */
  text: {
    rendered: string;
    dom: string;
    meta: string;
    clean: string;
    illustrative: string;
    concealed: string;
    hidden: string;
  };
  headings: { level: number; text: string }[];
  links: RawLink[];
  external: RawLink[];
  ctas: RawCta[];
  loginLinks: RawLink[];
  /** Billing-period controls and their state as the page loads. */
  controls: RawControl[];
  /** Visible fields that ask for an email address or a phone number: a form, not a product. */
  contactFields: number;
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
