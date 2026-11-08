/** Boiler Room's tokens, from apps/web/src/styles/tokens.css. */
export const C = {
  deep: '#086288',
  steel: '#4D8DBA',
  sky: '#97D7FF',
  cream: '#FFEFC4',
  ink: '#0B2E40',
  muted: '#3D6A87',
  paper: '#FFFBEF',
  white: '#FFFFFF',
  skySoft: '#DDF2FF',
  creamDeep: '#F4DB9A',
  pink: '#FF9EB5',
  mint: '#9FE3C1',
  successSoft: '#DDF7E9',
  successInk: '#17654A',
  errorInk: '#A82A20',
  attentionSoft: '#FFE1EA',
  attentionInk: '#A3214C',
} as const;

export const F = {
  display: "'Bricolage Grotesque', 'Nunito', sans-serif",
  body: "'Nunito', sans-serif",
  mono: "'JetBrains Mono', monospace",
  pixel: "'Pixelify Sans', monospace",
} as const;

/** The site's pixel frame: a notched outline and a hard, stepped drop shadow. */
export function pixelFrame(frame: string = C.ink, drop: string = C.sky, px = 4, lift = 12): string {
  return [
    `0 ${-px}px 0 0 ${frame}`,
    `0 ${px}px 0 0 ${frame}`,
    `${-px}px 0 0 0 ${frame}`,
    `${px}px 0 0 0 ${frame}`,
    `${lift + px}px ${lift}px 0 0 ${drop}`,
    `${lift}px ${lift + px}px 0 0 ${drop}`,
    `${lift}px ${lift}px 0 0 ${drop}`,
  ].join(', ');
}
