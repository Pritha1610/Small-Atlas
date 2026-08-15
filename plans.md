# Favours — quest design for the drowning world

Status: **design agreed, not built.** Section 1 reviewed and approved; the rest is proposed and
still needs a pass before implementation.

## Decisions locked

| Question | Decision |
| --- | --- |
| Who the player is | **A traveller passing through.** Owes nobody. Favours are offered, never assigned; walking away is not a refusal. |
| What a favour pays | **A mix**: the world visibly changes, a person opens up, or somewhere new is revealed. |
| Tracking | **One favour at a time.** One HUD line plus a minimap marker. Accepting another replaces it, silently and without penalty. |
| Structure | **Templated archetypes bound to the world at boot** (approach A). |

They are called **favours**, not quests, everywhere in the UI and the writing. Nobody in this
world would use the word quest.

## The constraint that drives the whole design

The world is regenerated on every page load — terrain, settlements, NPCs, wonders and drowned
ruins are all placed procedurally. **A hand-authored favour that names a place cannot work**,
because that place will not exist next session. Everything binds at runtime or not at all.

## Section 1 — Core model (approved)

```
Favour {
  archetype   // 'carry-post', 'the-door', 'kite', ...
  giver       // an NPC that exists in this world
  subject     // the place or person it concerns
  condition   // 'arrive' -> done on reaching the subject
              // 'report' -> done on returning to the giver afterwards
  reward      // world-change | story-unlock | reveal-place
}
```

- At boot each archetype states its requirements (*an elder in a cave band*, *a drowned ruin at
  least 40 units from its giver*) and binds against the world that generated. Anything that
  cannot bind is dropped silently. A world with no caves simply has no cave favours — no
  fallbacks, no placeholder text.
- **Offering reuses the dialogue system.** An NPC holding an unbound favour offers it on `E`
  instead of a story beat. No parallel interaction path.
- **Only two condition types**, `arrive` and `report`. Every idea below fits one of them, so
  there is no scripting engine to build.
- Binding beats authoring precisely because the archetype knows it chose *a cave elder* and *a
  drowned ruin 60 units north* — its text can be specific about kind and direction without ever
  knowing names in advance.

## Section 2 — The archetypes (proposed, needs review)

Story-linked:

- **The door** — an elder asks you to swim down to their mother's drowned kitchen and confirm the
  yellow tiles are still there. `report`. Unlocks that elder's deepest story layer.
- **The breach** — a pilgrim believes the Great Wall was a dam that failed; walk it and look for
  the break. There is none. `report`. What you tell them is the player's call.
- **The calendar** — read the stone at Chichen Itza and say what it predicts. It says nothing.
  `report`.
- **The measuring post** — carry a new water-level post further uphill. `arrive`. The post is
  still standing when you come back.
- **Seed run** — carry seeds from a cave store to an upland settlement that lost theirs.
  `arrive`. A garden appears there later.
- **Last visit** — ferry an elder out to see their old house one final time. `arrive`. Slow boat,
  no conversation required.

Chill / low-stakes:

- **The kite** — a child asks you to fly it from the highest place you can reach. `report`.
  An excuse to trek a mountain.
- **A name for the raft** — a kid asks you to name their boat; you choose; later you find it
  painted on. `arrive`.
- **The bell** — hang a bell on a stilt house so it can be found in fog. `arrive`.
- **The good rope** — one settlement needs rope, another has spare. `arrive`.
- **Two neighbours** — carry a message between two people who are not speaking. They are being
  petty. `report`.
- **Deep water** — fetch water from a spring higher than the salt reaches. `report`.

Target: ~20 archetypes so a session sees maybe six.

## Section 3 — Rewards (proposed, needs review)

- **World-change** — the smallest thing that persists and is visible on return: a post, a painted
  name, a lit lamp, a marker buoy, a patch of garden. Implemented as a prop spawned at a bound
  position; survives for the session.
- **Story-unlock** — flips that speaker to a private tier in the corpus so they say what they
  don't tell strangers. Needs a `private` flag on lines.
- **Reveal-place** — drops a marker on the minimap for a wreck, cave or route.

## Section 4 — UI (proposed, needs review)

Reuses the existing HUD. One line under the map naming the active favour, a marker on the
minimap for its subject, and the existing dialogue panel for offer and completion. No journal,
no quest log, no checkboxes.

## Open questions for the next pass

1. Should the world-change props persist across sessions (localStorage) or reset with the world?
   The world regenerates anyway, so persistence may be incoherent.
2. Does refusing or ignoring a favour ever change what a person says to you later?
3. Do favours gate the story stages, or stay orthogonal to them? Currently stages are driven by
   exploration alone.
4. "The calendar" and "the breach" both hinge on telling someone a comforting lie or the truth.
   Worth a light choice mechanic, or keep it as flavour text with no branching?

## Not doing

- No quest log, no journal, no checklist UI.
- No fail states, no timers, no escort combat, no fetch chains longer than one hop.
- No currency, inventory or stats — none exist in the game and none should be added for this.
