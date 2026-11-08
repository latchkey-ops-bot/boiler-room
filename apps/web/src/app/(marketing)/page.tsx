import Link from 'next/link';
import { Boyle } from '../../components/boyle.tsx';
import { BrandStage } from '../../components/brand-scene.tsx';
import { ClaimText } from '../../components/claim-text.tsx';
import { Icon, type IconName } from '../../components/icon.tsx';
import { ShowcaseWall } from '../../components/showcase-wall.tsx';
import { UrlField } from '../../components/url-field.tsx';
import { brandLook, brandScene } from '../../lib/brand-scene.ts';
import { CREW_LABELS, type Format, STOP_CREW, type Stop } from '../../lib/film.ts';
import { MAX_URL_LENGTH } from '../../lib/film-url.ts';
import { prefillProblem } from '../../lib/start.ts';
import { loadShowcase } from '../../server/marketing.ts';
import { SAMPLE_CAMPAIGN, SAMPLE_HOST } from '../../server/pipeline/simulated.ts';

export const dynamic = 'force-dynamic';

/** The landing page shows two rows of the launch wall; /showcase shows the rest. */
const WALL_ON_LANDING = 6;

const CHANNELS = ['X', 'LinkedIn', 'Product Hunt', 'YouTube', 'Reels', 'TikTok'];

/** The four stops, the same four the app's progress card shows, with the crew at each. */
const STEPS: { stop: Stop; icon: IconName; label: string; title: string; text: string }[] = [
  {
    stop: 'research',
    icon: 'search',
    label: 'Step 1',
    title: 'Research',
    text: 'Reads your site and copies every claim word for word, with its source.',
  },
  {
    stop: 'script',
    icon: 'clapper',
    label: 'Step 2',
    title: 'Script',
    text: "Writes the scenes. Any number your site doesn't back up is sent back.",
  },
  {
    stop: 'approve',
    icon: 'user',
    label: 'Step 3 · you',
    title: 'You approve',
    text: 'Read the script and the source behind each number. Nothing renders until you say yes.',
  },
  {
    stop: 'make',
    icon: 'film',
    label: 'Step 4',
    title: 'Animate and deliver',
    text: 'Scenes, voice and music come together, every frame is checked, and your files arrive.',
  },
];

/** Each shape is drawn to scale, showing the same sample scene laid out for it. */
const SHAPES: { ratio: Format; name: string; where: string; shape: 'wide' | 'tall' | 'square' }[] =
  [
    {
      ratio: '16:9',
      name: 'Landscape',
      where: 'Your homepage, YouTube, X and the Product Hunt gallery.',
      shape: 'wide',
    },
    { ratio: '9:16', name: 'Tall', where: 'Reels, TikTok, Shorts and stories.', shape: 'tall' },
    { ratio: '1:1', name: 'Square', where: 'LinkedIn and the X feed.', shape: 'square' },
  ];

