# CEO: `br-ceo`

**Purpose.** Set the company's direction, keep the board moving, decide releases, and report. The CEO
decides what gets worked on next. It never does the work itself.

## Configuration

| Setting | Value |
| --- | --- |
| Model | `anthropic/claude-sonnet-5.5` |
| Harness | `pi` |
| Team | `multiagent: { type: "coordinator", board: true }`, with every company agent on the roster (up to 20). The production crew is not on it. |
| Started by | 1. Deployment `br-ceo-sweep`: cron `0 */2 * * *`, timezone `America/New_York`, `budget_micro_usd: 1_000_000`. 2. Board digests, which Naive starts by itself when cards reach `done` (verified) or `blocked` (docs only, see [README section 2](../README.md#2-how-the-hierarchy-works-on-naive)). |
| Handoffs | `false` |
| Budget | `cap_micro_usd: 5_000_000`, `max_task_micro_usd: 1_000_000`, `period: "day"` |
| Platform CEO binding | None. No `Orchestrator control plane` vault. See [README section 2](../README.md#2-how-the-hierarchy-works-on-naive). |

## Tools

| Tool | Access | Note |
| --- | --- | --- |
| `board_read`, `board_write` | allow | Its only way to act |
| `submit_output`, `session_spend` | allow | |
| `br-app.company_metrics` (the app's own MCP tool, read only) | allow | Planned. Films made, leads, emails, replies, and spend per agent. |
| Every other app tool, including `br-app.send_email`, `br-app.leads_upsert` and `br-app.request_sample` | off, each one named | `allowed_apps` names only the app that serves `company_metrics` |
| `send_to_agent`, `wait_for_agents`, `list_agents` | off | Work goes by card. The CEO never waits on a teammate. |
| `bash`, `read`, `write`, `edit`, `ls`, `find` | off | With no sandbox tools, no computer is provisioned (verified) |
| `browser`, `web_fetch`, `web_search`, `generate_image`, `data_run` | off | |
| `ask_operator`, `request_tools`, `propose_plan` | off | Escalation goes on the board |
| `vetta.tools_search`, `vetta.tools_execute` | off | |

No identity, no vault credentials, no external MCP servers.

## What it does

**On each cron fire** (the standing card `Recurring: Company sweep`):

1. Read the board with `board_read`. Open only the cards that are `blocked`, or `done` since the last
   sweep. Until a `blocked` digest has been seen, this sweep is the backstop for failures.
2. List every `doing` card whose `updated_at` is more than 2 hours old, with its
   `woken_session_id`, on a `FOUNDER: stalled cards` card. Its session may have hit its budget,
   which leaves the card in `doing` with no digest. The CEO cannot see a session's status or raise
   a budget, which only a person can do.
3. For each blocked card: reassign it, answer it with a comment, or decide it. Escalate as a
   `FOUNDER: <need>` card only when a person must physically act.
4. If fewer than two `DIR` cards are open, write the next one from its own priority list, kept on
   the standing card and seeded from its system prompt:

   ```text
   DIR: <slug>
   Goal: one sentence.
   Why now: one sentence.
   Done when: an outcome someone can check, such as "a customer can sign in and see their films".
   Budget: the most the whole slug may cost, in dollars.
   Deadline: a date.
   Constraints: the CLAUDE.md rules that apply, and anything out of scope.
   ```

   Then assign it to `br-product`.

   The CEO owns the priority list and changes it from what the board and the metrics show. The
   founder may add a `FOUNDER: priority <text>` card, and the CEO reads it on the next sweep.
5. When a `DIR` slug is delivered, create `RELEASE: <slug>` assigned to `br-eng-lead`.
6. Close the standing card. Its note is the report: what moved, what is blocked, what is stalled,
   decisions taken, open `FOUNDER:` cards, and spend against the caps once the metrics tool exists.

**On each digest:** read every card it lists. A `done` card is a report. Compare a `SHIP` note with
its `DIR` card's done-when, and comment delivered or not delivered on the `DIR` card. Act only on
what is `blocked`, or on what a note asks for. Create no new work from a digest.

## Policy: what it may not do

- Write code, specs, designs, posts or emails.
- Create work from a digest that no blocked card or note asks for.
- Hold more than two open `DIR` cards. This keeps work in progress small.
- Assign GTM cards before the founder activates GTM. A GTM agent's $0 budget would park the card
  anyway.
- Change agents, budgets, credentials, deployments or branch rules. It has no tool for any of these.
- Merge code or deploy itself. It decides releases; the engineering lead carries them out.

## Reports

| What | To whom | How |
| --- | --- | --- |
| The sweep report, every 2 hours | Founder | Note on `Recurring: Company sweep` |
| Things only a person can do | Founder | `FOUNDER:` cards |
| Delivered or not, per slug | Founder and every team | Comment on the `DIR` card |
| Receives | From every agent | Board digests of each `done` card (verified) and each `blocked` card (docs). The sweep catches what no digest reports. |

## Cost

On Haiku, measured: a digest cost $0.0009 to $0.0021, and a sweep that read two boards cost $0.0013
with a narrow toolset. Sonnet's token prices are 20 times Haiku's, so on Sonnet expect about $0.02 to
$0.12 per digest or sweep. That is inferred, not measured. Twelve sweeps a day plus digests should
stay well under the $5 daily cap.

## Not verified

- A coordinator on a cron. The cron probe used a CEO that was not a coordinator, so the
  `Recurring:` standing card has not been seen.
- A digest of a `blocked` card. Only `done` digests have been seen.
- Digests on Sonnet, and whether $1.00 clears Sonnet's pre-flight quote for this toolset.
- Whether the CEO is woken by a digest about the standing card it closed itself.
