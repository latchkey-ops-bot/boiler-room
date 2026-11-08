# GTM: `br-gtm-lead`, `br-scout`, `br-social` and `br-inbox-reader`

GTM finds the people who need launch films, shows them a sample, posts, and emails. **It is
provisioned but inactive.** GTM starts after the product is nailed down. Until then every GTM agent
has a $0 budget, gets no cards, and has no cron.

## Agents

| Agent             | Purpose                                                                                                       | Model                         | Started by, once active                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `br-gtm-lead`     | Plans each launch push, writes outreach, picks which leads get a sample film, and sends email through the app | `anthropic/claude-sonnet-5.5` | Board cards from the CEO: `GTM: <slug>`, and the deployment `br-gtm-inbox`: cron `0 * * * *`, `budget_micro_usd: 1_000_000`, to act on new inbox summaries |
| `br-scout`        | Finds and qualifies leads with Naive Data                                                                     | `anthropic/claude-haiku-5.5`  | Board cards from the GTM lead: `LEADS: <slug>`                                                                                                             |
| `br-social`       | Posts and schedules on social networks, and reads post metrics                                                | `anthropic/claude-haiku-5.5`  | Board cards from the GTM lead: `POST: <slug>`                                                                                                              |
| `br-inbox-reader` | Reads one inbound email and returns fixed fields. It is not on the roster or the board.                       | `anthropic/claude-haiku-5.5`  | A session started by the app when AgentMail reports a new message                                                                                          |

Haiku agents get the line "Never call two tools in the same step." in their system prompt. Haiku
otherwise fires tool calls in parallel, which broke ordered steps in earlier probes.

## Budgets

| Agent             | Now                 | When active                 |
| ----------------- | ------------------- | --------------------------- |
| `br-gtm-lead`     | $0 cap, $0 per task | $4 a day, $1.00 per task    |
| `br-scout`        | $0, $0              | $5 a day, $1.00 per task    |
| `br-social`       | $0, $0              | $2 a day, $1.00 per task    |
| `br-inbox-reader` | $0, $0              | $1 a day, $0.15 per message |

Unit prices seen: Find Work Email $0.042 a call, Enrich Person $0.032, Search Google $0.00015. A
social post costs $0.013, or $0.0325 when X is included, or $0.273 when X is included and the text
has a link.

## Tools

