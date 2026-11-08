import type { CSSProperties, ReactNode } from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { C, F } from '../brand.ts';
import { body, display, enter, Kicker, Pill, PixelBox, Rise, SceneShell, SIDE } from '../ui.tsx';
import type { SceneProps } from './types.ts';

// Every fact below is from the data agent's company.json (pulled 2026-11-08T17:12:24Z).

export function CompanyIntro({ duration }: SceneProps) {
  const chips = ['Its own computer', 'Its own budget', 'Its own skills'];
  return (
    <SceneShell duration={duration}>
      <Kicker>The company</Kicker>
      <div style={{ position: 'absolute', left: SIDE, right: SIDE, top: 220 }}>
        <Rise>
          <p style={body(44, C.muted)}>The film crew is only half of it.</p>
        </Rise>
        <Rise delay={8} style={{ marginTop: 28 }}>
          <p style={display(112)}>Boiler Room is a company</p>
          <p style={display(112, C.ink)}>run by agents, on Naive.</p>
        </Rise>
        <div style={{ display: 'flex', gap: 48, marginTop: 84 }}>
          {chips.map((chip, i) => (
            <Rise key={chip} delay={34 + i * 8}>
              <PixelBox style={{ padding: '24px 36px' }}>
                <span style={body(40, C.deep, 800)}>{chip}</span>
              </PixelBox>
            </Rise>
          ))}
        </div>
        <Rise delay={70} style={{ marginTop: 72 }}>
          <p style={body(38, C.muted)}>13 agents: 9 run the company, 4 make the films.</p>
        </Rise>
      </div>
    </SceneShell>
  );
}

function OrgCard({
  x,
  y,
  w,
  h,
  title,
  line,
  delay,
  fill = C.white,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  line: string;
  delay: number;
  fill?: string;
}) {
  return (
    <Rise delay={delay} style={{ position: 'absolute', left: x, top: y, width: w, height: h }}>
      <PixelBox fill={fill} style={{ width: w, height: h, padding: '22px 28px' }}>
        <p style={display(42)}>{title}</p>
        <p style={{ ...body(27, C.ink), marginTop: 10 }}>{line}</p>
      </PixelBox>
    </Rise>
  );
}

/** A hard, pixel-straight connector that draws itself in. */
function Wire({
  style,
  delay,
  vertical,
}: {
  style: CSSProperties;
  delay: number;
  vertical?: boolean;
}) {
  const p = enter(useCurrentFrame(), delay, 12);
  return (
    <div
      style={{
        position: 'absolute',
        background: C.ink,
        transformOrigin: vertical ? 'top' : 'center',
        transform: vertical ? `scaleY(${p})` : `scaleX(${p})`,
        ...style,
      }}
    />
  );
}

function Group({
  x,
  y,
  w,
  title,
  names,
  delay,
}: {
  x: number;
  y: number;
  w: number;
  title: string;
  names: string[];
  delay: number;
}) {
  return (
    <Rise delay={delay} style={{ position: 'absolute', left: x, top: y, width: w }}>
      <PixelBox fill={C.cream} drop={C.creamDeep} style={{ padding: '24px 30px' }}>
        <p style={display(38)}>{title}</p>
        <div style={{ marginTop: 14, display: 'grid', gap: 6 }}>
          {names.map((name) => (
            <p key={name} style={body(28, C.ink)}>
              {name}
            </p>
          ))}
        </div>
      </PixelBox>
    </Rise>
  );
}

