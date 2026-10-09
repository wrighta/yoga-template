## Phase: Polish the block-creation flow (4 fixes, no new features)

### 1. Combo select: one click → typing (her main annoyance)
In `src/components/combo-select.tsx`:
- **Remove** the redundant "or type a new name" button from dropdown mode (it was a confusing second affordance).
- Choosing **"＋ Type a new one…"** in the dropdown immediately swaps to the text input **with `autoFocus`** — she can start typing straight away.
- Keep "← choose from your list instead" inside text mode to go back.

**Server hardening (the bug her testing exposed):** the literal `__new__` value was submitted and a junk instructor named "__new__" was created. In `createSmartBlockAction` and `addOccurrenceAction`: treat `__new__` as "no selection" → friendly validation error ("Pick a class type from the list or type a new name"), never create junk records. Also delete the stray `__new__` instructor row from the dev database.

### 2. "15 of 16 dates available" — explained, no code bug
Diagnosis (from DB + audit log): one of the block's 16 dates was cancelled at 19:34 during her "Cancel & notify" test, so the card correctly showed 15 available. I'll:
- Restore that accidentally-cancelled date back to `scheduled` so her test block reads 16/16 again (it's test data she's evaluating).
- Delete the stray half-created test series/blocks from her exploration (Strong/Yin duplicates) if she prefers — actually keep her two real blocks (Strong + Yin) intact; only restore the cancelled date and remove the `__new__` instructor.
- Explain the answer clearly in my final message.

### 3. Venue becomes a combo with a Google Maps field
- **Block form + single-class form**: venue becomes the same combo pattern — pick an existing venue, or choose "＋ Add a new venue…" which reveals **venue name + Google Maps link** inputs (maps link optional; validated to start with `https://` when provided).
- `ComboSelect` gains an optional `extraNewField` prop (name/label/placeholder) to render the second input in new mode.
- Server (`createSmartBlockAction`, `addOccurrenceAction`): resolve venue — numeric id = existing; text = create a venue row (name + map_url). Venue creation persists for next time, same as class types/instructors.
- `venues.map_url` column already exists — no migration.

### 4. Hide the advanced series tools
- On the Create page: collapse "Advanced: recurring series" + "Manage existing series" into one visually-muted `<details>` labelled "Advanced: recurring series tools (rarely needed)" — hidden by default, one click to restore later, no code deleted.
- Update the Create-page intro text to drop the series mention.
- The E2E "series price override" test still passes (it opens the details programmatically).

### Tests & verification
- Update E2E combo interactions: `selectOption("＋ Type a new one…")` → fill the auto-focused input (no button click) — matching the real UX.
- Full suites re-run: expect 53 unit / 47 integration / 23 E2E green.
- Production build + restart dev server; screenshot the finished Create page.