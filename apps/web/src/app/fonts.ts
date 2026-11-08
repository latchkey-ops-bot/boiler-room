import { Bricolage_Grotesque, JetBrains_Mono, Nunito, Pixelify_Sans } from 'next/font/google';

/**
 * The four faces in DESIGN.md, self-hosted by next/font. Each sets a CSS variable that the
 * --br-font-* tokens use. All four are variable fonts, so every weight the design names is in one
 * file: Bricolage 700 and 800 with its optical size axis, Nunito 400 to 800, JetBrains Mono 400 and
 * 600, Pixelify Sans 700.
 */
export const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  axes: ['opsz'],
  display: 'swap',
  variable: '--font-bricolage',
});

export const nunito = Nunito({ subsets: ['latin'], display: 'swap', variable: '--font-nunito' });

export const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains',
});

export const pixelify = Pixelify_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-pixelify',
});

export const fontVariables = [bricolage, nunito, jetbrains, pixelify]
  .map((font) => font.variable)
  .join(' ');
