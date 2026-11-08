/**
 * Reads the visible text of an HTML page without a browser. Content a reader never sees is
 * dropped: `script`, `style`, `noscript`, `template`, `svg`, `head` content other than the title and
 * meta tags, and every element marked `hidden` or `aria-hidden="true"` with all it contains. Block
 * elements end a line, so a quote can be checked against block boundaries.
 */

export interface ParsedPage {
  title: string;
  /** `og:site_name`, or null. */
  siteName: string | null;
  description: string | null;
  /** The text of the first `h1`, or null. */
  h1: string | null;
  /** Visible text, one block per line. */
  text: string;
  /** Every `href`, resolved against the page. */
  links: string[];
  /** Addresses from `mailto:` links. */
  mailto: string[];
}

const DROP = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'iframe',
  'object',
  'canvas',
]);
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const BLOCK = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'td',
  'th',
  'tr',
  'ul',
  'option',
  'button',
  'label',
]);

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  copy: '©',
  reg: '®',
  trade: '™',
  middot: '·',
  bull: '•',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: Record<string, string>;
}

function readTag(source: string): Tag | null {
  const match = /^<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9-]*)([\s\S]*?)(\/)?\s*>$/.exec(source);
  if (!match) return null;
  const attrs: Record<string, string> = {};
  const body = match[3] ?? '';
  for (const attr of body.matchAll(
    /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
  )) {
    const key = (attr[1] ?? '').toLowerCase();
    if (!key) continue;
    attrs[key] = decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? '');
  }
  return {
    name: (match[2] ?? '').toLowerCase(),
    closing: Boolean(match[1]),
    selfClosing: Boolean(match[4]),
    attrs,
  };
}

const isHidden = (attrs: Record<string, string>) =>
  'hidden' in attrs ||
  attrs['aria-hidden']?.toLowerCase() === 'true' ||
  /display\s*:\s*none|visibility\s*:\s*hidden/i.test(attrs.style ?? '');

const squash = (text: string) =>
  text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').replace(/[ \t\f\v\r\u00A0]+/g, ' ');

/** Parses one page. `baseUrl` resolves relative links. */
export function parseHtml(html: string, baseUrl: string): ParsedPage {
  const tokens = html.replace(/<!--[\s\S]*?-->/g, '').split(/(<[^<>]*>)/);
  const out: string[] = [];
  const links: string[] = [];
  const mailto: string[] = [];
  let title = '';
  let siteName: string | null = null;
  let description: string | null = null;
  let h1: string | null = null;
  let h1Buffer: string[] | null = null;
  /** The element that started a dropped region, and how deep we are inside it. */
  let skip: { name: string; depth: number } | null = null;
  let inTitle = false;
  let inHead = false;

  for (const token of tokens) {
    if (!token) continue;
    if (token.startsWith('<')) {
      if (token.startsWith('<!') || token.startsWith('<?')) continue;
      const tag = readTag(token);
      if (!tag) {
        if (!skip) out.push(squash(decodeEntities(token)));
        continue;
      }
      if (skip) {
        if (tag.name === skip.name) {
          if (tag.closing) skip.depth -= 1;
          else if (!tag.selfClosing && !VOID.has(tag.name)) skip.depth += 1;
          if (skip.depth === 0) skip = null;
        }
        continue;
      }
      if (tag.name === 'head') inHead = !tag.closing;
      if (tag.name === 'body' && !tag.closing) inHead = false;
      if (tag.name === 'title') {
        inTitle = !tag.closing;
        continue;
      }
      if (!tag.closing && tag.name === 'meta') {
        const key = (tag.attrs.property ?? tag.attrs.name ?? '').toLowerCase();
        const content = tag.attrs.content ?? '';
        if (key === 'og:site_name' && content) siteName = squash(content).trim();
        if ((key === 'description' || key === 'og:description') && content && !description) {
          description = squash(content).trim();
        }
        continue;
      }
      if (!tag.closing && !VOID.has(tag.name) && !tag.selfClosing) {
        if (DROP.has(tag.name) || isHidden(tag.attrs)) {
          skip = { name: tag.name, depth: 1 };
          continue;
        }
      }
      if (!tag.closing && tag.name === 'a' && tag.attrs.href) {
        const href = tag.attrs.href.trim();
        if (/^mailto:/i.test(href)) {
          // Each recipient as written; `extract.ts` keeps only values that are exactly one address.
          let value = '';
          try {
            value = decodeURIComponent(href.slice(7).split('?')[0] ?? '');
          } catch {
            value = '';
          }
          for (const part of value.split(/[,;]/)) {
            const address = part.trim();
            if (address) mailto.push(address);
          }
        } else {
          try {
            links.push(new URL(href, baseUrl).toString());
          } catch {
            // Not a URL: ignored.
          }
        }
      }
      if (tag.name === 'h1') {
        if (!tag.closing && h1 === null) h1Buffer = [];
        else if (tag.closing && h1Buffer) {
          h1 = squash(h1Buffer.join('')).trim() || null;
          h1Buffer = null;
        }
      }
      if (BLOCK.has(tag.name)) out.push('\n');
      continue;
    }
    if (skip) continue;
    const text = squash(decodeEntities(token));
    if (inTitle) {
      title += text;
      continue;
    }
    if (inHead) continue;
    out.push(text);
    if (h1Buffer) h1Buffer.push(text);
  }

  const text = out
    .join('')
    .split('\n')
    .map((line) => line.replace(/ +/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return { title: squash(title).trim(), siteName, description, h1, text, links, mailto };
}
