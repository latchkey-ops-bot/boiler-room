/**
 * Clerk's sign-in and sign-up in Boiler Room's tokens: square corners, Pipe blue, Nunito and
 * Bricolage. The values are the tokens' hex values, because Clerk's theme takes colours, not CSS
 * variables.
 */
export const clerkAppearance = {
  variables: {
    colorPrimary: '#086288',
    colorPrimaryForeground: '#FFFFFF',
    colorForeground: '#0B2E40',
    colorMutedForeground: '#3D6A87',
    colorBackground: '#FFFFFF',
    colorInput: '#FFFFFF',
    colorInputForeground: '#0B2E40',
    colorDanger: '#A82A20',
    colorSuccess: '#17654A',
    borderRadius: '0px',
    fontFamily: 'var(--br-font-body)',
    fontFamilyButtons: 'var(--br-font-display)',
    fontSize: '16px',
  },
  // The design's pixel frame instead of Clerk's soft shadow and gradient button: no blur, no glow,
  // no smooth gradients.
  elements: {
    cardBox: {
      borderRadius: 0,
      boxShadow: [
        '0 -3px 0 0 #086288',
        '0 3px 0 0 #086288',
        '-3px 0 0 0 #086288',
        '3px 0 0 0 #086288',
        '9px 6px 0 0 #97D7FF',
        '6px 9px 0 0 #97D7FF',
        '6px 6px 0 0 #97D7FF',
      ].join(', '),
    },
    card: { boxShadow: 'none', borderRadius: 0 },
    formButtonPrimary: { backgroundImage: 'none', boxShadow: 'none', borderRadius: 0 },
    footer: { backgroundImage: 'none', background: '#FFFBEF' },
  },
};
