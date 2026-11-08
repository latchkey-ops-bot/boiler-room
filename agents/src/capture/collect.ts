import type {
  RawCta,
  RawFontFace,
  RawFonts,
  RawLink,
  RawLogoCandidate,
  RawPage,
  RawStyles,
  RawUiCandidate,
  SeenColor,
} from './types.ts';

export interface CollectOptions {
  /** Measure colours, radii and fonts. Done on the home page, where the brand is set. */
  withStyles: boolean;
  /** Look for logo candidates and favicons. */
  withLogos: boolean;
}

/**
 * Runs inside the page through `page.evaluate`, so it must not reference anything outside its own
 * body. It only reads the document. The one thing it writes is a marker attribute: `data-br-overlay`
 * on cookie banners and pop-ups, which the capture hides for every screenshot, and
 * `data-br-header` on a fixed or sticky site header, which it hides for screenshots of product UI
 * further down the page, after the text has been read. It scrolls the window to sample colours
 * and returns to the top.
 */
export async function collectPage(options: CollectOptions): Promise<RawPage> {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const body = document.body ?? document.documentElement;
  const host = (url: string) => {
    try {
      return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      return '';
    }
  };
  const siteHost = host(location.href);
  const clip = (text: string, max: number) => text.replace(/\s+/g, ' ').trim().slice(0, max);
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Colours: the browser converts any CSS colour syntax to sRGB bytes on a canvas.
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const colorCache = new Map<string, SeenColor | null>();
  const toColor = (value: string | null | undefined): SeenColor | null => {
    if (!value || !ctx) return null;
    const key = value.trim();
    if (!key || key === 'none' || key === 'transparent' || key.startsWith('url(')) return null;
    const cached = colorCache.get(key);
    if (cached !== undefined) return cached;
    ctx.fillStyle = '#000000';
    ctx.fillStyle = key;
    const first = ctx.fillStyle;
    ctx.fillStyle = '#ffffff';
    ctx.fillStyle = key;
    let result: SeenColor | null = null;
    if (first === ctx.fillStyle) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
      if (a > 0) {
        const hex =
          `#${[r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
        result = { hex, alpha: Math.round((a / 255) * 100) / 100 };
      }
    }
    colorCache.set(key, result);
    return result;
  };

  const styleOf = (el: Element) => getComputedStyle(el);
  const visible = (el: Element) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const style = styleOf(el);
    return (
      style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0.05
    );
  };
  const docTop = (rect: DOMRect) => rect.top + window.scrollY;
  const attrText = (el: Element) => {
    const parts = [el.id, el.getAttribute('class') ?? '', el.getAttribute('aria-label') ?? ''];
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('data-')) parts.push(`${attr.name} ${attr.value.slice(0, 40)}`);
    }
    return parts.join(' ');
  };

  /** The colour actually painted behind an element: its own or its nearest opaque ancestor's. */
  const paintedCache = new WeakMap<Element, SeenColor>();
  const painted = (start: Element | null): SeenColor => {
    const chain: Element[] = [];
    let el: Element | null = start;
    let found: SeenColor | null = null;
    while (el) {
      const cached = paintedCache.get(el);
      if (cached) {
        found = cached;
        break;
      }
      chain.push(el);
      const color = toColor(styleOf(el).backgroundColor);
      if (color && color.alpha >= 0.5) {
        found = { hex: color.hex, alpha: 1 };
        break;
      }
      el = el.parentElement;
    }
    const result = found ?? { hex: '#FFFFFF', alpha: 1 };
    for (const item of chain) paintedCache.set(item, result);
    return result;
  };

  // Text. `innerText` is what a reader sees; the walker below reads hidden text too (collapsed
  // answers, other tabs), joining text in different blocks with a space.
  const SKIP = new Set([
    'SCRIPT',
    'STYLE',
    'NOSCRIPT',
    'TEMPLATE',
    'IFRAME',
    'OBJECT',
    'HEAD',
    'CANVAS',
  ]);
  const blockCache = new WeakMap<Element, Element>();
  const blockOf = (start: Element): Element => {
    const cached = blockCache.get(start);
    if (cached) return cached;
    let el: Element = start;
    while (el.parentElement) {
      const display = styleOf(el).display;
      if (!(display.startsWith('inline') || display === 'contents')) break;
      el = el.parentElement;
    }
    blockCache.set(start, el);
    return el;
  };
  const walkText = (root: Element, exclude?: (el: Element) => boolean): string => {
    const parts: string[] = [];
    let lastBlock: Element | null = null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as Element;
          if (SKIP.has(el.tagName) || exclude?.(el)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node as Text).data;
      if (!text) continue;
      const parent = node.parentElement;
      const block = parent ? blockOf(parent) : null;
      if (parts.length > 0 && block !== lastBlock) parts.push(' ');
      parts.push(text);
      lastBlock = block;
    }
    return parts.join('');
  };

  // Product mockups, device frames, terminals and code: figures inside them are samples.
  const ILLUSTRATIVE =
    /(mock|sample|placeholder|dummy|illustrat|screenshot|dashboard|app-?frame|browser-?(frame|window|chrome|mock)|window-?frame|device-?frame|terminal|console-?(window|output)|code-?window|fake-?data|demo-?data)/i;
  const illustrative = new Set<Element>();
  for (const el of Array.from(body.querySelectorAll('*'))) {
    if (SKIP.has(el.tagName)) continue;
    const isCode = el.tagName === 'PRE';
    if (!isCode && !ILLUSTRATIVE.test(attrText(el))) continue;
    const rect = el.getBoundingClientRect();
    if (!isCode && (rect.width < 120 || rect.height < 80)) continue;
    let ancestor = el.parentElement;
    let nested = false;
    while (ancestor) {
      if (illustrative.has(ancestor)) {
        nested = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }
    if (!nested) illustrative.add(el);
  }

  const insideIllustrative = (start: Element) => {
    for (let el: Element | null = start; el; el = el.parentElement)
      if (illustrative.has(el)) return true;
    return false;
  };

  // biome-ignore lint/performance/useDomNodeTextContent: the rendered text is what a reader sees, which is what is captured here
  const rendered = (body as HTMLElement).innerText ?? '';
  const dom = walkText(body);
  const clean = walkText(body, (el) => illustrative.has(el));
  const illustrativeText = [...illustrative].map((el) => walkText(el)).join('\n');

  const meta: Record<string, string> = {};
  for (const tag of Array.from(document.querySelectorAll('meta[name], meta[property]'))) {
    const name = (tag.getAttribute('property') ?? tag.getAttribute('name') ?? '').toLowerCase();
    const content = tag.getAttribute('content') ?? '';
    if (
      content &&
      /^(description|og:|twitter:|theme-color|application-name|generator)/.test(name)
    ) {
      meta[name] = clip(content, 600);
    }
  }
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  if (canonical) meta.canonical = canonical;
  const alts = Array.from(document.images)
    .map((img) => clip(img.alt ?? '', 200))
    .filter(Boolean);
  const labels = Array.from(document.querySelectorAll('a[aria-label], button[aria-label]'))
    .map((el) => clip(el.getAttribute('aria-label') ?? '', 200))
    .filter(Boolean);
  const metaText = [document.title, ...Object.values(meta), ...alts, ...labels].join('\n');

  const headings = Array.from(body.querySelectorAll('h1, h2, h3'))
    .filter(visible)
    .slice(0, 60)
    .map((el) => ({
      level: Number(el.tagName.slice(1)),
      // biome-ignore lint/performance/useDomNodeTextContent: the rendered text is what a reader sees, which is what is captured here
      text: clip((el as HTMLElement).innerText ?? '', 200),
    }))
    .filter((item) => item.text);

  const where = (el: Element): RawLink['where'] => {
    if (el.closest('nav')) return 'nav';
    if (el.closest('header, [role="banner"]')) return 'header';
    if (el.closest('footer, [role="contentinfo"]')) return 'footer';
    return 'body';
  };
  const links: RawLink[] = [];
  const external: RawLink[] = [];
  const seenLinks = new Set<string>();
  for (const anchor of Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[]) {
    let url: URL;
    try {
      url = new URL(anchor.href, location.href);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    url.hash = '';
    const text = clip(
      // biome-ignore lint/performance/useDomNodeTextContent: the rendered text is what a reader sees, which is what is captured here
      anchor.innerText || anchor.getAttribute('aria-label') || anchor.title || '',
      80,
    );
    const item: RawLink = { url: url.href, text, where: where(anchor) };
    const key = `${item.url}|${item.where}`;
    if (seenLinks.has(key)) continue;
    seenLinks.add(key);
    if (host(url.href) === siteHost) {
      if (links.length < 400) links.push(item);
    } else if (external.length < 80) external.push(item);
  }

  const LOGIN_TEXT =
    /^(log ?in|sign ?in|sign ?up|get started|start (for )?free|try (it )?free|dashboard|console|open (the )?app|go to app|my account)\b/i;
  const LOGIN_URL =
    /(\/(log-?in|sign-?in|signin|sign-?up|signup|register|auth|dashboard|console|app)(\/|$|\?))|(^https?:\/\/(app|dashboard|console|login|auth|accounts?)\.)/i;
  const loginLinks = [...links, ...external]
    .filter((link) => LOGIN_TEXT.test(link.text) || LOGIN_URL.test(link.url))
    .slice(0, 20);

  // Cookie banners and pop-ups: marked so the screenshot can hide them. Their text is above.
  let hidden = 0;
  const OVERLAY_TEXT =
    /cookie|consent|gdpr|we use|accept all|reject all|newsletter|subscribe|% off|discount|bonus/i;
  const CONSENT_TEXT = /cookie|consent|gdpr|accept all|reject all/i;
  for (const el of Array.from(body.querySelectorAll('*'))) {
    const style = styleOf(el);
    const dialog = el.matches(
      'dialog[open], [role="dialog"][aria-modal="true"], [aria-modal="true"]',
    );
    if (!dialog && style.position !== 'fixed' && style.position !== 'sticky') continue;
    if (el.parentElement?.closest('[data-br-overlay]') || !visible(el)) continue;
    const rect = el.getBoundingClientRect();
    const text = (el as HTMLElement).textContent ?? '';
    const isHeader =
      rect.top <= 1 &&
      rect.height < 160 &&
      el.querySelector('a, nav') !== null &&
      !CONSENT_TEXT.test(text);
    if (isHeader) {
      el.setAttribute('data-br-header', '1');
      continue;
    }
    const share = (rect.width * rect.height) / (vw * vh);
    const zIndex = Number.parseInt(style.zIndex, 10) || 0;
    if (dialog || (OVERLAY_TEXT.test(text) && share < 0.8) || (zIndex >= 1000 && share > 0.3)) {
      el.setAttribute('data-br-overlay', '1');
      hidden += 1;
    }
  }

  // Calls to action: links and buttons drawn as buttons.
  const ctas: RawCta[] = [];
  const ctaElements = Array.from(
    document.querySelectorAll(
      'a, button, [role="button"], input[type="submit"], input[type="button"]',
    ),
  );
  for (const el of ctaElements) {
    if (ctas.length >= 60) break;
    if (el.closest('[data-br-overlay]') || !visible(el)) continue;
    // An inline link around a drawn button measures only its line of text; the button is the box.
    const only = el.children.length === 1 ? el.firstElementChild : null;
    let rect = el.getBoundingClientRect();
    if (only && styleOf(el).display === 'inline') {
      const inner = only.getBoundingClientRect();
      if (inner.width * inner.height > rect.width * rect.height) rect = inner;
    }
    if (rect.width < 40 || rect.height < 20 || rect.height > 120) continue;
    const text = clip(
      // biome-ignore lint/performance/useDomNodeTextContent: the rendered text is what a reader sees, which is what is captured here
      (el as HTMLElement).innerText ||
        (el as HTMLInputElement).value ||
        el.getAttribute('aria-label') ||
        '',
      60,
    );
    if (!text) continue;
    const parentPaint = painted(el.parentElement);
    const boxOf = (box: Element) => {
      const style = styleOf(box);
      const background = toColor(style.backgroundColor);
      const filled = Boolean(
        background && background.alpha >= 0.5 && background.hex !== parentPaint.hex,
      );
      const borderWidth = Number.parseFloat(style.borderTopWidth) || 0;
      const border =
        borderWidth >= 1 && style.borderTopStyle !== 'none' ? toColor(style.borderTopColor) : null;
      return { style, background, filled, border };
    };
    // A link often wraps the element that is drawn as the button. The drawn box is what shows.
    let box = boxOf(el);
    if (!box.filled && !box.border && only) {
      const innerRect = only.getBoundingClientRect();
      const covers = innerRect.width * innerRect.height >= rect.width * rect.height * 0.8;
      const drawn = boxOf(only);
      if (covers && (drawn.filled || drawn.border)) box = drawn;
    }
    const { style, background, filled, border } = box;
    const padded = (Number.parseFloat(style.paddingLeft) || 0) >= 6;
    const named = /btn|button|cta/i.test(el.getAttribute('class') ?? '');
    if (!(filled || (border && padded) || named)) continue;
    const radius = Number.parseFloat(style.borderTopLeftRadius) || 0;
    const top = docTop(rect);
    let fixed = false;
    for (let node: Element | null = el; node; node = node.parentElement) {
      const position = styleOf(node).position;
      if (position === 'fixed' || position === 'sticky') {
        fixed = true;
        break;
      }
    }
    const area = where(el);
    const placement: RawCta['placement'] =
      area === 'nav' || area === 'header' || (fixed && rect.top < 120)
        ? 'nav'
        : area === 'footer'
          ? 'footer'
          : top < vh
            ? 'hero'
            : 'body';
    const href =
      el instanceof HTMLAnchorElement
        ? el.href
        : ((el.closest('a') as HTMLAnchorElement | null)?.href ?? null);
    ctas.push({
      text,
      href,
      placement,
      background: filled ? background : null,
      color: toColor(styleOf(el).color) ?? { hex: '#000000', alpha: 1 },
      border,
      radius,
      pill: radius >= rect.height / 2 - 1,
      area: Math.round(rect.width * rect.height),
    });
  }

  // Product UI: real screenshots and videos, live embeds, canvases, and HTML mockups. Words are
  // matched whole, after camelCase is split, so "quiet" is not "ui" and "happy" is not "app".
  const UI_WORDS =
    /\b(dashboards?|screenshots?|screens?|apps?|product|ui|interface|console|editor|preview|demo|platform|analytics|workflows?|inbox|settings|form)\b/i;
  const uiWords = (text: string) => UI_WORDS.test(text.replace(/([a-z])([A-Z])/g, '$1 $2'));
  const DEMO_EMBED =
    /storylane|navattic|arcade|supademo|walnut|reprise|howdygo|tourial|\/(demo|tour|interactive)\b/i;
  const VIDEO_EMBED = /youtube|youtu\.be|vimeo|loom|wistia|vidyard|player\./i;
  // A decoration: hidden from assistive technology, or faded into the background.
  const decorative = (el: Element) => {
    let opacity = 1;
    for (let node: Element | null = el; node; node = node.parentElement) {
      if (node.getAttribute('aria-hidden') === 'true') return true;
      opacity *= Number(styleOf(node).opacity) || 0;
    }
    return opacity < 0.6;
  };
  const ui: RawUiCandidate[] = [];
  const media: RawPage['media'] = [];
  const addUi = (
    el: Element,
    kind: RawUiCandidate['kind'],
    src: string | null,
    label: string,
    score: number,
    mock: boolean,
    grade: RawUiCandidate['grade'],
  ) => {
    if (decorative(el)) return;
    const rect = el.getBoundingClientRect();
    ui.push({
      kind,
      src,
      label: clip(label, 120),
      top: Math.round(docTop(rect)),
      left: Math.round(rect.left + window.scrollX),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      mock,
      grade,
      score,
    });
  };
  for (const img of Array.from(document.images)) {
    if (!visible(img) || img.closest('header, nav')) continue;
    const rect = img.getBoundingClientRect();
    if (img.naturalWidth < 600 || rect.width < 360 || rect.height < 200) continue;
    const label = `${img.alt} ${img.currentSrc || img.src} ${img.getAttribute('class') ?? ''}`;
    if (/logo|avatar|portrait|headshot|team|photo|people|person/i.test(label)) continue;
    const named = uiWords(label);
    // A large picture with no word for a screen is often art, so it must fill a third of the width.
    if (!named && rect.width < vw / 3) continue;
    addUi(
      img,
      'img',
      img.currentSrc || img.src,
      img.alt,
      named ? 3 : 1,
      false,
      named ? 'product' : 'image',
    );
  }
  for (const video of Array.from(document.querySelectorAll('video')) as HTMLVideoElement[]) {
    const src =
      video.currentSrc || video.src || video.querySelector('source')?.src || video.poster || null;
    if (src) media.push({ kind: 'video', src });
    if (visible(video) && video.getBoundingClientRect().width >= 360)
      addUi(video, 'video', src, video.getAttribute('aria-label') ?? '', 2, false, 'media');
  }
  for (const frame of Array.from(document.querySelectorAll('iframe')) as HTMLIFrameElement[]) {
    const src = frame.src;
    if (!src) continue;
    const demo = DEMO_EMBED.test(src) && !VIDEO_EMBED.test(src);
    if (demo || VIDEO_EMBED.test(src) || /embed/i.test(src)) {
      media.push({ kind: 'iframe', src });
      if (visible(frame) && frame.getBoundingClientRect().width >= 360)
        addUi(frame, 'iframe', src, frame.title ?? '', 2, false, demo ? 'product' : 'media');
    }
  }
  for (const item of Array.from(document.querySelectorAll('canvas'))) {
    const rect = item.getBoundingClientRect();
    const label = attrText(item);
    if (visible(item) && rect.width >= 400 && rect.height >= 250)
      addUi(item, 'canvas', null, label, 1, false, uiWords(label) ? 'product' : 'media');
  }
  for (const el of illustrative) {
    if (el.tagName === 'PRE') continue;
    const rect = el.getBoundingClientRect();
    if (visible(el) && rect.width >= 400 && rect.height >= 250)
      addUi(el, 'frame', null, attrText(el), 1.5, true, 'product');
  }
  ui.sort((a, b) => b.score * b.width * b.height - a.score * a.width * a.height);

  let styles: RawStyles | null = null;
  let fonts: RawFonts | null = null;
  if (options.withStyles) {
    const backgrounds = new Map<string, number>();
    const height = document.documentElement.scrollHeight;
    for (const y of [0, vh, vh * 2]) {
      if (y > 0 && y >= height - vh / 2) break;
      window.scrollTo(0, y);
      await sleep(200);
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 16; col++) {
          const el = document.elementFromPoint(((col + 0.5) * vw) / 16, ((row + 0.5) * vh) / 9);
          if (!el || el.closest('[data-br-overlay]') || insideIllustrative(el)) continue;
          const color = painted(el);
          backgrounds.set(color.hex, (backgrounds.get(color.hex) ?? 0) + 1);
        }
      }
    }
    window.scrollTo(0, 0);

    const texts = new Map<
      string,
      {
        hex: string;
        alpha: number;
        weight: number;
        heading: boolean;
        link: boolean;
        chrome: boolean;
      }
    >();
    const CHROME =
      'nav, header, footer, [role="banner"], [role="navigation"], [role="contentinfo"]';
    const linkColors = new Map<string, { hex: string; alpha: number; weight: number }>();
    const cardRadii = new Map<number, number>();
    const all = Array.from(body.querySelectorAll('*')).slice(0, 6000);
    for (const el of all) {
      if (SKIP.has(el.tagName) || insideIllustrative(el)) continue;
      let chars = 0;
      for (const node of Array.from(el.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) chars += (node.textContent ?? '').trim().length;
      }
      if (chars === 0 && el.tagName !== 'A') {
        // Cards and panels: a filled box that differs from what is behind it.
        const rect = el.getBoundingClientRect();
        const area = rect.width * rect.height;
        if (area < 20000 || area > vw * vh * 0.6) continue;
        const style = styleOf(el);
        const radius = Number.parseFloat(style.borderTopLeftRadius) || 0;
        const fill = toColor(style.backgroundColor);
        const outlined = (Number.parseFloat(style.borderTopWidth) || 0) >= 1;
        if ((fill && fill.alpha >= 0.5 && fill.hex !== painted(el.parentElement).hex) || outlined) {
          cardRadii.set(Math.round(radius), (cardRadii.get(Math.round(radius)) ?? 0) + 1);
        }
        continue;
      }
      if (!visible(el)) continue;
      const color = toColor(styleOf(el).color);
      if (!color) continue;
      if (el.tagName === 'A') {
        const key = `${color.hex}|${color.alpha}`;
        const entry = linkColors.get(key) ?? { hex: color.hex, alpha: color.alpha, weight: 0 };
        entry.weight += 1;
        linkColors.set(key, entry);
      }
      if (chars > 0) {
        const heading = el.closest('h1, h2, h3') !== null;
        const link = el.closest('a, button, [role="button"]') !== null;
        const chrome = el.closest(CHROME) !== null;
        const key = `${color.hex}|${color.alpha}|${heading}|${link}|${chrome}`;
        const entry = texts.get(key) ?? {
          hex: color.hex,
          alpha: color.alpha,
          weight: 0,
          heading,
          link,
          chrome,
        };
        entry.weight += chars;
        texts.set(key, entry);
      }
    }

    const colorVariables: RawStyles['colorVariables'] = [];
    const rootStyle = styleOf(document.documentElement);
    const names = new Set<string>();
    // Names that declare a brand role are read first, so a large palette cannot crowd them out.
    const BRAND_NAME = /primary|brand|accent|main/i;
    for (let index = 0; index < rootStyle.length; index++) {
      const name = rootStyle.item(index);
      if (name.startsWith('--')) names.add(name);
    }
    if (names.size === 0) {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules)) {
          if (rule instanceof CSSStyleRule && /:root|^html/.test(rule.selectorText)) {
            for (const name of Array.from(rule.style)) if (name.startsWith('--')) names.add(name);
          }
        }
      }
    }
    const ordered = [...names].sort(
      (a, b) => Number(BRAND_NAME.test(b)) - Number(BRAND_NAME.test(a)),
    );
    for (const name of ordered) {
      if (colorVariables.length >= 200) break;
      const value = rootStyle.getPropertyValue(name).trim();
      if (!/^(#|rgb|hsl|hwb|lab|lch|oklab|oklch|color\()/i.test(value)) continue;
      const color = toColor(value);
      if (color) colorVariables.push({ name, hex: color.hex, alpha: color.alpha });
    }

    styles = {
      root: painted(body).hex,
      backgrounds: [...backgrounds].map(([hex, weight]) => ({ hex, alpha: 1, weight })),
      texts: [...texts.values()],
      links: [...linkColors.values()],
      ctas,
      cardRadii: [...cardRadii].map(([px, weight]) => ({ px, weight })),
      colorVariables,
      colorScheme:
        rootStyle.colorScheme && rootStyle.colorScheme !== 'normal'
          ? rootStyle.colorScheme
          : (document.querySelector('meta[name="color-scheme"]')?.getAttribute('content') ??
            'normal'),
    };

    const use = (selector: string, role: RawFonts['uses'][number]['role']) => {
      const el = Array.from(document.querySelectorAll(selector)).find(
        (item) => visible(item) && ((item as HTMLElement).textContent ?? '').trim().length > 0,
      );
      if (!el) return [];
      const style = styleOf(el);
      return [
        { role, stack: style.fontFamily, weight: Number.parseInt(style.fontWeight, 10) || 400 },
      ];
    };
    const paragraph = Array.from(document.querySelectorAll('p, li, main div')).find(
      (item) => visible(item) && ((item as HTMLElement).textContent ?? '').trim().length > 40,
    );
    const bodyStyle = styleOf(paragraph ?? body);
    const faces: RawFontFace[] = [];
    const unreadable: string[] = [];
    let declared = document.querySelector('[style*="font"]') !== null;
    // A relative url() in a stylesheet is relative to that stylesheet, so each face keeps it.
    const readRules = (rules: CSSRuleList, base: string) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSFontFaceRule) {
          faces.push({
            family: rule.style.getPropertyValue('font-family').replace(/^["']|["']$/g, ''),
            src: rule.style.getPropertyValue('src'),
            base,
            weight: rule.style.getPropertyValue('font-weight') || '400',
            style: rule.style.getPropertyValue('font-style') || 'normal',
            unicodeRange: rule.style.getPropertyValue('unicode-range'),
          });
        } else if (rule instanceof CSSImportRule && rule.styleSheet) {
          try {
            readRules(rule.styleSheet.cssRules, rule.styleSheet.href ?? base);
          } catch {
            if (rule.styleSheet.href) unreadable.push(rule.styleSheet.href);
          }
        } else if (rule instanceof CSSStyleRule) {
          if (rule.style.getPropertyValue('font-family') || rule.style.getPropertyValue('font'))
            declared = true;
          if (rule.cssRules?.length) readRules(rule.cssRules, base);
        } else if ('cssRules' in rule) {
          readRules((rule as CSSGroupingRule).cssRules, base);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        readRules(sheet.cssRules, sheet.href ?? location.href);
      } catch {
        if (sheet.href) unreadable.push(sheet.href);
      }
    }
    fonts = {
      uses: [
        ...use('h1', 'display'),
        ...(document.querySelector('h1') ? [] : use('h2', 'display')),
        {
          role: 'body',
          stack: bodyStyle.fontFamily,
          weight: Number.parseInt(bodyStyle.fontWeight, 10) || 400,
        },
        ...use('code, pre, kbd, samp', 'mono'),
      ],
      loaded: Array.from(document.fonts)
        .filter((face) => face.status === 'loaded')
        .slice(0, 60)
        .map((face) => ({
          family: face.family.replace(/^["']|["']$/g, ''),
          weight: face.weight,
          style: face.style,
        })),
      stylesheets: (
        Array.from(document.querySelectorAll('link[rel~="stylesheet"]')) as HTMLLinkElement[]
      )
        .map((link) => link.href)
        .filter(Boolean),
      faces: faces.slice(0, 200),
      unreadable: [...new Set(unreadable)].slice(0, 20),
      declared: declared || unreadable.length > 0,
    };
  }

  const logos: RawLogoCandidate[] = [];
  if (options.withLogos) {
    const isHome = (href: string | null | undefined) => {
      if (!href) return false;
      try {
        const url = new URL(href, location.href);
        return host(url.href) === siteHost && (url.pathname === '/' || url.pathname === '');
      } catch {
        return false;
      }
    };
    const LOGO_HINT = /logo|brand|wordmark|lockup/i;
    const context = (el: Element) => {
      const rect = el.getBoundingClientRect();
      const anchor = el.closest('a');
      const hint = `${attrText(el)} ${el.parentElement ? attrText(el.parentElement) : ''} ${anchor ? attrText(anchor) : ''}`;
      return {
        rect,
        inHeader: el.closest('header, nav, [role="banner"]') !== null || docTop(rect) < 160,
        homeLink: isHome(anchor?.href),
        logoHint: LOGO_HINT.test(hint) || LOGO_HINT.test(el.getAttribute('alt') ?? ''),
      };
    };
    for (const img of Array.from(document.images)) {
      if (!visible(img)) continue;
      const { rect, inHeader, homeLink, logoHint } = context(img);
      if (!(inHeader || logoHint) || docTop(rect) > 1200) continue;
      const url = img.currentSrc || img.src;
      logos.push({
        kind: 'img',
        url,
        svg: null,
        alt: img.alt ?? '',
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        inHeader,
        homeLink,
        logoHint: logoHint || LOGO_HINT.test(url),
        type: '',
      });
    }
    const SHAPES = new Set([
      'path',
      'rect',
      'circle',
      'ellipse',
      'polygon',
      'polyline',
      'line',
      'text',
      'tspan',
      'use',
    ]);
    for (const svg of Array.from(document.querySelectorAll('svg'))) {
      if (!visible(svg) || svg.closest('button')) continue;
      const { rect, inHeader, homeLink, logoHint } = context(svg);
      if (!inHeader || rect.width < 16) continue;
      const clone = svg.cloneNode(true) as SVGSVGElement;
      const from = [svg, ...Array.from(svg.querySelectorAll('*'))];
      const to = [clone, ...Array.from(clone.querySelectorAll('*'))];
      from.forEach((source, index) => {
        const target = to[index];
        if (!target || !SHAPES.has(source.tagName.toLowerCase())) return;
        const style = styleOf(source);
        for (const [prop, opacity] of [
          ['fill', 'fill-opacity'],
          ['stroke', 'stroke-opacity'],
        ] as const) {
          const value = style.getPropertyValue(prop);
          const color = toColor(value);
          if (color) {
            target.setAttribute(prop, color.hex);
            const own = Number.parseFloat(style.getPropertyValue(opacity)) || 1;
            if (color.alpha * own < 1)
              target.setAttribute(opacity, String(Math.round(color.alpha * own * 100) / 100));
          } else target.setAttribute(prop, value || 'none');
        }
      });
      for (const use of Array.from(clone.querySelectorAll('use'))) {
        const ref = use.getAttribute('href') ?? use.getAttribute('xlink:href');
        const target = ref?.startsWith('#') ? document.getElementById(ref.slice(1)) : null;
        if (target) {
          const defs =
            clone.querySelector('defs') ??
            clone.insertBefore(
              document.createElementNS('http://www.w3.org/2000/svg', 'defs'),
              clone.firstChild,
            );
          defs.appendChild(target.cloneNode(true));
        }
      }
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      if (!clone.getAttribute('width')) clone.setAttribute('width', String(Math.round(rect.width)));
      if (!clone.getAttribute('height'))
        clone.setAttribute('height', String(Math.round(rect.height)));
      clone.setAttribute('color', styleOf(svg).color);
      const markup = new XMLSerializer().serializeToString(clone);
      if (markup.length > 400000) continue;
      logos.push({
        kind: 'inline-svg',
        url: null,
        svg: markup,
        alt: svg.getAttribute('aria-label') ?? '',
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        inHeader,
        homeLink,
        logoHint,
        type: 'image/svg+xml',
      });
    }
    for (const el of Array.from(
      document.querySelectorAll('header *, nav *, [role="banner"] *'),
    ).slice(0, 400)) {
      const image = styleOf(el).backgroundImage;
      const match = /url\(["']?([^"')]+)["']?\)/.exec(image);
      if (!match?.[1] || !visible(el)) continue;
      const { rect, inHeader, homeLink, logoHint } = context(el);
      if (!logoHint && !homeLink) continue;
      logos.push({
        kind: 'background',
        url: new URL(match[1], location.href).href,
        svg: null,
        alt: '',
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        inHeader,
        homeLink,
        logoHint,
        type: '',
      });
    }
    for (const link of Array.from(
      document.querySelectorAll('link[rel][href]'),
    ) as HTMLLinkElement[]) {
      const rel = link.rel.toLowerCase();
      const kind: RawLogoCandidate['kind'] | null = rel.includes('apple-touch-icon')
        ? 'apple-touch-icon'
        : rel.includes('manifest')
          ? 'manifest'
          : rel.split(/\s+/).includes('icon') || rel.includes('mask-icon')
            ? 'icon'
            : null;
      if (!kind) continue;
      const size = Number.parseInt(link.sizes?.value?.split('x')[0] ?? '', 10) || 0;
      logos.push({
        kind,
        url: link.href,
        svg: null,
        alt: '',
        width: size,
        height: size,
        inHeader: false,
        homeLink: false,
        logoHint: false,
        type: link.type ?? '',
      });
    }
    logos.push({
      kind: 'icon',
      url: new URL('/favicon.ico', location.href).href,
      svg: null,
      alt: '',
      width: 0,
      height: 0,
      inHeader: false,
      homeLink: false,
      logoHint: false,
      type: 'image/x-icon',
    });
    const og = meta['og:image'];
    if (og)
      logos.push({
        kind: 'og-image',
        url: new URL(og, location.href).href,
        svg: null,
        alt: '',
        width: 0,
        height: 0,
        inHeader: false,
        homeLink: false,
        logoHint: false,
        type: '',
      });
  }

  return {
    url: location.href,
    title: document.title,
    lang: document.documentElement.lang || '',
    text: { rendered, dom, meta: metaText, clean, illustrative: illustrativeText },
    headings,
    links,
    external,
    ctas,
    loginLinks,
    ui: ui.slice(0, 6),
    media: media.slice(0, 20),
    meta,
    height: document.documentElement.scrollHeight,
    hidden,
    styles,
    fonts,
    logos,
  };
}