| Tool                                                                                                                       | GTM lead                                    | Scout                        | Social                | Inbox reader                                                                           |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------- | --------------------- | -------------------------------------------------------------------------------------- |
| `board_read`                                                                                                               | allow                                       | allow                        | allow                 | off                                                                                    |
| `board_write`                                                                                                              | off while GTM is inactive                   | same                         | same                  | off                                                                                    |
| `submit_output`, `session_spend`                                                                                           | allow                                       | allow                        | allow                 | allow                                                                                  |
| `br-app.send_email` (the app's own MCP tool)                                                                               | allow                                       | off                          | off                   | off                                                                                    |
| `br-app.inbox_summaries`, `br-app.leads` (read)                                                                            | allow                                       | allow                        | off                   | off                                                                                    |
| `br-app.leads_upsert`, `br-app.request_sample`                                                                             | allow                                       | `leads_upsert` only          | off                   | off                                                                                    |
| `data_search`, `data_describe`                                                                                             | allow                                       | allow                        | off                   | off                                                                                    |
| `data_run`                                                                                                                 | off                                         | allow (it asks unless named) | off                   | off                                                                                    |
| `social.accounts`, `social.post`, `social.status`, `social.post_metrics`, `social.cancel`                                  | off                                         | off                          | allow, each one named | off                                                                                    |
| AgentMail MCP: `get_message`                                                                                               | off                                         | off                          | off                   | allow                                                                                  |
| AgentMail MCP: the other 53 tools, including every send, reply, forward, draft, delete, create, connect and authorize tool | off                                         | off                          | off                   | off, each one named                                                                    |
| Every other app tool, such as `br-app.company_metrics` and `br-app.feedback_summaries`                                     | off, each one named                         | off, each one named          | off, each one named   | off, each one named                                                                    |
| `apps`                                                                                                                     | off, with `config.allowed_apps: [<app id>]` | same                         | same                  | same                                                                                   |
| `bash`, `read`, `write`, `edit`, `fetch_file`, `browser`, `web_fetch`                                                      | off                                         | off                          | off                   | off                                                                                    |
| Identity                                                                                                                   | GTM persona                                 | none                         | GTM persona           | none                                                                                   |
| Vault                                                                                                                      | none                                        | none                         | none                  | AgentMail key, `static_bearer` for `https://mcp.agentmail.to/mcp`, bound to this agent |

The `apps` tool is turned off, but `allowed_apps` still names the app. That keeps the app's own
tools on offer while removing deploy, secrets and database access (verified).

## How email works

1. Someone emails `boilerroom@agentmail.to`. AgentMail calls a public route on the Boiler Room app
   with a `message.received` webhook. The app checks the webhook's Svix signature.
2. The app starts a `br-inbox-reader` session and passes it the message id. It uses a scoped Naive
   key, held as an app secret, with `sessions:write` and `sessions:read` only. The reader makes one
   call, `get_message`, then calls `submit_output` with fixed fields: sender, an intent from a fixed
   list (`lead_reply`, `customer_request`, `revision`, `unsubscribe`, `other`), and a summary of up
   to 280 characters.
3. The app stores the fields, never the raw body. Mail about a customer's film goes to the film
   pipeline. The app creates no cards: that needs `agents:write`, which would also let the app
   rewrite agents and delete itself (docs). The GTM lead's hourly fire reads new summaries with
   `br-app.inbox_summaries` and creates the cards.
4. The GTM lead replies with `br-app.send_email`. The app sends only to an allowlisted address, up
   to a daily quota, with no attachments, and only after AgentMail's flagged check passes. The
   summary is model-written from an untrusted email, so it can carry an attacker's words. The
   allowlist and quota are the real control.

The reader makes exactly one external call per chat, because after one, Naive stops the chat from
running `bash` and makes every later call wait for a human (verified). Naive email is not used.

## Policy: what GTM may not do

- Run code, write files, deploy, or hold any repo token.
- Send to an address that is not on the allowlist, or more than the daily quota. The app enforces
  this, not the prompt.
- Post a number that does not come from a quoted source. This is the claims rule from `CLAUDE.md`.
- Post or send a sample film made from another company's brand to anyone but that company.
- Reply to social comments. There is no tool for it.
- Read raw email. Only the reader sees it, and the reader can send nothing.

## Reports

| What                         | To whom                    | How                                           |
| ---------------------------- | -------------------------- | --------------------------------------------- |
| Leads found and qualified    | The GTM lead, then the CEO | `LEADS` card note, and the digest             |
| Posts made and their metrics | The GTM lead, then the CEO | `POST` card note                              |
| Outreach sent and replies    | The CEO                    | `GTM` card note, and `br-app.company_metrics` |

## Activation checklist

The founder decides when the product is nailed down. Then:

1. Open the Naive Social portal link and connect each network (README section 5, D).
2. Point the AgentMail webhook at the app's route. Ship the app's `send_email` allowlist and quota,
   and the reader's start-up code. Create the `br-gtm-inbox` deployment.
3. Raise the four budgets to the "when active" column.
4. Add the GTM agents to `br-ceo`'s system prompt as agents it may assign, and turn `board_write`
   back on for the GTM lead, the scout and social. While GTM is inactive each names it off: the
   company board seats every agent of the organization, so an unnamed board tool would be offered.
5. Update the system map in `boiler-room-design`. It lists the Account Manager as the owner of
   outreach and replies. This spec gives outreach and replies to GTM, and gives delivering and
   revising customer films to the Account Manager.

## Not verified

- Posting, scheduling and metrics on Naive Social. No network was connected. Activation and the
  portal link were verified.
- The webhook route, the app starting a reader session, the scoped key that allows it, and the
  GTM lead's hourly fire. The key's scopes come from the docs.
- Whether an app tool that returns email text sets Naive's read flag. Only a tool returning `pong`
  was tested.
- A $0 agent parking a card that was assigned to it (docs).
- Whether a card-started session selects the agent's persona. Social tools appear only in a session
  that selects it (verified). If a card-started session does not, `br-social` and the GTM lead's
  identity tools must run from a deployment that names the persona.
- Whether `data_run` sets the read flag.
