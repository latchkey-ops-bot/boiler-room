import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

/** The site's four faces (apps/web/src/app/fonts.ts), as the latin variable files next/font serves. */
const FACES = [
  {
    family: 'Bricolage Grotesque',
    file: 'fonts/bricolage-grotesque-latin.woff2',
    weight: '200 800',
  },
  { family: 'Nunito', file: 'fonts/nunito-latin.woff2', weight: '200 1000' },
  { family: 'JetBrains Mono', file: 'fonts/jetbrains-mono-latin.woff2', weight: '100 800' },
  { family: 'Pixelify Sans', file: 'fonts/pixelify-sans-latin.woff2', weight: '400 700' },
];

export const fontsLoaded = Promise.all(
  FACES.map(({ family, file, weight }) => loadFont({ family, url: staticFile(file), weight })),
);