export function CompanyOrg({ duration }: SceneProps) {
  // Left: the CEO's board team. Right: go-to-market and the film crew.
  const row2 = 480;
  return (
    <SceneShell duration={duration}>
      <Kicker>Who works here</Kicker>
      <OrgCard
        x={500}
        y={190}
        w={460}
        h={190}
        title="CEO"
        line="Wakes every 2 hours, reads the board, decides what to build."
        delay={0}
        fill={C.skySoft}
      />
      <Wire vertical delay={14} style={{ left: 728, top: 386, width: 4, height: 50 }} />
      <Wire delay={20} style={{ left: 330, top: 434, width: 800, height: 4 }} />
      <Wire vertical delay={26} style={{ left: 328, top: 434, width: 4, height: 46 }} />
      <Wire vertical delay={26} style={{ left: 728, top: 434, width: 4, height: 46 }} />
      <Wire vertical delay={26} style={{ left: 1128, top: 434, width: 4, height: 46 }} />
      <OrgCard
        x={160}
        y={row2}
        w={340}
        h={150}
        title="Product"
        line="Writes the spec."
        delay={30}
      />
      <OrgCard
        x={560}
        y={row2}
        w={340}
        h={150}
        title="Design"
        line="Designs the screens."
        delay={36}
      />
      <OrgCard
        x={960}
        y={row2}
        w={340}
        h={150}
        title="Eng lead"
        line="Breaks it into cards."
        delay={42}
      />
      <Wire vertical delay={54} style={{ left: 1128, top: row2 + 156, width: 4, height: 74 }} />
      <OrgCard
        x={960}
        y={row2 + 236}
        w={340}
        h={150}
        title="Engineer"
        line="Opens pull requests."
        delay={60}
      />
      <Group
        x={1420}
        y={190}
        w={340}
        title="Go-to-market"
        names={['GTM lead', 'Scout', 'Social', 'Inbox reader']}
        delay={72}
      />
      <Group
        x={1420}
        y={566}
        w={340}
        title="Film crew"
        names={['Researcher', 'Director', 'Art Director', 'Quality Check']}
        delay={80}
      />
    </SceneShell>
  );
}

/** The first autonomous cycle, card by card, with the real UTC times from the CEO's board. */
const CYCLE: Card[] = [
  { at: '11:10:42', who: 'CEO', what: 'Sweep: reads the board' },
  { at: '11:10:57', who: 'CEO', what: 'DIR: scene-library-first-scene' },
  { at: '11:12:39', who: 'Product', what: 'Spec merged: design PR #13' },
  { at: '11:12:48', who: 'Product', what: 'BUILD: scene-library-first-scene' },
  { at: '11:13:37', who: 'Eng lead', what: 'ENG 1/3: status-relay layout' },
  { at: '11:21:34', who: 'Engineer', what: 'Pull request #32 opened' },
];

type Card = { at: string; who: string; what: string };

/** One board card on a timeline: its UTC time, who wrote it, and what it says. */
function CardRow({
  card,
  at,
  fill = C.white,
  drop = C.sky,
}: {
  card: Card;
  at: number;
  fill?: string;
  drop?: string;
}) {
  const p = enter(useCurrentFrame(), at, 10);
  return (
    <div style={{ opacity: p, transform: `translateX(${(1 - p) * 40}px)` }}>
      <PixelBox
        fill={fill}
        drop={drop}
        lift={8}
        style={{
          height: 104,
          padding: '0 28px',
          display: 'flex',
          alignItems: 'center',
          gap: 28,
        }}
      >
        <span
          style={{
            fontFamily: F.mono,
            fontWeight: 600,
            fontSize: 26,
            color: C.muted,
            width: 136,
            flexShrink: 0,
          }}
        >
          {card.at}
        </span>
        <span style={{ width: 190, flexShrink: 0 }}>
          <Pill size={20}>{card.who}</Pill>
        </span>
        <span style={body(30, C.ink, 700)}>{card.what}</span>
      </PixelBox>
    </div>
  );
}

