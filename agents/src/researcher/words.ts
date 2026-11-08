/**
 * Whether a statement says only what its quotes say, word for word. The campaign validator checks
 * the numbers a text states against the quotes it cites; this checks the other words. Every content
 * word of the statement must be in a cited quote, after case, plurals and common endings are set
 * aside ("shipping" is "ship", "organizations" is "organization"). Words that only build the
 * sentence (articles, prepositions, pronouns, forms of "be" and "have") need no quote, nor do the
 * product's own name and the figures, which `unbackedNumbers` checks. So "Linear is a product
 * development system for planning and building products" is backed by "Purpose-built for planning
 * and building products", but "...and shipping products" is not: no quote says shipping.
 */

/** Words that build a sentence and state nothing about the product. */
const FUNCTION_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'nor',
  'but',
  'so',
  'yet',
  'if',
  'then',
  'than',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'of',
  'on',
  'onto',
  'to',
  'with',
  'via',
  'per',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'am',
  'has',
  'have',
  'had',
  'having',
  'do',
  'does',
  'did',
  'can',
  'could',
  'will',
  'would',
  'shall',
  'should',
  'may',
  'might',
  'must',
  'it',
  'its',
  'itself',
  'they',
  'them',
  'their',
  'theirs',
  'he',
  'him',
  'his',
  'she',
  'her',
  'hers',
  'we',
  'us',
  'our',
  'ours',
  'you',
  'your',
  'yours',
  'i',
  'me',
  'my',
  'this',
  'that',
  'these',
  'those',
  'which',
  'who',
  'whom',
  'whose',
  'what',
  'where',
  'when',
  'how',
  'there',
  'here',
  'also',
  'both',
  'either',
  'such',
]);

/**
 * Verbs that only relate a subject to what the quote says it has or does, as in "Linear lets teams
 * ..." or "The Free plan includes ...". What they relate must still be quoted.
 */
export const RELATION_WORDS: readonly string[] = [
  'lets',
  'let',
  'helps',
  'help',
  'offers',
  'offer',
  'provides',
  'provide',
  'includes',
  'include',
  'uses',
  'use',
  'gives',
  'give',
  'allows',
  'allow',
  'enables',
  'enable',
];

/**
 * Words a claim's own text may use to say where its quote is and how the page puts it, as in "The
 * pricing page lists ...". They describe the quote, not the product, and are allowed in a claim's
 * text only, never in the brief.
 */
export const ATTRIBUTION_WORDS: readonly string[] = [
  ...RELATION_WORDS,
  'home',
  'about',
  'pricing',
  'blog',
  'post',
  'docs',
  'changelog',
  'customers',
  'author',
  'argues',
  'plan',
  'costs',
  'priced',
  'says',
  'said',
  'say',
  'states',
  'stated',
  'reads',
  'writes',
  'written',
  'lists',
  'listed',
  'shows',
  'shown',
  'quotes',
  'describes',
  'described',
  'calls',
  'called',
  'names',
  'named',
  'mentions',
  'page',
  'site',
  'website',
  'headline',
  'subhead',
  'heading',
  'homepage',
  'section',
  'card',
];

/** Spelled-out figures: `unbackedNumbers` checks them as numbers, so they are not words here. */
const NUMBER_WORDS = new Set([
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
  'hundred',
  'hundreds',
  'thousand',
  'thousands',
  'million',
  'millions',
  'billion',
  'billions',
  'trillion',
  'half',
  'quarter',
  'third',
  'twice',
  'double',
  'triple',
  'dozen',
  'dozens',
]);

/**
 * The words of a text, lower case and without accents, possessives or apostrophes. A run of
 * letters glued to a figure ("10x", "1M", "$12per") belongs to the figure, which the number check
 * reads, so it is left out. Hyphenated words are their parts: "purpose-built" is "purpose" and
 * "built".
 */
export function wordsOf(text: string): string[] {
  const plain = text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[’‘ʼ`]/g, "'")
    .toLowerCase();
  const words: string[] = [];
  for (const match of plain.matchAll(/\p{L}+(?:'\p{L}+)*/gu)) {
    const before = plain[(match.index ?? 0) - 1] ?? '';
    const after = plain[(match.index ?? 0) + match[0].length] ?? '';
    if (/\p{N}/u.test(before) || (/\p{N}/u.test(after) && match[0].length <= 2)) continue;
    const word = match[0].replace(/'s$/, '').replace(/'/g, '');
    if (word) words.push(word);
  }
  return words;
}

const DOUBLED = /([bdfgkmnprtvz])\1$/;

/**
 * A word with its inflection set aside, so the forms of one word compare equal: plurals, -ing,
 * -ed, -ly and -ation endings, a final e, and British -ise spellings. It is deliberately light:
 * "-er" stays, since "customer" is not "custom" and "number" is not "numb".
 */
export function stem(input: string): string {
  let word = input.replace(/is(e|ed|es|ing|ation|ations)$/, 'iz$1');
  if (word.length <= 3) return word;
  if (word.endsWith('ies') && word.length > 4) word = `${word.slice(0, -3)}y`;
  else if (word.endsWith('ied') && word.length > 4) word = `${word.slice(0, -3)}y`;
  else if (word.endsWith('sses')) word = word.slice(0, -2);
  else if (word.endsWith('es') && /(ch|sh|x|z)es$/.test(word)) word = word.slice(0, -2);
  else if (word.endsWith('s') && !/(ss|us|is)$/.test(word)) word = word.slice(0, -1);
  for (const suffix of ['ations', 'ation', 'ingly', 'edly', 'ings', 'ing', 'ed', 'ly']) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) {
      word = word.slice(0, -suffix.length);
      if (DOUBLED.test(word)) word = word.slice(0, -1);
      break;
    }
  }
  if (word.endsWith('e') && word.length > 3) word = word.slice(0, -1);
  if (word.endsWith('y') && word.length > 3) word = `${word.slice(0, -1)}i`;
  return word;
}

export interface WordOptions {
  /** Names the statement may use freely: the brand's and the product's. */
  names?: readonly (string | undefined)[];
  /** Further words that need no quote, such as `ATTRIBUTION_WORDS` for a claim's own text. */
  allowed?: readonly string[];
}

/**
 * The content words of `statement` that none of `quotes` says, each once, in the order they
 * appear. Two quote words written as one ("sign up" for "signup") count as that word too.
 */
export function unbackedWords(
  statement: string,
  quotes: readonly string[],
  options: WordOptions = {},
): string[] {
  const backed = new Set<string>();
  for (const quote of quotes) {
    const words = wordsOf(quote);
    words.forEach((word, index) => {
      backed.add(stem(word));
      const next = words[index + 1];
      if (next) backed.add(stem(`${word}${next}`));
    });
  }
  const free = new Set<string>();
  for (const name of options.names ?? []) for (const word of wordsOf(name ?? '')) free.add(word);
  for (const word of options.allowed ?? []) free.add(word.toLowerCase());
  const missing: string[] = [];
  for (const word of wordsOf(statement)) {
    if (word.length < 2 || FUNCTION_WORDS.has(word) || NUMBER_WORDS.has(word) || free.has(word))
      continue;
    if (backed.has(stem(word)) || missing.includes(word)) continue;
    missing.push(word);
  }
  return missing;
}
