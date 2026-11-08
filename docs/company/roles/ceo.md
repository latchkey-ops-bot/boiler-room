# CEO: `br-ceo`

**Purpose.** Set the company's direction, keep the board moving, decide releases, and report. The CEO
decides what gets worked on next. It never does the work itself.

## Configuration

| Setting | Value |
| --- | --- |
| Model | `anthropic/claude-sonnet-5.5` |
| Harness | `pi` |
| Team | `multiagent: { type: "coordinator", board: true }`, with every company agent on the roster (up to 20). The production crew is not on it. |
| Started by | 1. Deployment `br-ceo-sweep`: cron `0 */2 * * *`, timezone `America/New_York`, `budget_micro_usd: 1_000_000`. 2. Board digests, which Naive starts by itself when cards reach `done` (verified) or `blocked` (docs only, see [README section 2](../README.md#2-how-the-hierarchy-works-on-naive)). 3. The founder, in the dashboard's CEO chat (`/orchestrator`): one ordinary session per chat, capped at `max_task_micro_usd`. |
| Handoffs | `false` |
| Budget | `cap_micro_usd: 5_000_000`, `max_task_micro_usd: 1_000_000`, `period: "day"` |
| Organization CEO | Yes: `ceo_agent_id` is `br-ceo`. One `static_bearer` credential in the `Orchestrator control plane` vault, key `ceo_<agt id>`, for `https://api.vetta.sh/v1/mcp`, bound to `br-ceo`. Its board is the company board. See [README section 2](../README.md#2-how-the-hierarchy-works-on-naive). |
| Metadata | `role: "orchestrator"`, which the dashboard reads to pick its CEO agent |

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
| Every control-plane tool, `vetta.<tool>`: all 368 that `tools/list` on `https://api.vetta.sh/v1/mcp` served on 2026-11-07, such as `agents_create`, `agents_patch`, `vaults_create`, `sessions_create` and `credits_create_topup` | off, each one named | As the organization's CEO it is offered the control plane, and an unnamed MCP tool is offered at "ask". It needs none of them. |

No identity and no external MCP servers. Its one vault credential is the CEO binding, which the
platform never injects.

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

**In the founder's chat:** a message that is neither the sweep nor a digest is the founder. The CEO
does exactly what it asks with the board tools, answers in its reply, and says in one line that
anything other than a card, such as changing an agent, a budget or a credential, is the founder's
to do in the dashboard.

**On each digest:** read every card it lists. A `done` card is a report. Compare a `SHIP` note with
its `DIR` card's done-when, and comment delivered or not delivered on the `DIR` card. Act only on
what is `blocked`, or on what a note asks for. Create no new work from a digest.

## Policy: what it may not do

- Write code, specs, designs, posts or emails.
- Create work from a digest that no blocked card or note asks for.
- Hold more than two open `DIR` cards. This keeps work in progress small.
- Assign GTM cards before the founder activates GTM. A GTM agent's $0 budget would park the card
  anyway.
- Change agents, budgets, credentials, deployments or branch rules. It has no tool for any of these:
  as the organization's CEO it is offered the control plane, and every control-plane tool is named
  off (verified: a bound session was offered only its board, skill and spend tools).
- Merge code or deploy itself. It decides releases; the engineering lead carries them out.

## Reports

| What | To whom | How |
| --- | --- | --- |
| The sweep report, every 2 hours | Founder | Note on `Recurring: Company sweep` |
| Things only a person can do | Founder | `FOUNDER:` cards |
| Answers to the founder | Founder | Its reply in the CEO chat |
| Delivered or not, per slug | Founder and every team | Comment on the `DIR` card |
| Receives | From every agent | Board digests of each `done` card (verified) and each `blocked` card (docs). The sweep catches what no digest reports. |

## Cost

On Haiku, measured: a digest cost $0.0009 to $0.0021, and a sweep that read two boards cost $0.0013
with a narrow toolset. Sonnet's token prices are 20 times Haiku's, so on Sonnet expect about $0.02 to
$0.12 per digest or sweep. That is inferred, not measured. Twelve sweeps a day plus digests should
stay well under the $5 daily cap.

## Not verified

- A message typed in the dashboard's CEO chat. A plain session started through the API was
  answered from the board, under the $1.00 cap.

- A coordinator on a cron. The cron probe used a CEO that was not a coordinator, so the
  `Recurring:` standing card has not been seen.
- A digest of a `blocked` card. Only `done` digests have been seen.
- Digests on Sonnet, and whether $1.00 clears Sonnet's pre-flight quote for this toolset.
- Whether the CEO is woken by a digest about the standing card it closed itself.
