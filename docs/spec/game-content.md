# Game content

Read when defining assets, symbols, initial prices, event catalog entries, templates, or theme copy.

Source: [PROJECT_SPEC.md](../../PROJECT_SPEC.md), §3, baseline version 1.0. The numbered specification sections below are reproduced verbatim from the human reference; routing notes above them are navigation aids.

For catalog effects and seeded selection, read [events and narration](events-and-narration.md). For price calculations, read [market engine](market-engine.md).

Verification: AC-02, AC-09, AC-13. Read the exact cases in [verification](verification.md); this list is a starting point, not a replacement for checking affected behavior.

[Spec index](README.md) · [Agent instructions](../../AGENTS.md)

---

## 3. Theme and assets

The setting is **Pangaea Exchange**, a prehistoric marketplace operated by cartoon dinosaurs. News comes from a fictional broadcaster, **The Daily Roar**. The tone is witty and energetic, with no requirement for scientifically accurate coexistence of species.

| Symbol | Asset | Description | Initial reference and last price |
| --- | --- | --- | ---: |
| FERN | Fern Farms | Food for hungry herbivore herds | D$40.00 |
| AMBR | Amber Works | Collectible amber and trapped ancient treasures | D$75.00 |
| VOLC | Volcano Energy | Geothermal power from unpredictable volcanoes | D$100.00 |
| BONE | Fossil Finds | Excavations and rare fossil discoveries | D$25.00 |

Example events:

- “A brachiosaurus herd discovers Fern Farms’ all-you-can-eat valley.”
- “Fresh amber deposits uncovered beneath the Triceratops tram line.”
- “Volcano Energy shuts down a vent after an unusually dramatic sneeze.”
- “Fossil Finds announces a record dig. Paleontologists demand a recount.”

Each catalog event has fixed affected symbols, integer reference-price changes in basis points, a factual template, and an illustration/icon identifier. Narrative prose is never parsed into market instructions.
