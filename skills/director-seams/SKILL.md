---
name: director-seams
description: How the Director sets transitionOut on every scene boundary of a campaign.json, with the default seam plan for each beat template and the rules a changed plan must still meet. Read when writing or repairing transitions.
---

# Seams

Every scene except the last has `transitionOut`, a catalog id from `t1` to `t17`. The full catalog
is in `docs/motion/transitions.md`. The renderer's resolver checks each id and honours it only
when it is legal for that boundary, so write legal ids and the film plays as written. It logs
every boundary where it overrides one. [N] marks a new default that is not in the reference spec.

## The ids you will use

| Id    | Name                         | Use it for                                                                                                                                                                                                                                                              |
| ----- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `t1`  | Matched-velocity seam        | Two scenes that both move on the same axis across the cut. The default between type cards and into proof and feature groups                                                                                                                                             |
| `t3`  | Dead-stop cut into word rise | A rest. About a third of all seams                                                                                                                                                                                                                                      |
| `t5`  | Blink and rack               | Between cards of one group: `feature-card`, `proof-bars`, `stat-counter`, `status-relay`. Always into a pivot `type-card`, where it is a 5-frame chapter blink                                                                                                          |
| `t6`  | Object becomes world         | Optional: `proof-bars` into `colour-event`                                                                                                                                                                                                                              |
| `t7`  | Tile flood                   | Optional: `tile-wall` into `colour-event`                                                                                                                                                                                                                               |
| `t16` | Dip to black                 | Never into or out of `colour-event` in the templates: it takes 15 frames from the incoming scene and 12 from the outgoing scene, and those do not count toward `card.min`. Use `t3` there. `colour-event` is the templates' only ground change, so they never use `t16` |

The others (`t2`, `t4`, `t8` to `t15`, `t17`) are internal to scenes or builds that no template
pins, such as `t9`, the long ramp into a cut. Do not write them unless the brief asks for that
showpiece.

## Default plans

These come from the template tables in `director-beat-templates`. Each plan was checked against
every rule below. Seam `k` is `scenes[k - 1].transitionOut`.

| Template | Seams                                                                           |
| -------- | ------------------------------------------------------------------------------- |
| Short    | `t3 t1 t3 t1 t5 t1 t3 t3 t1 t1`                                                 |
| Standard | `t3 t1 t3 t3 t1 t5 t5 t5 t1 t5 t5 t5 t3 t3 t3 t1 t1`                            |
| Long     | `t3 t1 t3 t3 t5 t1 t3 t1 t5 t5 t3 t5 t5 t3 t1 t3 t5 t1 t5 t5 t5 t5 t3 t3 t1 t1` |

Hook variants copy `scenes[0].transitionOut`.

## Rules a changed plan must meet

Recheck these after any substitution, such as a proof row turned into a `feature-card`. The
substitutions in `director-beat-templates` give the seams after each swap.

1. **Ground.** `colour-event` has the event ground and every other scene the skin ground. A
   boundary into or out of `colour-event` takes `t6`, `t7` or `t3`: `t16` is in the reference
   spec's ground-change set, but never here (see its row above). Every other boundary
   takes `t1`, `t3`, `t4` or `t5`. The one pin, `t5` into a pivot `type-card`, wins over every
   rule here.
2. **Dead stops.** With `s` seams, `count(t3)` is in `[floor(s / 3), ceil(s / 3)]`: 3 or 4 of 10,
   5 or 6 of 17, 8 or 9 of 26. The Short default has 4, Standard 6 and Long 9: each is at the
   ceiling, so a changed plan never adds a `t3`.
3. **Exempt.** `t1` and `t3` anywhere. `t5` between consecutive scenes of the same type.
4. **Limited.** Every other id at most 3 times per film, and never on two adjacent seams. A pinned
   seam wins over this.
5. **Showpieces.** `t6`, `t7`, `t12`, `t13`, `t14` and `t15`: at most Short 2, Standard 3,
   Long 4 [N for Short and Long].
6. **`t1` needs matching motion.** Both scenes must declare a velocity on one axis. In the
   library: `type-card`, `feature-card`, `proof-bars`, `stat-counter`, `status-relay` (first card)
   and `site-scroll` (exit) move on x. `rail-words` moves on x the other way, so `t1` only joins
   two `rail-words`. `logo-reveal` (exit), `site-hero` (entry), the name `type-card` (exit) and
   `end-card` (entry) move on y. Anything else gets `t3`.
7. **Never** `fade`, `slide` or any id outside `t1` to `t17`.

A Standard film with `t5` on seam 8, next to the in-group `t5` on seam 7, is correct: seam 8 is
the pinned chapter blink.
