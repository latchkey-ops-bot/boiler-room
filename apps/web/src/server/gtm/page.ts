/**
 * A sample's film page, `/f/<share_id>`, as plain HTML the Worker serves before OpenNext, so it
 * can answer 410 once the film is withdrawn. Unlisted and unindexed: it is linked from nowhere on
 * the site, carries `noindex`, and shows one film only. Every value from the database is escaped.
 */
import type { SharedSample } from './samples.ts';

const escapeHtml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** The fixed words every sample's page carries, so the label is never left out. */
export const SAMPLE_LABEL = 'Free sample';
export const notAffiliated = (host: string) =>
  `Made by Boiler Room from ${host}'s public website. ${host} did not ask for it and is not affiliated with Boiler Room.`;

const STYLE = `
:root{--deep:#086288;--ink:#0B2E40;--muted:#3D6A87;--paper:#FFFBEF;--cream:#FFEFC4;--sky:#97D7FF;--white:#fff;--pink:#FF9EB5}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 'Nunito',ui-rounded,system-ui,sans-serif}
main{max-width:880px;margin:0 auto;padding:24px 16px 48px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:24px}
header img{height:32px;width:auto}
.badge{display:inline-block;font:600 13px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;background:var(--cream);border:2px solid var(--ink);padding:6px 10px}
h1{font:800 32px/1.15 'Bricolage Grotesque',system-ui,sans-serif;margin:8px 0 12px}
p{margin:0 0 12px}
.muted{color:var(--muted)}
video{display:block;width:100%;aspect-ratio:16/9;background:var(--ink);border:2px solid var(--ink)}
.notice{background:var(--white);border:2px solid var(--ink);padding:12px 16px;margin:16px 0}
.actions{display:flex;flex-wrap:wrap;gap:12px;margin:16px 0}
.btn{display:inline-block;font:700 16px/1 'Bricolage Grotesque',system-ui,sans-serif;padding:12px 18px;border:2px solid var(--ink);background:var(--deep);color:var(--white);text-decoration:none;cursor:pointer}
.btn.quiet{background:var(--white);color:var(--ink)}
form{margin:24px 0 0}
.remove{background:none;border:0;padding:0;color:var(--muted);text-decoration:underline;font:inherit;cursor:pointer}
a{color:var(--deep)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--paper:#0B2E40;--ink:#FFFBEF;--muted:#97D7FF;--white:#064E6D;--cream:#4D8DBA}}
`;

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>
<header><a href="/"><img src="/brand/lockup.svg" alt="Boiler Room" width="83" height="32"></a></header>
${body}
</main></body>
</html>`;
}

/** The page of a shared sample. A withdrawn sample gets `gonePage` instead. */
export function samplePage(sample: SharedSample, shareId: string): string {
  const host = escapeHtml(sample.host);
  const brand = escapeHtml(sample.brand);
  const site = escapeHtml(new URL(sample.film.url).origin);
  const video = sample.file
    ? `<video controls playsinline preload="metadata" src="/f/${shareId}/video"></video>`
    : '<p class="notice">The film file is not available.</p>';
  const simulated = sample.simulated
    ? '<p class="notice"><strong>Test film.</strong> This was made by a test stand-in, not the real crew.</p>'
    : '';
  return shell(
    `${SAMPLE_LABEL}: a launch film for ${sample.brand}`,
    `<span class="badge">${SAMPLE_LABEL}</span>
<h1>A launch film for ${brand}</h1>
<p class="notice">${escapeHtml(notAffiliated(sample.host))}</p>
${simulated}
${video}
<div class="actions">
${sample.file ? `<a class="btn" href="/f/${shareId}/download">Download the film</a>` : ''}
<a class="btn quiet" href="${site}" rel="noopener nofollow">Visit ${host}</a>
<a class="btn quiet" href="/#start">Make one for your launch</a>
</div>
<p class="muted">This is a free sample. It costs ${host} nothing, and nobody has to do anything with it.</p>
<form method="post" action="/f/${shareId}/remove">
<button class="remove" type="submit">Remove this film</button>
<span class="muted"> No sign-in needed: the film comes down at once, and we stop contacting ${host}.</span>
</form>`,
  );
}

export function gonePage(): string {
  return shell(
    'This film was removed',
    '<h1>This film was removed</h1><p>The film that was here has been taken down, and its files are deleted.</p><p><a href="/">Boiler Room</a></p>',
  );
}

export function missingPage(): string {
  return shell('No film here', '<h1>There is no film here</h1><p><a href="/">Boiler Room</a></p>');
}

export function removedPage(host: string): string {
  return shell(
    'Film removed',
    `<h1>The film is removed</h1><p>The film we made from ${escapeHtml(host)}'s website is down, its files are deleted, and Boiler Room will not contact ${escapeHtml(host)} again.</p><p><a href="/">Boiler Room</a></p>`,
  );
}
