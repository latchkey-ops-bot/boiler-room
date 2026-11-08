# Pitch narration, v2 (about 275 words, 2:00)

One line per scene of `timeline.json`. Times are set from the word count at about 150 words a
minute. The recording does not exist yet, so record it to these marks, then retime `timeline.json`
to the audio. "Boiler Room." should land on the logo at the `close-logo` cut (113.5 s).

| Scene | Time (s) | Words | Line |
| --- | --- | --- | --- |
| problem-need | 0 to 3 | 6 | Every startup needs a launch video. |
| problem-studio | 3 to 6 | 6 | A good one takes a studio. |
| problem-answer | 6 to 12.5 | 16 | Boiler Room makes one from a URL in under half an hour, for a couple of dollars. |
| demo-timelapse | 12.5 to 29 | 34 | Paste a URL. A researcher agent reads the site on its own computer. A director writes the script, and every number in it is quoted from the site, word for word. You approve it. |
| demo-film | 29 to 35 | 15 | An art director picks the shots, it renders, and a quality check flags what's wrong. |
| company-intro | 35 to 47.5 | 31 | But the film crew is only half of it. Boiler Room is a company run by agents, on Naive. Each one has its own computer, its own budget and its own skills. |
| company-org | 47.5 to 60.5 | 33 | A CEO agent wakes every two hours, reads the board and decides what to build. Product writes the spec, the lead splits it into cards, and an engineer opens a pull request for review. |
| company-cycle | 60.5 to 69.5 | 20 | This morning, the CEO's sweep turned one idea into a pull request in under eleven minutes, with no human in between. |
| company-pr | 69.5 to 73.5 | 8 | Written and tested by an agent. Still open. |
| company-deadlock | 73.5 to 83 | 24 | The engineer wouldn't stack on an unmerged branch, so it blocked its own card. The CEO caught the deadlock and escalated it to me. |
| company-gtm | 83 to 92 | 22 | Go-to-market agents are set up too: to find startups that just launched, make each a free launch video, and draft the post. |
| trust-caps | 92 to 97 | 12 | It runs on rules, not hope: a daily cap on every agent, |
| trust-tripwire | 97 to 102 | 13 | a tripwire that halts films if the balance falls too far in a day, |
| trust-quotes | 102 to 108 | 16 | and a check that every claim on screen is a quote from the customer's own site. |
| close-montage | 108 to 113.5 | 0 | (films play; the trust line may run a beat into it) |
| close-logo | 113.5 to 120 | 17 | Boiler Room. Give it a URL, get a launch video. And the company that makes it runs itself. |

## What changed from v1, and why

- Cut "thousands of dollars, and weeks": no source.
- "About fifteen minutes" is now "under half an hour". The only ledgered delivered film (posthog.com)
  took 19 minutes from script to delivery, before research; the 15-minute resend.com figure has no
  ledger.
- The demo narration stops at "You approve it." The recording of the usenaive.ai run ended at the
  start of art direction, so art direction, render and quality check are said over the finished
  film instead of shown.
- The quality check "flags what's wrong". It does not hold a film back: the agentmail.to film was
  delivered with a quality-check fail.
- The time-lapse is labelled "real run, sped up" with an elapsed clock. The speed varies (waits race,
  the approval plays at about 6x), so it is not "10x".
- Cut "the lead merges and deploys to Cloudflare": the engineering lead has merged nothing and PR
  #32 is open. The deadlock story replaces it, and it is on screen.
- "Nobody touching it" is now "no human after the sweep": the data cannot show whether the first
  sweep was scheduled or started by hand.
- Go-to-market is "set up", not working "every day": all four GTM agents have $0 daily caps and no
  cards.
- The tripwire is a fall within a day, not a balance floor. No dollar figure is said or shown until
  the deployed `TRIPWIRE_DAILY_FALL_USD` is confirmed.

## Sources for the numbers said aloud

- "a couple of dollars": the four films today cost $0.73, $1.41, $1.52 and $2.03.
- "under eleven minutes": sweep run 11:10:42Z to PR #32 opened 11:21:34Z (10.9 min). The 11:01 and
  11:02 sessions were verify probes, not the cycle.
- "every two hours": deployment cron `0 */2 * * *`, America/New_York.
- The deadlock: ENG 2/3 blocked 11:22:09Z, CEO decision comments 11:24:05Z to 11:24:20Z, FOUNDER card
  15:11:03Z, still todo. The CEO did not clear the block; do not say it did.