export default async function Landing({
  searchParams,
}: {
  searchParams: Promise<{ url?: string | string[] }>;
}) {
  const { url } = await searchParams;
  // `/?url=` fills the hero field: /start sends a visitor back here when the URL can't be used,
  // and a link in an email can name the visitor's site.
  const prefill = typeof url === 'string' ? url.slice(0, MAX_URL_LENGTH + 1) : '';
  const launches = await loadShowcase(WALL_ON_LANDING);
  const hasLaunches = launches !== null && launches.length > 0;

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
            <UrlField initialUrl={prefill} initialProblem={prefillProblem(prefill)} />
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
          <figure className="hero-figure">
            <HeroArt />
            <figcaption className="label">
              A sample: frames from {SAMPLE_HOST}'s launch video, in its own brand
            </figcaption>
          </figure>
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
            <p>
              Your URL goes in one end. A launch video comes out the other. A small crew of agents
              does the work, each with one job, and you step in once.
            </p>
          </div>
          <ol className="steps">
            {STEPS.map((step) => (
              <li key={step.title} className={step.stop === 'approve' ? 'step step-you' : 'step'}>
                <span className="crew">
                  <Icon name={step.icon} />
                </span>
                <div className="card">
                  <span className="label">{step.label}</span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                  <p className="label who">
                    {step.stop === 'approve'
                      ? 'You'
                      : STOP_CREW[step.stop].map((member) => CREW_LABELS[member]).join(', ')}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
      <div className="dither" />

      <section className="section" id="channels">
        <div className="wrap">
          <div className="section-head">
            <span className="label eyebrow">
              <b>02</b> Channels
            </span>
            <h2>Cut for every place you'll post it</h2>
            <p>
              Every shape gets its own layout, never a crop, and text stays big enough to read on a
              phone. When you approve the script you pick the shapes, and you get one video in each.
            </p>
          </div>
          <ul className="formats">
            {SHAPES.map((shape) => (
              <li key={shape.ratio} className={`format format-${shape.shape}`}>
                <div className="frame px">
                  <BrandStage look={sampleLook} scene={sampleScene} format={shape.ratio} />
                </div>
                <h3>
                  <span className="score">{shape.ratio}</span> {shape.name}
                </h3>
                <p>{shape.where}</p>
              </li>
            ))}
          </ul>
          <p className="formats-note label">
            Sample: one scene of {SAMPLE_HOST}'s launch video, in its own brand
          </p>
        </div>
      </section>

      <div className="dither dither-up" style={{ backgroundColor: 'var(--br-paper)' }} />
      <section className="section" id="claims">
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
          <ScriptSample />
        </div>
      </section>

      {hasLaunches ? (
        <>
          <div
            className="dither dither-cream dither-up"
            style={{ backgroundColor: 'var(--br-paper)' }}
          />
          <section className="section bg-cream" id="showcase">
            <div className="wrap">
              <div className="wall-head">
                <div className="section-head">
                  <span className="label eyebrow">
                    <b>04</b> Showcase
                  </span>
                  <h2>Fresh out of the boiler room</h2>
                  <p>
                    Real launch videos, shown by the founders who made them. When your video is
                    delivered, you choose whether it goes up here.
                  </p>
                </div>
                <Link className="btn" href="/showcase">
                  See them all <Icon name="arrow-right" />
                </Link>
              </div>
              <ShowcaseWall launches={launches} />
            </div>
          </section>
          <div className="dither dither-cream" />
        </>
      ) : null}

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
 * The claims promise, shown on the sample script every simulated film gets: Nova's scene whose
 * headline cites a claim, with that claim's verbatim quote and source. Sample figures on sample
 * content need no label.
 */
function ScriptSample() {
  const scenes = SAMPLE_CAMPAIGN.scenes;
  const index = scenes.findIndex((scene) =>
    scene.text.some((item) => item.role === 'headline' && item.claimIds.length > 0),
  );
  const scene = scenes[index];
  const headline = scene?.text.find((item) => item.role === 'headline');
  const claim = SAMPLE_CAMPAIGN.claims.find((item) => item.id === headline?.claimIds[0]);
  if (!scene || !headline || !claim) return null;
  return (
    <div className="card script-sample">
      <div className="stamp">
        <span className="badge badge-done">Validator passed</span>
        <span className="badge badge-plain">
          Scene {index + 1} of {scenes.length} · {scene.start.toFixed(1)}s to {scene.end.toFixed(1)}
          s
        </span>
      </div>
      <div className="script-line">
        <span className="label">Headline</span>
        <p className="say">
          <ClaimText text={headline.value} />
        </p>
      </div>
      <div className="claim-card">
        <span className="label">Source · {claim.id}</span>
        <blockquote>
          "<ClaimText text={claim.quote} />"
        </blockquote>
        <span className="source">{claim.sourceUrl.replace(/^https?:\/\//, '')}</span>
      </div>
      <div className="alert alert-failed">
        <Icon name="warning" />
        <p>
          <strong>Sent back, round 1:</strong> "Builds 73% faster" had no source. The Director
          rewrote it from the quote above.
        </p>
      </div>
    </div>
  );
}

/**
 * The crew at work: a URL goes in the side pipe and videos come out on the belt. Boyle blinks, and
 * the trail of steam rises because this is a film being made. It is a working animation only: with
 * reduced motion the belt stops and the steam never appears. The videos wear the sample customer's
 * brand, Nova, never ours, and each has a player's bar and a caption saying it is the sample's, so
 * its numbers never read as ours.
 */
function HeroArt() {
  return (
    <div className="art" aria-hidden="true">
      <div className="ticket card card-flat">
        <span className="badge badge-plain label">Sample site</span>
        <Icon name="globe" />
        {SAMPLE_HOST}
      </div>
      <div className="feed-pipe" />
      <div className="floor" />
      <Boyle size={192} steaming />
      <Icon name="sparkle" className="sparkle s1" />
      <Icon name="sparkle" className="sparkle s2" />
      <Icon name="sparkle" className="sparkle s3" />
      <div className="film film-wide px">
        <b>40% faster</b>builds, in month one
        <Chrome />
        <span className="label format">16:9</span>
      </div>
      <div className="film film-tall px">
        <b>1,200</b>teams
        <Chrome />
        <span className="label format">9:16</span>
      </div>
      <div className="film film-square px">
        <b>Ship with Nova.</b>Start free
        <Chrome />
        <span className="label format">1:1</span>
      </div>
      <div className="belt" />
    </div>
  );
}

/** A player's bar under each sample frame, so it reads as a video, not as our own numbers. */
function Chrome() {
  return (
    <span className="chrome">
      <Icon name="play" />
      <i />
    </span>
  );
}

const sampleLook = brandLook(SAMPLE_CAMPAIGN);
/** The sample's stat scene with its product shot, which changes layout most between shapes. */
const speed =
  SAMPLE_CAMPAIGN.scenes.find((scene) => scene.id === 'speed') ?? SAMPLE_CAMPAIGN.scenes[0];
if (!speed) throw new Error('The sample campaign has no scenes.');
const sampleScene = brandScene(SAMPLE_CAMPAIGN, speed);
