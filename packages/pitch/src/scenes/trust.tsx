import { interpolate, useCurrentFrame } from 'remotion';
import { C, F } from '../brand.ts';
import { body, display, enter, Kicker, Pill, PixelBox, Rise, SceneShell, SIDE } from '../ui.tsx';
import type { SceneProps } from './types.ts';

/**
 * Live daily caps, from agents.get .budget.cap_micro_usd (company.json). The 4 GTM agents sit at
 * $0 (they cannot spend), which the footnote says rather than a $0 card that reads as a running
 * team.
 */
const CAPS = [
  { who: 'CEO', cap: '$5' },
  { who: 'Product', cap: '$4' },
  { who: 'Design', cap: '$5' },
  { who: 'Eng lead', cap: '$10' },
  { who: 'Engineer', cap: '$10' },
  { who: 'Researcher', cap: '$15' },
  { who: 'Director', cap: '$40' },
  { who: 'Art Director', cap: '$20' },
  { who: 'Quality Check', cap: '$15' },
];

function Rule({ n, title }: { n: number; title: string }) {
  return (
    <>
      <Kicker>{`Rule ${n} of 3`}</Kicker>
      <Rise style={{ position: 'absolute', left: SIDE, right: SIDE, top: 180 }}>
        <p style={display(92)}>{title}</p>
      </Rise>
    </>
  );
}

export function TrustCaps({ duration }: SceneProps) {
  return (
    <SceneShell duration={duration}>
      <Rule n={1} title="A daily budget cap on every agent." />
      <div
        style={{
          position: 'absolute',
          left: SIDE,
          right: SIDE,
          top: 400,
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 44,
        }}
      >
        {CAPS.map((c, i) => (
          <Rise key={c.who} delay={14 + i * 4}>
            <PixelBox lift={8} style={{ padding: '24px 28px', height: 190 }}>
              <p style={body(28, C.muted, 700)}>{c.who}</p>
              <p style={{ ...display(88), marginTop: 14 }}>{c.cap}</p>
            </PixelBox>
          </Rise>
        ))}
      </div>
      <Rise delay={64} style={{ position: 'absolute', left: SIDE, top: 900 }}>
        <p style={body(34, C.muted)}>
          Live caps on Naive, per agent, per day. The 4 GTM agents: $1 to $5 a day.
        </p>
      </Rise>
    </SceneShell>
  );
}

/**
 * The tripwire as apps/web/src/server/runner/watchdog.ts runs it: the org balance falling more than
 * TRIPWIRE_DAILY_FALL_USD within a day, measured from the day's starting balance, halts real films.
 * It is not a floor. The threshold is left off screen until the deployed value is confirmed.
 */
export function TrustTripwire({ duration }: SceneProps) {
  const frame = useCurrentFrame();
  const startLevel = 0.86;
  const wire = 0.38;
  const level = interpolate(frame, [20, duration - 50], [startLevel, 0.3], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const tripped = level <= wire;
  const width = 1600;
  const tag = {
    ...body(26, C.muted, 700),
    position: 'absolute',
    fontFamily: F.mono,
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    whiteSpace: 'nowrap',
  } as const;
  return (
    <SceneShell duration={duration}>
      <Rule n={2} title="A tripwire that halts films if the balance falls too far in a day." />
      <div style={{ position: 'absolute', left: SIDE, top: 480, width }}>
        <p style={body(30, C.muted, 700)}>Balance today</p>
        <PixelBox lift={8} style={{ marginTop: 56, height: 96, position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: `${level * 100}%`,
              background: tripped ? C.pink : C.sky,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: `${startLevel * 100}%`,
              top: -24,
              bottom: -24,
              width: 6,
              background: C.ink,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: `${wire * 100}%`,
              top: -24,
              bottom: -24,
              width: 6,
              background: C.attentionInk,
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: `${wire * 100}%`,
              width: `${(startLevel - wire) * 100}%`,
              top: -40,
              height: 4,
              background: C.attentionInk,
            }}
          />
        </PixelBox>
        <p style={{ ...tag, color: C.ink, left: startLevel * width - 180, top: 4 }}>Start of day</p>
        <p
          style={{
            ...tag,
            color: C.attentionInk,
            left: ((wire + startLevel) / 2) * width - 150,
            top: 4,
          }}
        >
          Most it may fall
        </p>
        <p style={{ ...tag, color: C.attentionInk, left: wire * width - 60, top: 232 }}>Tripwire</p>
      </div>
      <div
        style={{
          position: 'absolute',
          left: SIDE,
          top: 830,
          opacity: tripped ? enter(frame, 0) : 0,
        }}
      >
        <PixelBox
          fill={C.attentionSoft}
          frame={C.attentionInk}
          drop={C.pink}
          style={{ padding: '26px 44px', display: 'inline-block' }}
        >
          <p style={display(60, C.attentionInk)}>Too far down in one day: films halt.</p>
        </PixelBox>
      </div>
    </SceneShell>
  );
}

export function TrustQuotes({ duration }: SceneProps) {
  // A real claim from the delivered posthog.com film's campaign.json: text and quote match.
  const claim = 'Join 500,000+ teams already shipping with PostHog.';
  return (
    <SceneShell duration={duration}>
      <Rule n={3} title="Every claim on screen is a quote from the customer’s own site." />
      <div
        style={{
          position: 'absolute',
          left: SIDE,
          right: SIDE,
          top: 480,
          display: 'flex',
          gap: 64,
        }}
      >
        <Rise delay={16} style={{ flex: 1 }}>
          <p style={{ ...body(28, C.muted, 700), marginBottom: 20 }}>In the film</p>
          <PixelBox fill={C.ink} style={{ padding: '44px 48px', height: 300 }}>
            <p style={display(54, C.white)}>{claim}</p>
          </PixelBox>
        </Rise>
        <Rise delay={30} style={{ flex: 1 }}>
          <p style={{ ...body(28, C.muted, 700), marginBottom: 20 }}>On posthog.com</p>
          <PixelBox fill={C.cream} drop={C.creamDeep} style={{ padding: '44px 48px', height: 300 }}>
            <p style={{ ...body(44, C.ink, 600), fontStyle: 'italic' }}>&ldquo;{claim}&rdquo;</p>
          </PixelBox>
        </Rise>
      </div>
      <Rise delay={50} style={{ position: 'absolute', left: SIDE, top: 900 }}>
        <Pill fill={C.successSoft} color={C.successInk} size={28}>
          Word for word
        </Pill>
      </Rise>
    </SceneShell>
  );
}
