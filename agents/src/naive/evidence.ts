/**
 * What a session's own events prove it was shown. An agent's word that it saw a picture is not
 * evidence: on 8 November three Art Director reviews (ses_gwshmye25aef0eme127hehcjty,
 * ses_n21fhfzqryakj7mjytafdt6bzd, ses_amj1nvfzxg0awmwm4f86334vt5) submitted `seen: true` with
 * specific reasons, then said in their last message that the pictures never arrived and that the
 * reasons were made up. So a claim to have seen a picture counts only when, in that same session:
 *
 * - a `view_image` call for that exact file id completed without error, and its result lists the
 *   id (the platform attaches each picture it could open as an `[image] <file id>` line, and leaves
 *   out an id it could not open), before the `submit_output` call that carried the claim; and
 * - the agent did not say afterwards that the pictures did not reach it.
 *
 * The Art Director and Quality Check both gate their reviews on this.
 */

export interface StreamedEvent {
  seq?: number;
  type: string;
  data?: Record<string, unknown>;
}

/**
 * What an agent writes when it says it never saw the pictures: the three sessions above, in their
 * own words. Narrow on purpose: "I saw no text in the image" or "I did not see any logo" describe a
 * picture, and must not read as a retraction.
 */
const RETRACTIONS: readonly RegExp[] = [
  // "The pictures never reached me", "The four screenshots never showed up in my conversation",
  // "The pictures didn't come through in this conversation".
  /\b(?:pictures?|images?|screenshots?|frames?|pixels?)\b[^.!?\n]{0,40}?\b(?:never|did\s+not|didn['’]t|have\s+not|haven['’]t)\s+(?:actually\s+)?(?:arrive|arrived|reach|reached|show(?:ed|n)?\s+up|come\s+through|came\s+through)\b/i,
  // "no image content reached me", "No images came through", "no pictures arrived".
  /\bno\s+(?:image|picture|pixel|screenshot)s?(?:\s+content)?\s+(?:reached|arrived|came\s+through|was\s+(?:shown|attached))\b/i,
  // "I didn't actually see the four pictures", "I never actually saw the four pictures".
  /\b(?:did\s+not|didn['’]t|never|have\s+not|haven['’]t)\s+actually\s+(?:see|saw|seen|view|viewed|look(?:ed)?\s+at)\b/i,
  // "I couldn't see the pictures", "I can't actually see them".
  /\b(?:could\s+not|couldn['’]t|can\s*not|can['’]t)\s+(?:actually\s+)?see\s+(?:them|(?:the|these|those)\s+(?:\w+\s+)?(?:pictures|images|screenshots))\b/i,
  // "I never saw the four pictures", "I did not see any of the four images".
  /\bnever\s+saw\s+(?:the|any|these|those)\s+(?:of\s+(?:the|them)\s+)?(?:\w+\s+)?(?:pictures?|images?|screenshots?)\b/i,
  /\b(?:did\s+not|didn['’]t)\s+see\s+any\s+of\s+(?:them|the\s+(?:\w+\s+)?(?:pictures|images|screenshots))\b/i,
  // "describe pictures I couldn't actually see".
  /\b(?:pictures|images|screenshots)\s+I\s+(?:could\s*(?:not|n['’]t)|did(?:\s+not|n['’]t)|never)\s+(?:actually\s+)?(?:see|saw|view(?:ed)?)\b/i,
  // "I submitted without seeing the pictures", "I assumed ... without checking the picture".
  /\bwithout\s+(?:actually\s+)?(?:seeing|checking|viewing|looking\s+at)\s+(?:them|it|the\s+(?:\w+\s+)?(?:pictures?|images?|screenshots?))\b/i,
  /\bcould\s*(?:not|n['’]t)\s+have\s+seen\b/i,
  // Quality Check: "The full-size frames and the seams sheet returned no pixels to me".
  /\b(?:returned|gave|showed)\s+(?:me\s+)?no\s+(?:pixels|pictures?|images?)\b/i,
  // "`seen: true` was wrong".
  /\bseen\W{0,3}\s*(?::|=)?\s*\W?true\W{0,3}\s+was\s+wrong\b/i,
  // "I made it up", "I made those details up".
  /\bmade\s+(?:it|that|this|them|those(?:\s+details)?|these(?:\s+details)?)\s+up\b/i,
  // "treat this review as unseen", "treat the submitted result as unreviewed".
  /\btreat\b[^.!?\n]{0,60}\bas\s+(?:unseen|unreviewed|not\s+seen|not\s+reviewed)\b/i,
];

/** The sentence of `text` in which the agent says it did not see the pictures, or undefined. */
export function retractionIn(text: string): string | undefined {
  for (const pattern of RETRACTIONS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const start = Math.max(0, text.lastIndexOf('.', match.index) + 1);
    const end = text.indexOf('.', match.index + match[0].length);
    return text
      .slice(start, end < 0 ? undefined : end + 1)
      .trim()
      .slice(0, 300);
  }
  return undefined;
}

/** Follows one session's events and says which file ids it was provably shown. */
export class ViewEvidence {
  /** Each file id a successful `view_image` returned, with when its result arrived. */
  private readonly views = new Map<string, number>();
  private readonly calls = new Map<string, { name: string; args: Record<string, unknown> }>();
  private readonly submitStarts = new Map<string, number>();
  /** When the latest accepted `submit_output` call started. */
  private submittedAt: number | undefined;
  /** When the latest successful `view_image` result arrived. */
  private lastViewAt = -1;
  private retractedAt = -1;
  /** The agent's own words, when it said the pictures did not reach it after its last view. */
  retractionText: string | undefined;
  /** `submit_output` calls Naive accepted. */
  submissions = 0;
  private clock = 0;

  handle(event: StreamedEvent): void {
    this.clock += 1;
    const at = this.clock;
    const data = event.data ?? {};
    const id = String(data.tool_call_id ?? '');
    switch (event.type) {
      case 'tool.started': {
        const name = String(data.name ?? '');
        this.calls.set(id, { name, args: (data.args as Record<string, unknown>) ?? {} });
        if (name === 'submit_output') this.submitStarts.set(id, at);
        return;
      }
      case 'tool.completed': {
        if (data.is_error) return;
        const call = this.calls.get(id);
        const name = String(data.name ?? call?.name ?? '');
        if (name === 'submit_output') {
          this.submissions += 1;
          this.submittedAt = this.submitStarts.get(id) ?? at;
          return;
        }
        if (name !== 'view_image') return;
        const asked = call?.args.file_ids;
        const output = typeof data.output === 'string' ? data.output : '';
        for (const fileId of Array.isArray(asked) ? asked : []) {
          // The tool lists only the ids it could open.
          if (typeof fileId === 'string' && output.includes(fileId)) {
            if (!this.views.has(fileId)) this.views.set(fileId, at);
            this.lastViewAt = at;
          }
        }
        return;
      }
      case 'message.completed': {
        if (data.role !== 'assistant' || typeof data.content !== 'string') return;
        const said = retractionIn(data.content);
        if (said) {
          this.retractedAt = at;
          this.retractionText = said;
        }
        return;
      }
      default:
        return;
    }
  }

  /** True when the agent said the pictures did not reach it, after its last successful view. */
  get retracted(): boolean {
    return this.retractedAt > this.lastViewAt;
  }

  /**
   * Every file id the session was provably shown before the submission that carried its result.
   * Empty once the agent has retracted.
   */
  get viewed(): Set<string> {
    if (this.retracted) return new Set();
    const before = this.submittedAt ?? Number.POSITIVE_INFINITY;
    return new Set([...this.views].filter(([, at]) => at < before).map(([fileId]) => fileId));
  }

  /** The ids of `fileIds` the session cannot be shown to have seen. */
  unseen(fileIds: readonly string[]): string[] {
    const viewed = this.viewed;
    return fileIds.filter((fileId) => !viewed.has(fileId));
  }

  /** Why the session's claim to have seen `fileIds` does not stand, or null when it does. */
  problem(fileIds: readonly string[]): string | null {
    if (this.retracted)
      return `the agent said afterwards that the pictures did not reach it ("${this.retractionText}")`;
    const missing = this.unseen(fileIds);
    if (missing.length === 0) return null;
    return `the session's events show no view_image result for ${missing.join(', ')} before it submitted`;
  }
}
