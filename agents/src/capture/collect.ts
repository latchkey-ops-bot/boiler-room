import type {
  RawControl,
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
 * body. It reads the document and writes marker attributes: `data-br-overlay` on cookie banners,
 * dialogs, their scrims and other fixed overlays, `data-br-header` on a fixed or sticky site
 * header, which the capture hides for screenshots of product UI further down the page, and the
 * concealed and hidden text markers. Once the text has been read, it hides the overlays it marked
 * with a stylesheet, so nothing after that (buttons, product UI, colours, fonts, logos) is measured
 * from an overlay; the capture keeps them hidden for every screenshot. It scrolls the window to
 * sample colours and returns to the top.
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
  const walkText = (
    root: Element,
    exclude?: (el: Element) => boolean,
    keep?: (parent: Element) => boolean,
  ): string => {
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
      if (keep && (!parent || !keep(parent))) continue;
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

  // Text styled so nobody sees it: the colour of what is behind it, a font too small to read, or a
  // box too small to show it. A page can hide instructions or figures this way. It is kept apart
  // from the visible text, so it is never read as the page's copy and never quoted as a claim.
  const luminance = (hex: string) => {
    const value = Number.parseInt(hex.slice(1), 16);
    const channel = (part: number) => {
      const srgb = part / 255;
      return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    };
    return (
      0.2126 * channel((value >> 16) & 255) +
      0.7152 * channel((value >> 8) & 255) +
      0.0722 * channel(value & 255)
    );
  };
  const ratio = (first: string, second: string) => {
    const a = luminance(first);
    const b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const over = (color: SeenColor, under: string) => {
    if (color.alpha >= 1) return color.hex;
    const top = Number.parseInt(color.hex.slice(1), 16);
    const bottom = Number.parseInt(under.slice(1), 16);
    const mix = (shift: number) =>
      Math.round(
        ((top >> shift) & 255) * color.alpha + ((bottom >> shift) & 255) * (1 - color.alpha),
      );
    return `#${[16, 8, 0].map((shift) => mix(shift).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  };
  const INVISIBLE = 1.3;
  const concealed = new Set<Element>();
  /** Concealed text in a box of 2 px or less, with that box: the "visually hidden" pattern. */
  const tiny = new Map<Element, Element>();
  const suspects: Element[] = [];
  const CLIPS = /hidden|clip|auto|scroll/;
  const clipsContent = (style: CSSStyleDeclaration) =>
    CLIPS.test(style.overflowX) ||
    CLIPS.test(style.overflowY) ||
    (style.clip !== 'auto' && style.clip !== '') ||
    style.clipPath !== 'none';
  /** The box of 2 px or less, the element or one just above it, that clips the element away. */
  const tinyBox = (el: Element): Element | null => {
    let node: Element | null = el;
    for (let depth = 0; node && node !== body && depth < 4; depth++, node = node.parentElement) {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 2 && rect.height <= 2 && (node === el || clipsContent(styleOf(node))))
        return node;
    }
    return null;
  };
  for (const el of Array.from(body.querySelectorAll('*')).slice(0, 8000)) {
    if (SKIP.has(el.tagName)) continue;
    let chars = 0;
    for (const node of Array.from(el.childNodes))
      if (node.nodeType === Node.TEXT_NODE) chars += (node.textContent ?? '').trim().length;
    if (chars === 0) continue;
    const box = tinyBox(el);
    if (box && box !== el) {
      concealed.add(el);
      tiny.set(el, box);
      continue;
    }
    if (!visible(el)) continue;
    const style = styleOf(el);
    if (box) {
      concealed.add(el);
      tiny.set(el, el);
      continue;
    }
    if ((Number.parseFloat(style.fontSize) || 16) < 3) {
      concealed.add(el);
      continue;
    }
    const color = toColor(style.color);
    if (!color || color.alpha < 0.1) {
      concealed.add(el);
      continue;
    }
    if (ratio(over(color, painted(el).hex), painted(el).hex) < INVISIBLE) suspects.push(el);
  }
  // A suspect may sit on a picture, a video or a gradient that the colours above cannot see, as a
  // white headline on a hero photo does. What is really behind it is read at its position, with
  // every element made hit-testable for the moment, and only a plain matching colour conceals it.
  if (suspects.length > 0) {
    const probe = document.createElement('style');
    probe.textContent = '* { pointer-events: auto !important; }';
    document.head.appendChild(probe);
    const MEDIA = /^(img|video|canvas|picture|iframe|svg|object|embed)$/i;
    for (const el of suspects.slice(0, 60)) {
      const first = el.getBoundingClientRect();
      window.scrollTo(0, Math.max(0, first.top + window.scrollY - vh / 3));
      const rect = el.getBoundingClientRect();
      const x = rect.left + Math.min(rect.width / 2, 24);
      const y = rect.top + Math.min(rect.height / 2, 12);
      if (x < 0 || y < 0 || x >= vw || y >= vh) continue;
      const stack = document.elementsFromPoint(x, y);
      const start = stack.indexOf(el);
      let backdrop: string | null = null;
      let onMedia = false;
      for (const below of stack.slice(start + 1)) {
        const style = styleOf(below);
        if (
          MEDIA.test(below.tagName) ||
          (style.backgroundImage && style.backgroundImage !== 'none')
        ) {
          onMedia = true;
          break;
        }
        const fill = toColor(style.backgroundColor);
        if (fill && fill.alpha >= 0.5) {
          backdrop = fill.hex;
          break;
        }
      }
      const own = styleOf(el).backgroundImage;
      if (onMedia || (own && own !== 'none')) continue;
      const color = toColor(styleOf(el).color);
      const behind = backdrop ?? '#FFFFFF';
      if (color && ratio(over(color, behind), behind) < INVISIBLE) concealed.add(el);
    }
    probe.remove();
    window.scrollTo(0, 0);
  }
  // A screen-reader twin: visually hidden text that says in words what an aria-hidden element
  // beside it draws, as an animated price or headline does. A visitor sees the drawing and a
  // screen reader reads the words, so the words are what the page shows. It counts only when the
  // drawing is on show, readable, and carries the same words: visually hidden text alone, or
  // beside a drawing of something else, stays concealed.
  const squash = (text: string) => text.replace(/\s+/g, '');
  const hasTwin = (box: Element): boolean => {
    const words = squash(box.textContent ?? '');
    if (words.length < 2) return false;
    let parent = box.parentElement;
    while (parent && styleOf(parent).display === 'contents') parent = parent.parentElement;
    if (!parent) return false;
    return Array.from(parent.querySelectorAll('[aria-hidden="true"]')).some((drawn) => {
      if (drawn.contains(box) || box.contains(drawn) || insideIllustrative(drawn)) return false;
      const rect = drawn.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4 || !visible(drawn)) return false;
      const color = toColor(styleOf(drawn).color);
      const behind = painted(drawn).hex;
      if (!color || color.alpha < 0.1 || ratio(over(color, behind), behind) < INVISIBLE)
        return false;
      const labels = [drawn, ...Array.from(drawn.querySelectorAll('[aria-label]'))].map(
        (node) => node.getAttribute('aria-label') ?? '',
      );
      return [drawn.textContent ?? '', ...labels].some((text) => squash(text).includes(words));
    });
  };
  const twinned = new Map<Element, boolean>();
  for (const [el, box] of tiny) {
    let known = twinned.get(box);
    if (known === undefined) {
      known = hasTwin(box);
      twinned.set(box, known);
    }
    if (known) concealed.delete(el);
  }

  // Text a visitor cannot see on the page as it loads, and which is never a claim: under
  // aria-hidden, not displayed or not visible, in a closed <details> other than its summary, in a
  // panel a collapsed control names (aria-expanded="false"), or in a collapsed panel, one that
  // clips its content to no height or no width, as an accordion does. A dialog's library can mark
  // the whole page aria-hidden while it is open; an aria-hidden element holding the page's main
  // content or its first heading is that, and does not hide the page.
  const closedPanels = new Set<Element>();
  for (const trigger of Array.from(
    document.querySelectorAll('[aria-expanded="false"][aria-controls]'),
  )) {
    for (const id of (trigger.getAttribute('aria-controls') ?? '').split(/\s+/).filter(Boolean)) {
      const panel = document.getElementById(id);
      if (panel && !panel.contains(trigger)) closedPanels.add(panel);
    }
  }
  // A box that clips what overflows it (overflow hidden or clip), nearest first. A slide of a
  // carousel that does not move on its own sits outside its track's box, where nobody sees it until
  // they click. A box that scrolls is not a clip: a visitor can scroll to what is in it.
  const CLIPS_AWAY = /hidden|clip/;
  const clipCache = new Map<Element, Element | null>();
  const clipOf = (el: Element): Element | null => {
    const parent = el.parentElement;
    if (!parent || parent === body || parent === document.documentElement) return null;
    let known = clipCache.get(parent);
    if (known === undefined) {
      const style = styleOf(parent);
      // What is inside a box that scrolls can be scrolled to, whatever clips the box itself.
      known =
        CLIPS_AWAY.test(style.overflowX) || CLIPS_AWAY.test(style.overflowY)
          ? parent
          : /auto|scroll/.test(`${style.overflowX} ${style.overflowY}`)
            ? null
            : clipOf(parent);
      clipCache.set(parent, known);
    }
    return known;
  };
  const clippedAway = (el: Element): boolean => {
    const rect = el.getBoundingClientRect();
    // A box of 2 px or less is the visually hidden pattern, which the concealed text rules read.
    if (rect.width <= 2 && rect.height <= 2) return false;
    if (rect.right + window.scrollX <= 0) return true;
    const clip = clipOf(el);
    if (!clip) return false;
    const style = styleOf(clip);
    const box = clip.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) return false;
    const x = CLIPS_AWAY.test(style.overflowX);
    const y = CLIPS_AWAY.test(style.overflowY);
    return (
      (x && (rect.right <= box.left + 1 || rect.left >= box.right - 1)) ||
      (y && (rect.bottom <= box.top + 1 || rect.top >= box.bottom - 1))
    );
  };
  const hidesItself = (el: Element): boolean => {
    if (el.getAttribute('aria-hidden') === 'true' && !el.querySelector('main, [role="main"], h1'))
      return true;
    if (closedPanels.has(el)) return true;
    if (styleOf(el).position !== 'fixed' && clippedAway(el)) return true;
    const parent = el.parentElement;
    if (
      parent?.tagName === 'DETAILS' &&
      !(parent as HTMLDetailsElement).open &&
      el !== parent.querySelector(':scope > summary')
    )
      return true;
    const style = styleOf(el);
    if (!CLIPS.test(style.overflowX) && !CLIPS.test(style.overflowY)) return false;
    const rect = el.getBoundingClientRect();
    return (rect.height < 2 && rect.width >= 2) || (rect.width < 2 && rect.height >= 2);
  };
  const chainCache = new Map<Element, boolean>();
  const hiddenChain = (el: Element | null): boolean => {
    if (!el || el === body || el === document.documentElement) return false;
    let known = chainCache.get(el);
    if (known === undefined) {
      known = hidesItself(el) || hiddenChain(el.parentElement);
      chainCache.set(el, known);
    }
    return known;
  };
  const shownCache = new Map<Element, boolean>();
  /** Whether the browser draws the element at all: displayed, and its visibility visible. */
  const drawn = (el: Element): boolean => {
    let box: Element | null = el;
    while (box && box !== body && styleOf(box).display === 'contents') box = box.parentElement;
    if (!box || box === body) return true;
    let known = shownCache.get(box);
    if (known === undefined) {
      const check = (box as Element & { checkVisibility?: (options: object) => boolean })
        .checkVisibility;
      known = check
        ? check.call(box, { visibilityProperty: true, checkVisibilityCSS: true })
        : styleOf(box).display !== 'none' && styleOf(box).visibility === 'visible';
      shownCache.set(box, known);
    }
    return known;
  };
  const isHidden = (parent: Element) => hiddenChain(parent) || !drawn(parent);
  let hiddenMarks = 0;
  for (const el of Array.from(body.querySelectorAll('*')))
    if (!SKIP.has(el.tagName) && hidesItself(el) && !hiddenChain(el.parentElement)) {
      el.setAttribute('data-br-hidden', '1');
      hiddenMarks += 1;
    }

  // A footnote's marker, such as the "2" in "enabled2", is a link to a note, not a word of the
  // sentence: it is left out of the visible text, so it is never quoted as a figure.
  const noteRefs = Array.from(
    document.querySelectorAll(
      'sup a[href^="#"], a[href^="#fn"], [role="doc-noteref"], .footnote-ref, sup.reference',
    ),
  )
    .map((el) => el.closest('sup') ?? el)
    .filter((el) => (el.textContent ?? '').trim().length <= 4);
  for (const el of noteRefs) el.setAttribute('data-br-noteref', '1');
  const isNoteRef = (el: Element) => el.closest('[data-br-noteref]') !== null;

  // Words in two boxes side by side with a gap between them read as two words, though the markup
  // runs them together, as "$12" and "per user/month" in two spans do. A space is put in for the
  // reading and taken out after. Every box is measured first, so the page lays out once.
  const gaps: Element[] = [];
  for (const el of Array.from(body.querySelectorAll('*')).slice(0, 8000)) {
    const before = el.previousSibling;
    const prev = el.previousElementSibling;
    if (!prev || before !== prev || SKIP.has(el.tagName)) continue;
    if (!styleOf(el).display.startsWith('inline') || !styleOf(prev).display.startsWith('inline'))
      continue;
    if (!(el.textContent ?? '').trim() || !(prev.textContent ?? '').trim()) continue;
    if (/\s$/.test(prev.textContent ?? '') || /^\s/.test(el.textContent ?? '')) continue;
    const a = prev.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const sameLine = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0;
    if (sameLine && b.left - a.right >= 2) gaps.push(el);
  }
  const spaces = gaps.map((el) => {
    const space = document.createTextNode(' ');
    el.before(space);
    return space;
  });

  for (const el of concealed) el.setAttribute('data-br-concealed', '1');
  const concealedText = concealed.size
    ? walkText(body, undefined, (parent) => concealed.has(parent) && !isHidden(parent))
    : '';
  const hiddenText = walkText(body, undefined, (parent) => isHidden(parent));

  // What a visitor sees: innerText with the concealed and the hidden text taken out.
  let rendered = '';
  {
    const hide = document.createElement('style');
    hide.textContent =
      '[data-br-concealed], [data-br-hidden], [data-br-noteref] { display: none !important; }';
    if (concealed.size || hiddenMarks || noteRefs.length) document.head.appendChild(hide);
    // biome-ignore lint/performance/useDomNodeTextContent: the rendered text is what a reader sees, which is what is captured here
    rendered = (body as HTMLElement).innerText ?? '';
    hide.remove();
  }
  const dom = walkText(body);
  const clean = walkText(
    body,
    (el) => illustrative.has(el),
    (parent) => !concealed.has(parent) && !isHidden(parent) && !isNoteRef(parent),
  );
  const illustrativeText = [...illustrative].map((el) => walkText(el)).join('\n');
  for (const space of spaces) space.remove();

  // Controls that set the billing period prices are shown for, and their state as the page
  // loads: a price shown with "Billed yearly" switched on is not the monthly price.
  const PERIOD = /\b(years?|yearly|annual|annually|annum|months?|monthly)\b/i;
  const labelOf = (el: Element): string => {
    const own = el.getAttribute('aria-label');
    if (own) return own;
    const by = (el.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (by.trim()) return by;
    const input = el as HTMLInputElement;
    const label = input.labels?.[0]?.textContent ?? el.closest('label')?.textContent ?? '';
    if (label.trim()) return label;
    // biome-ignore lint/performance/useDomNodeTextContent: the label a visitor reads
    const text = (el as HTMLElement).innerText ?? el.textContent ?? '';
    if (text.trim()) return text;
    // A bare switch is labelled by the words beside it, as in "Monthly [switch] Yearly" or a
    // switch with "Billed yearly" next to it: the nearest enclosing box with a few words.
    let box = el.parentElement;
    for (let depth = 0; box && box !== body && depth < 4; depth++, box = box.parentElement) {
      // biome-ignore lint/performance/useDomNodeTextContent: the label a visitor reads
      const around = ((box as HTMLElement).innerText ?? '').trim();
      if (around) return around.length <= 80 ? around : '';
    }
    return '';
  };
  const controls: RawControl[] = [];
  for (const el of Array.from(
    document.querySelectorAll(
      '[role="switch"], [role="tab"], [role="radio"], [role="checkbox"], input[type="checkbox"], input[type="radio"], button[aria-pressed], [aria-checked], [aria-selected]',
    ),
  )) {
    // A switch drawn over a hidden native checkbox keeps its state in the checkbox.
    if (controls.length >= 12 || (isHidden(el) && !(el instanceof HTMLInputElement))) continue;
    const label = clip(labelOf(el), 80);
    if (!PERIOD.test(label)) continue;
    const on =
      el.getAttribute('aria-checked') === 'true' ||
      el.getAttribute('aria-selected') === 'true' ||
      el.getAttribute('aria-pressed') === 'true' ||
      (el instanceof HTMLInputElement && el.checked);
    const role =
      el.getAttribute('role') ??
      (el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase());
    if (!controls.some((item) => item.label === label && item.on === on && item.role === role))
      controls.push({ role, label, on });
  }
  const contactFields = Array.from(
    document.querySelectorAll(
      'input[type="email"], input[type="tel"], input[autocomplete="email"], input[autocomplete="tel"], input[name*="email" i], input[name*="phone" i]',
    ),
  ).filter((el) => visible(el) && !isHidden(el)).length;

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

  // Cookie banners, dialogs, their scrims and other fixed overlays. Their text is read above.
  // They are marked, then hidden at once, so the buttons, product UI and colours below are never
  // read from them: a dialog's dark scrim is not the page's background. A fixed layer counts as an
  // overlay when it covers much of the screen and is on top there, unless it holds the page's own
  // content (its main element, its first heading or most of its text): then it is the page.
  let hidden = 0;
  const OVERLAY_TEXT =
    /cookie|consent|gdpr|we use|accept all|reject all|newsletter|subscribe|% off|discount|bonus/i;
  const CONSENT_TEXT = /cookie|consent|gdpr|accept all|reject all/i;
  const firstHeading = body.querySelector('h1');
  const bodyChars = (body.textContent ?? '').length || 1;
  const holdsPage = (el: Element) =>
    el.querySelector('main, [role="main"]') !== null ||
    (firstHeading !== null && el.contains(firstHeading)) ||
    (el.textContent ?? '').length > bodyChars * 0.5;
  const onScreen = (rect: DOMRect) =>
    (Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0)) *
      Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0))) /
    (vw * vh);
  const touchable = document.createElement('style');
  touchable.textContent = '* { pointer-events: auto !important; }';
  document.head.appendChild(touchable);
  const onTop = (el: Element, rect: DOMRect) => {
    const x = Math.min(vw - 1, Math.max(0, rect.left + rect.width / 2));
    const y = Math.min(vh - 1, Math.max(0, rect.top + rect.height / 2));
    const top = document.elementFromPoint(x, y);
    return top !== null && el.contains(top);
  };
  for (const el of Array.from(body.querySelectorAll('*'))) {
    const style = styleOf(el);
    const dialog = el.matches(
      'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]',
    );
    const fixed = style.position === 'fixed';
    if (!dialog && !fixed && style.position !== 'sticky') continue;
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
    const share = onScreen(rect);
    const fill = toColor(style.backgroundColor);
    const scrim =
      fixed && share >= 0.5 && fill !== null && fill.alpha < 0.99 && text.trim().length < 40;
    const covering = fixed && share > 0.3 && !holdsPage(el) && onTop(el, rect);
    if (dialog || scrim || covering || (OVERLAY_TEXT.test(text) && share < 0.8)) {
      el.setAttribute('data-br-overlay', '1');
      hidden += 1;
    }
  }
  touchable.remove();
  if (hidden > 0) {
    const hide = document.createElement('style');
    hide.textContent =
      '[data-br-overlay] { display: none !important; } html, body { overflow: auto !important; }';
    document.head.appendChild(hide);
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
    // A link often wraps the element that is drawn as the button, and a button can paint its face
    // over its own fill, as a raised button's lighter top over its darker edge. The face a visitor
    // sees is the innermost box that covers the button with a fill of its own, or a border.
    let box = boxOf(el);
    let node: Element = el;
    for (let depth = 0; depth < 4; depth++) {
      const cover = Array.from(node.children).find((child) => {
        const inner = child.getBoundingClientRect();
        return visible(child) && inner.width * inner.height >= rect.width * rect.height * 0.6;
      });
      if (!cover) break;
      const drawn = boxOf(cover);
      if (drawn.filled || (!box.filled && drawn.border)) box = drawn;
      node = cover;
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
  // A decoration faded into the background, or a slide not on show. Being hidden from assistive
  // technology says nothing: sites mark their product mockups aria-hidden as illustrations.
  const decorative = (el: Element) => {
    let opacity = 1;
    for (let node: Element | null = el; node; node = node.parentElement)
      opacity *= Number(styleOf(node).opacity) || 0;
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
    // Every source, so a direct file next to a stream is seen: a film can use an .mp4.
    const sources = [
      video.currentSrc || video.src,
      ...Array.from(video.querySelectorAll('source')).map((item) => item.src),
    ].filter((item, index, list): item is string => Boolean(item) && list.indexOf(item) === index);
    for (const item of sources.length ? sources : src ? [src] : [])
      media.push({ kind: 'video', src: item });
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
    // The page background is what html and body paint. The samples below find a wrapper painted
    // over the body instead. Each sample is the first fully opaque fill in the stack of elements
    // under the point, so a semi-transparent layer (a scrim, a tinted glass header) never counts,
    // and a fixed background layer behind the content does.
    const opaqueFill = (el: Element) => {
      const fill = toColor(styleOf(el).backgroundColor);
      return fill && fill.alpha >= 0.99 ? fill.hex : null;
    };
    // A picture, a video or a background image is painted over whatever is behind it, but has no
    // one colour: a sample that lands on one is not counted, so a wallpaper never reads as the
    // body colour it covers.
    const PICTURE = /^(img|video|canvas|picture|iframe|object|embed)$/i;
    const pictured = (el: Element) => {
      if (PICTURE.test(el.tagName)) return true;
      const image = styleOf(el).backgroundImage;
      return Boolean(image && image !== 'none');
    };
    const rootFill = opaqueFill(body) ?? opaqueFill(document.documentElement);
    const bodyOwnBox = opaqueFill(document.documentElement) !== null && opaqueFill(body) !== null;
    const backgrounds = new Map<string, number>();
    const height = document.documentElement.scrollHeight;
    document.head.appendChild(touchable);
    for (const y of [0, vh, vh * 2]) {
      if (y > 0 && y >= height - vh / 2) break;
      window.scrollTo(0, y);
      await sleep(200);
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 16; col++) {
          const stack = document.elementsFromPoint(((col + 0.5) * vw) / 16, ((row + 0.5) * vh) / 9);
          const top = stack[0];
          if (!top || insideIllustrative(top)) continue;
          let hex: string | null = null;
          let picture = false;
          for (const el of stack) {
            // A layer behind the content (a negative z-index wallpaper) is hit after the body but
            // painted over the body's colour, unless html paints its own and the body its box.
            if (el === document.documentElement) continue;
            if (el === body) {
              if (bodyOwnBox) break;
              continue;
            }
            if (el.closest('[data-br-overlay]')) continue;
            hex = opaqueFill(el);
            if (hex) break;
            if (pictured(el)) {
              picture = true;
              break;
            }
          }
          if (!hex && !picture && (pictured(body) || pictured(document.documentElement)))
            picture = true;
          if (picture) continue;
          hex ??= rootFill ?? '#FFFFFF';
          backgrounds.set(hex, (backgrounds.get(hex) ?? 0) + 1);
        }
      }
    }
    touchable.remove();
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
      root: rootFill ?? '#FFFFFF',
      rootSet: rootFill !== null,
      overlays: hidden,
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
    let darkScheme = false;
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
          if (
            rule instanceof CSSMediaRule &&
            /prefers-color-scheme:\s*dark/i.test(rule.media.mediaText)
          )
            darkScheme = true;
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
    // The display font is the one the page's headings are set in, weighed by how much heading
    // text it sets and how large, outside the navigation, header and footer: one small hero line
    // or a row of tab labels in the body face does not outweigh every large section heading.
    const headingFonts = new Map<string, { stack: string; weight: number; score: number }>();
    for (const el of Array.from(body.querySelectorAll('h1, h2'))) {
      if (!visible(el) || insideIllustrative(el) || isHidden(el) || el.closest(CHROME)) continue;
      // biome-ignore lint/performance/useDomNodeTextContent: the heading a visitor reads
      const text = ((el as HTMLElement).innerText ?? '').trim();
      if (!text) continue;
      const style = styleOf(el);
      const size = Number.parseFloat(style.fontSize) || 16;
      const entry = headingFonts.get(style.fontFamily) ?? {
        stack: style.fontFamily,
        weight: Number.parseInt(style.fontWeight, 10) || 400,
        score: 0,
      };
      // A heading draws the eye by its size as much as by its words: weighed by its area.
      entry.score += Math.min(text.length, 80) * size * size * (el.tagName === 'H1' ? 1.5 : 1);
      headingFonts.set(style.fontFamily, entry);
    }
    const heading = [...headingFonts.values()].sort((a, b) => b.score - a.score)[0];
    if (styles) styles.darkScheme = darkScheme;
    fonts = {
      uses: [
        ...(heading
          ? [{ role: 'display' as const, stack: heading.stack, weight: heading.weight }]
          : [
              ...use('h1', 'display'),
              ...(document.querySelector('h1') ? [] : use('h2', 'display')),
            ]),
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
      // The colour a shape's author gave it, from the shape up to the svg: `currentColor` stays
      // `currentColor`, so the file keeps the site's way of recolouring its mark.
      const authored = (node: Element, prop: 'fill' | 'stroke'): string => {
        for (let item: Element | null = node; item; item = item.parentElement) {
          const value =
            (item as SVGElement).style?.getPropertyValue(prop) || item.getAttribute(prop) || '';
          if (value.trim()) return value.trim().toLowerCase();
          if (item === svg) break;
        }
        return '';
      };
      from.forEach((source, index) => {
        const target = to[index];
        // The capture's own markers are not part of the logo.
        for (const attr of Array.from(target?.attributes ?? []))
          if (attr.name.startsWith('data-br-')) target?.removeAttribute(attr.name);
        if (!target || !SHAPES.has(source.tagName.toLowerCase())) return;
        const style = styleOf(source);
        for (const [prop, opacity] of [
          ['fill', 'fill-opacity'],
          ['stroke', 'stroke-opacity'],
        ] as const) {
          const value = style.getPropertyValue(prop);
          const color = toColor(value);
          if (color && authored(source, prop) === 'currentcolor') {
            target.setAttribute(prop, 'currentColor');
          } else if (color) {
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
      // What `currentColor` is on the page, as a colour the file carries itself.
      const ink = toColor(styleOf(svg).color)?.hex ?? styleOf(svg).color;
      clone.setAttribute('color', ink);
      clone.style.setProperty('color', ink);
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
    text: {
      rendered,
      dom,
      meta: metaText,
      clean,
      illustrative: illustrativeText,
      concealed: concealedText,
      hidden: hiddenText,
    },
    headings,
    links,
    external,
    ctas,
    loginLinks,
    controls,
    contactFields,
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
