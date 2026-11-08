import { C } from '../brand.ts';
import { display, Kicker, PixelBox, Rise, SceneShell, SIDE, Words } from '../ui.tsx';
import type { SceneProps } from './types.ts';

const block = { position: 'absolute', left: SIDE, right: SIDE, top: 300 } as const;

export function ProblemNeed({ duration }: SceneProps) {
  return (
    <SceneShell duration={duration}>
      <Kicker>The problem</Kicker>
      <div style={block}>
        <Words text="Every startup needs" style={display(150)} />
        <Words text="a launch video." delay={9} style={display(150, C.ink)} />
      </div>
    </SceneShell>
  );
}

export function ProblemStudio({ duration }: SceneProps) {
  return (
    <SceneShell duration={duration}>
      <Kicker>The problem</Kicker>
      <div style={block}>
        <Words text="A good one" style={display(150, C.ink)} />
        <Words text="takes a studio." delay={6} style={display(150)} />
      </div>
    </SceneShell>
  );
}

export function ProblemAnswer({ duration }: SceneProps) {
  const chip = { padding: '28px 44px', display: 'inline-block' } as const;
  return (
    <SceneShell duration={duration}>
      <Kicker>Boiler Room</Kicker>
      <div style={{ ...block, top: 250 }}>
        <Words text="Boiler Room makes one" style={display(124, C.ink)} />
        <Words text="from a URL." delay={8} style={display(124)} />
        <div style={{ display: 'flex', gap: 64, marginTop: 88 }}>
          <Rise delay={30}>
            <PixelBox fill={C.cream} style={chip}>
              <span style={display(60)}>About fifteen minutes</span>
            </PixelBox>
          </Rise>
          <Rise delay={42}>
            <PixelBox fill={C.cream} style={chip}>
              <span style={display(60)}>A couple of dollars</span>
            </PixelBox>
          </Rise>
        </div>
      </div>
    </SceneShell>
  );
}
