import Link from 'next/link';
import { Boyle } from '../../components/boyle.tsx';
import { Icon, type IconName } from '../../components/icon.tsx';
import { UrlField } from '../../components/url-field.tsx';

const CHANNELS = ['X', 'LinkedIn', 'Product Hunt', 'YouTube', 'Reels', 'TikTok'];

const STEPS: { icon: IconName; label: string; title: string; text: string; you?: boolean }[] = [
  {
    icon: 'search',
    label: 'Step 1',
    title: 'Research',
    text: 'The Researcher reads your site and copies every claim word for word, with its source.',
  },
  {
    icon: 'clapper',
    label: 'Step 2',
    title: 'Script',
    text: "The Director writes the scenes. The Validator sends back any number your site doesn't back up.",
  },
  {
    icon: 'user',
    label: 'Step 3 · you',
    title: 'You approve',
    text: 'Read the script and the source behind each number. Nothing renders until you say yes.',
    you: true,
  },
  {
    icon: 'film',
    label: 'Step 4',
    title: 'Animate and deliver',
    text: 'Scenes, voice and music come together. Quality Check reviews every frame before you get it.',
  },
];

const CREW: { icon: IconName; name: string; does: string; decides: string }[] = [
  {
    icon: 'search',
    name: 'Researcher',
    does: 'Collects screenshots, colours, fonts and claims from your site.',
    decides: "what's worth saying",
  },
  {
    icon: 'clapper',
    name: 'Director',
    does: 'Writes the script and times every scene to the frame.',
    decides: 'the story',
  },
  {
    icon: 'shield',
    name: 'Validator',
    does: 'Blocks made-up numbers, bad timing and hard-to-read text.',
    decides: 'pass or send back',
  },
  {
    icon: 'brush',
    name: 'Art Director',
    does: "Picks a motion template for each scene and makes what's missing.",
    decides: 'how it looks',
  },
  {
    icon: 'eye',
    name: 'Quality Check',
    does: 'Watches every transition and reads every line at phone size.',
    decides: 'ship or redo',
  },
  {
    icon: 'mail',
    name: 'Account Manager',
    does: 'Delivers your files and handles your revisions.',
    decides: 'what to send back',
  },
];

