/**
 * Clerk's sign-in, sign-up and profile screens in Boiler Room's tokens: square corners, Pipe blue,
 * Nunito and Bricolage, and the pixel frame drawn with box-shadows. The colours are the tokens'
 * hex values, because Clerk's theme variables take colours, not CSS variables.
 *
 * The pixel is 3px on the marketing site, where sign-in and sign-up live, and 2px in the app,
 * where the profile opens. `clerkAppearanceFor(2)` is the app's.
 */

const INK = '#0B2E40';
const DEEP = '#086288';
const DEEP_PRESS = '#064E6D';
const STEEL = '#4D8DBA';
const SKY = '#97D7FF';

/** The four sides of a pixel frame, `px` thick. */
function frame(px: number, color: string): string[] {
  return [
    `0 -${px}px 0 0 ${color}`,
    `0 ${px}px 0 0 ${color}`,
    `-${px}px 0 0 0 ${color}`,
    `${px}px 0 0 0 ${color}`,
  ];
}

/** The hard drop, two pixels down and right, as `.px` draws it. */
function drop(px: number, color: string): string[] {
  const lift = px * 2;
  return [
    `${lift + px}px ${lift}px 0 0 ${color}`,
    `${lift}px ${lift + px}px 0 0 ${color}`,
    `${lift}px ${lift}px 0 0 ${color}`,
  ];
}

export function clerkAppearanceFor(px: 2 | 3) {
  // Fields and badges take the small frame in the design: 2px.
  const field = {
    borderRadius: 0,
    border: 'none',
    margin: '2px',
    backgroundColor: '#FFFFFF',
    boxShadow: frame(2, STEEL).join(', '),
    '&:focus, &:focus-within, &[data-focus]': {
      boxShadow: [...frame(2, DEEP), ...drop(2, SKY)].join(', '),
    },
    '&:hover': { boxShadow: frame(2, DEEP).join(', ') },
  };
  return {
    variables: {
      colorPrimary: DEEP,
      colorPrimaryForeground: '#FFFFFF',
      colorForeground: INK,
      colorMutedForeground: '#3D6A87',
      colorBackground: '#FFFFFF',
      colorInput: '#FFFFFF',
      colorInputForeground: INK,
      colorDanger: '#A82A20',
      colorSuccess: '#17654A',
      borderRadius: '0px',
      fontFamily: 'var(--br-font-body)',
      fontFamilyButtons: 'var(--br-font-display)',
      fontSize: '16px',
    },
    // The design's pixel frame instead of Clerk's soft shadow and gradient button: no blur, no
    // glow, no smooth gradients, no round corners.
    elements: {
      cardBox: {
        borderRadius: 0,
        margin: `${px}px`,
        boxShadow: [...frame(px, DEEP), ...drop(px, SKY)].join(', '),
      },
      card: { boxShadow: 'none', borderRadius: 0 },
      formFieldInput: field,
      otpCodeFieldInput: field,
      formButtonPrimary: {
        backgroundImage: 'none',
        backgroundColor: DEEP,
        color: '#FFFFFF',
        borderRadius: 0,
        margin: `${px}px`,
        fontFamily: 'var(--br-font-display)',
        fontWeight: 700,
        boxShadow: [...frame(px, INK), ...drop(px, SKY)].join(', '),
        '&:hover, &:focus': { backgroundColor: DEEP_PRESS },
        '&::before': { display: 'none' },
        '&::after': { display: 'none' },
      },
      socialButtonsBlockButton: { borderRadius: 0, boxShadow: frame(2, STEEL).join(', ') },
      avatarBox: { borderRadius: 0 },
      userPreviewAvatarBox: { borderRadius: 0 },
      footer: { backgroundImage: 'none', background: '#FFFBEF' },
    },
  };
}

/** The marketing site's: sign-in and sign-up. */
export const clerkAppearance = clerkAppearanceFor(3);

/** The app's, for the profile screen opened from Settings. */
export const clerkAppAppearance = clerkAppearanceFor(2);

/**
 * Clerk's words, where they would sit under our own heading. The first step of sign-in and sign-up
 * hides Clerk's heading (see `.cl-header` in app.css), so the page's h1 is the only one; the code
 * step keeps a short heading of its own.
 */
export const clerkLocalization = {
  signUp: {
    emailCode: {
      title: 'Check your email',
      subtitle: 'Enter the 6-digit code we just sent you.',
    },
  },
};