const toSeconds = (hms: string) => {
  const [h = 0, m = 0, s = 0] = hms.split(':').map(Number);
  return h * 3600 + m * 60 + s;
};
const toHms = (seconds: number) => {
  const t = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`;
};

export function CompanyCycle({ duration }: SceneProps) {
  const frame = useCurrentFrame();
  const first = 24;
  const step = (duration - first - 75) / (CYCLE.length - 1);
  const appear = CYCLE.map((_, i) => Math.round(first + i * step));
  const clock = interpolate(
    frame,
    appear,
    CYCLE.map((c) => toSeconds(c.at)),
    {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    },
  );
  const done = frame >= (appear.at(-1) ?? 0);
  return (
    <SceneShell duration={duration}>
      <Kicker>This morning · UTC</Kicker>
      <div style={{ position: 'absolute', left: SIDE, top: 200, width: 560 }}>
        <Rise>
          <p style={display(64)}>One idea, from the CEO&rsquo;s card to a pull request.</p>
        </Rise>
        <Rise delay={8} style={{ marginTop: 56 }}>
          <span style={{ fontFamily: F.mono, fontWeight: 700, fontSize: 104, color: C.ink }}>
            {toHms(clock)}
          </span>
        </Rise>
        <div style={{ marginTop: 40, opacity: enter(frame, appear.at(-1) ?? 0) }}>
          <p style={display(56, done ? C.deep : C.muted)}>Under 11 minutes.</p>
          <p style={{ ...body(40, C.ink), marginTop: 10 }}>No human after the sweep.</p>
        </div>
      </div>
      <div
        style={{ position: 'absolute', left: 780, width: 980, top: 168, display: 'grid', gap: 22 }}
      >
        {CYCLE.map((card, i) => (
          <CardRow
            key={card.at}
            card={card}
            at={appear[i] ?? 0}
            fill={i === CYCLE.length - 1 ? C.successSoft : C.white}
            drop={i === CYCLE.length - 1 ? C.mint : C.sky}
          />
        ))}
      </div>
    </SceneShell>
  );
}

function Mono({
  children,
  color = C.ink,
  size = 26,
}: {
  children: ReactNode;
  color?: string;
  size?: number;
}) {
  return (
    <p style={{ fontFamily: F.mono, fontWeight: 500, fontSize: size, color, margin: 0 }}>
      {children}
    </p>
  );
}

export function CompanyPr({ duration }: SceneProps) {
  return (
    <SceneShell duration={duration}>
      <Kicker>A real pull request</Kicker>
      <Rise style={{ position: 'absolute', left: SIDE, top: 170 }}>
        <p style={display(80)}>Written and tested by an agent.</p>
      </Rise>
      <Rise delay={12} style={{ position: 'absolute', left: SIDE, top: 330, width: 1600 }}>
        <PixelBox style={{ padding: '44px 56px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <Pill fill={C.successSoft} color={C.successInk}>
              Open
            </Pill>
            <Mono color={C.muted} size={30}>
              latchkey-ops-bot/boiler-room #32
            </Mono>
          </div>
          <p style={{ ...display(54, C.ink), marginTop: 26 }}>
            feat(motion): status-relay layout and timing functions (1/3)
          </p>
          <p style={{ ...body(32, C.muted), marginTop: 18 }}>
            Commit by <b style={{ color: C.deep }}>br-engineer-1</b>, into dev
          </p>
          <div style={{ display: 'flex', gap: 40, marginTop: 30, alignItems: 'baseline' }}>
            <span
              style={{ fontFamily: F.pixel, fontWeight: 700, fontSize: 56, color: C.successInk }}
            >
              +840
            </span>
            <span style={{ fontFamily: F.pixel, fontWeight: 700, fontSize: 56, color: C.errorInk }}>
              −0
            </span>
            <span style={body(32, C.ink)}>2 files</span>
          </div>
          <div style={{ marginTop: 26, display: 'grid', gap: 8 }}>
            <Mono>packages/motion/src/scenes/status-relay-layout.ts</Mono>
            <Mono>packages/motion/test/status-relay-layout.test.ts</Mono>
          </div>
        </PixelBox>
      </Rise>
      <Rise delay={34} style={{ position: 'absolute', left: SIDE, top: 930 }}>
        <p style={body(34, C.ink)}>
          The card note:{' '}
          <span style={{ fontFamily: F.mono, color: C.deep }}>
            &ldquo;Tests: motion 586 passed&rdquo;
          </span>
        </p>
      </Rise>
    </SceneShell>
  );
}

/**
 * Why PR #32 is still open, from the board: the engineer's own block note, the CEO's decision
 * comments, and the FOUNDER card a later sweep wrote. The block is not cleared, so nothing here
 * says it was.
 */
const DEADLOCK: Card[] = [
  { at: '11:22:09', who: 'Engineer', what: 'Blocks its own card: won’t stack on an unmerged PR' },
  { at: '11:24:05', who: 'CEO', what: 'Finds the deadlock: 4 decision comments' },
  { at: '15:11:03', who: 'CEO', what: 'FOUNDER: clear SHIP dependency deadlock' },
];

export function CompanyDeadlock({ duration }: SceneProps) {
  const frame = useCurrentFrame();
  const first = 30;
  const step = Math.max(20, (duration - first - 90) / (DEADLOCK.length - 1));
  const appear = DEADLOCK.map((_, i) => Math.round(first + i * step));
  const last = appear.at(-1) ?? 0;
  return (
    <SceneShell duration={duration}>
      <Kicker>Same day · UTC</Kicker>
      <div style={{ position: 'absolute', left: SIDE, top: 200, width: 560 }}>
        <Rise>
          <p style={display(64)}>PR #32 is still open. The agents know why.</p>
        </Rise>
        <div style={{ marginTop: 56, opacity: enter(frame, last + 6) }}>
          <p style={display(56, C.deep)}>Sent to the founder.</p>
          <p style={{ ...body(40, C.ink), marginTop: 10 }}>The card is still to do.</p>
        </div>
      </div>
      <div
        style={{ position: 'absolute', left: 780, width: 980, top: 300, display: 'grid', gap: 22 }}
      >
        {DEADLOCK.map((card, i) => (
          <CardRow
            key={card.at}
            card={card}
            at={appear[i] ?? 0}
            fill={i === DEADLOCK.length - 1 ? C.attentionSoft : C.white}
            drop={i === DEADLOCK.length - 1 ? C.pink : C.sky}
          />
        ))}
      </div>
    </SceneShell>
  );
}

export function CompanyGtm({ duration }: SceneProps) {
  const steps = [
    'Find startups that just launched',
    'Make each a free launch video',
    'Draft the post',
  ];
  return (
    <SceneShell duration={duration}>
      <Kicker>Go-to-market</Kicker>
      <Rise style={{ position: 'absolute', left: SIDE, top: 190 }}>
        <p style={display(104)}>Go-to-market is agents too.</p>
      </Rise>
      <Rise delay={10} style={{ position: 'absolute', left: SIDE, top: 330 }}>
        <Pill fill={C.attentionSoft} color={C.attentionInk} size={26}>
          Set up · daily caps at $0, so switched off for now
        </Pill>
      </Rise>
      <div
        style={{
          position: 'absolute',
          left: SIDE,
          right: SIDE,
          top: 470,
          display: 'flex',
          alignItems: 'center',
          gap: 28,
        }}
      >
        {steps.map((step, i) => (
          <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
            <Rise delay={18 + i * 14}>
              <PixelBox style={{ width: 430, height: 210, padding: '30px 34px' }}>
                <p
                  style={{
                    fontFamily: F.mono,
                    fontWeight: 600,
                    fontSize: 24,
                    color: C.muted,
                    margin: 0,
                  }}
                >
                  {`0${i + 1}`}
                </p>
                <p style={{ ...display(44, C.ink), marginTop: 14 }}>{step}</p>
              </PixelBox>
            </Rise>
            {i < steps.length - 1 ? (
              <Rise delay={24 + i * 14}>
                <span
                  style={{ fontFamily: F.pixel, fontWeight: 700, fontSize: 64, color: C.steel }}
                >
                  →
                </span>
              </Rise>
            ) : null}
          </div>
        ))}
      </div>
      <Rise delay={70} style={{ position: 'absolute', left: SIDE, top: 790 }}>
        <PixelBox
          fill={C.cream}
          drop={C.pink}
          style={{ padding: '30px 44px', display: 'inline-block' }}
        >
          <p style={display(64)}>Then the founder presses post.</p>
        </PixelBox>
      </Rise>
    </SceneShell>
  );
}