export default function Landing() {
  return (
    <>
      <header className="hero bg-dots" id="start">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <span className="label eyebrow">
              <b>BR</b> Launch videos for founders
            </span>
            <h1 className="display">Give us a URL. Get your launch video.</h1>
            <p className="lede">
              You're busy shipping. A small crew of agents reads your site, writes the script,
              animates it and cuts it for every channel. You approve the script. They do the rest.
            </p>
            <UrlField />
            <p className="hint">
              <Icon name="shield" size="sm" /> No made-up stats. Every number comes from your own
              site.
            </p>
            <div className="channels">
              <span className="label">Cut for</span>
              {CHANNELS.map((channel) => (
                <span key={channel} className="badge badge-plain">
                  {channel}
                </span>
              ))}
            </div>
          </div>
          <HeroArt />
        </div>
      </header>

      <div className="dither dither-up" style={{ backgroundColor: 'var(--br-paper)' }} />
      <section className="section bg-sky" id="how">
        <div className="wrap">
          <div className="section-head">
            <span className="label eyebrow">
              <b>01</b> How it works
            </span>
            <h2>Four stops through the boiler room</h2>
            <p>Your URL goes in one end. A launch video comes out the other. You step in once.</p>
          </div>
          <div className="steps">
            {STEPS.map((step) => (
              <div key={step.title} className={step.you ? 'step step-you' : 'step'}>
                <span className="crew">
                  <Icon name={step.icon} />
                </span>
                <div className="card">
                  <span className="label">{step.label}</span>
                  <h4>{step.title}</h4>
                  <p>{step.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <div className="dither" />

      <section className="section" id="crew">
        <div className="wrap">
          <div className="section-head">
            <span className="label eyebrow">
              <b>02</b> The crew
            </span>
            <h2>Your launch team, minus the hiring</h2>
            <p>
              Each agent has one job and makes its own calls. You can see every decision they make.
            </p>
          </div>
          <div className="crew-grid">
            {CREW.map((member) => (
              <article key={member.name} className="card badge-card">
                <span className="clip" />
                <span className="crew">
                  <Icon name={member.icon} />
                </span>
                <div>
                  <h3>{member.name}</h3>
                  <p>{member.does}</p>
                  <p className="label decides">Decides: {member.decides}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <div className="dither dither-up" style={{ backgroundColor: 'var(--br-paper)' }} />
      <section className="section bg-sky" id="claims">
        <div className="wrap claims-grid">
          <div className="section-head" style={{ margin: 0 }}>
            <span className="label eyebrow">
              <b>03</b> Claims, checked
            </span>
            <h2>No made-up stats. Ever.</h2>
            <p>
              Investors and customers will pause on your numbers. Every number in your video points
              to a sentence on your own site. If the Researcher can't find it, the Validator won't
              let it on screen.
            </p>
          </div>
          <div className="card script-sample">
            <div className="stamp">
              <span className="badge badge-done">Validator passed</span>
              <span className="badge badge-plain">Scene 2 of 4 · 4.0s to 9.0s</span>
            </div>
            <div className="script-line">
              <span className="label">Headline</span>
              <p className="say">
                <span className="claim">40%</span> faster builds
              </p>
            </div>
            <div className="claim-card">
              <span className="label">Source · build-times</span>
              <blockquote>
                "Teams on Nova cut build times by <span className="claim">40%</span> in their first
                month."
              </blockquote>
              <span className="source">nova.example.com/customers</span>
            </div>
            <div className="alert alert-failed">
              <Icon name="warning" />
              <p>
                <strong>Sent back, round 1:</strong> "Builds 73% faster" had no source. The Director
                rewrote it from the quote above.
              </p>
            </div>
          </div>
        </div>
      </section>
      <div className="dither" />

      <section className="section" id="showcase">
        <div className="wrap wall-head">
          <div className="section-head">
            <span className="label eyebrow">
              <b>04</b> Showcase
            </span>
            <h2>Fresh out of the boiler room</h2>
            <p>
              Real launch videos, shown by the founders who made them. When your video is delivered,
              you choose whether it goes up here.
            </p>
          </div>
          <Link className="btn" href="/showcase">
            See the showcase <Icon name="arrow-right" />
          </Link>
        </div>
      </section>

      <div
        className="dither dither-deep dither-up"
        style={{ backgroundColor: 'var(--br-paper)' }}
      />
      <section className="cta-band">
        <div className="wrap">
          <Boyle size={168} onDeep />
          <div>
            <h2>Launching soon? Fire up the boiler.</h2>
            <p>Paste your URL. You'll see the script before anything renders.</p>
            <UrlField steam />
          </div>
        </div>
      </section>
      <div className="dither dither-deep" />
    </>
  );
}

/**
 * A URL goes in the side pipe and videos come out on the belt. The videos wear the sample
 * customer's brand, Nova, never ours. No steam: puffs rise only while a real film is being made.
 */
function HeroArt() {
  return (
    <div className="art" aria-hidden="true">
      <div className="ticket card card-flat">
        <span className="badge badge-needs label">Launching Tuesday</span>
        <Icon name="globe" />
        nova.example.com
      </div>
      <div className="feed-pipe" />
      <div className="floor" />
      <Boyle size={192} />
      <Icon name="sparkle" className="sparkle s1" />
      <Icon name="sparkle" className="sparkle s2" />
      <Icon name="sparkle" className="sparkle s3" />
      <div className="film film-wide px">
        <b>40% faster</b>builds, in month one<span className="label format">16:9</span>
      </div>
      <div className="film film-tall px">
        <b>1,200</b>teams<span className="label format">9:16</span>
      </div>
      <div className="film film-square px">
        <b>Ship with Nova.</b>Start free<span className="label format">1:1</span>
      </div>
      <div className="belt" />
    </div>
  );
}
