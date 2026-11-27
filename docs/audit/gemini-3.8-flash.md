# Audit: State Machine Flows, Booking Correctness, and Claims (Commit 8622869)

**Verdict:** The new ask, research, and brief paging state flows are largely sound, and the app never claims bookings are "reserved" or falsely "saved"; however, retrying a failed booking save allows double-tap to cause duplicate bookings, spoken booking requests with dates/times are hijacked as reminders, and research calls drop timezone offsets.

1. **High — app/src/machine.ts:117, 246; app/src/runtime.ts:155, 227.** Double-tap during a retried save abandons the UI while the HTTP request completes on the server, causing a duplicate booking when re-attempted.
   *What is wrong:* In `machine.ts:117`, double-tap is blocked only when `['Sending', 'Scheduling', 'Saving'].includes(s.label)`. Retrying a failed save from the error screen (`machine.ts:246`) sets `label: 'Trying again'`. Double-tap during `'Trying again'` succeeds, returning `to(HOME)` and incrementing `epoch` (`runtime.ts:155`). When the in-flight `api.saveBooking` resolves, it saves to `store.data.bookings` and `store.data.reminders`, then deletes the cached ID key (`runtime.ts:227`). The glasses return to HOME with no confirmation. The user assumes the operation was cancelled and re-submits the booking, generating a fresh ID and saving a duplicate booking and reminder.
   *Smallest fix:* In `machine.ts:246`, restore specific mutating labels on retry:
   ```ts
   const label = s.retry.e === 'saveBooking' ? 'Saving' : s.retry.e === 'save' ? 'Scheduling' : s.retry.e === 'send' ? 'Sending' : 'Trying again';
   return to({ t: 'busy', label, purpose: 'any', back: HOME }, s.retry);
   ```

2. **High — server/index.mjs:115; server/nlu.mjs:77.** Spoken booking requests containing a time expression are intercepted by `parseIntent` as reminders, completely bypassing the new booking flow.
   *What is wrong:* `nlu.mjs:77` includes `book` in `startsWithTask`. Any spoken booking command with a time (e.g. `"book a table for two at seven at Olive & Co"`, the exact README example) matches `parseIntent` and returns `{ type: 'reminder' }`. In `server/index.mjs:115`, `parseIntent` runs before `llmIntent`, which is only called when `intent.type === 'unknown'`. As a result, the request routes to the reminder screen and `POST /api/reminders`, displaying "Reminder set" instead of routing to the booking screen and `POST /api/bookings`. It is never recorded in `store.data.bookings`.
   *Smallest fix:* In `server/index.mjs:115`, bypass `parseIntent` when text starts with booking verbs:
   ```js
   let intent = /^\s*(research|brief me)\b/i.test(text) ? { type: 'research' } : /^\s*(book|reserve)\b/i.test(text) ? { type: 'unknown' } : parseIntent(text, { now, offsetMin });
   ```

3. **Medium — app/src/api.ts:49; server/index.mjs:155.** `api.research()` posts an empty body `{}` instead of passing client timezone clock data, forcing UTC parsing on floating calendar events.
   *What is wrong:* `server/index.mjs:155` uses `clientTime(await readJson(req))` to obtain `offsetMin` for `nextEvent`. `app/src/api.ts:49` calls `call<Brief>('/api/research', {})` without `clock()` (unlike line 43 for `/api/next`). In `server/calendar.mjs:10`, floating iCal start times are adjusted by `utc - offsetMin * 60000`. Defaulting `offsetMin` to 0 parses local meeting times as UTC, which can pick the wrong meeting or report incorrect meeting times for users outside UTC.
   *Smallest fix:* In `app/src/api.ts:49`, pass `clock()`:
   ```ts
   research: () => call<Brief>('/api/research', clock()),
   ```

4. **Low — app/src/machine.ts:143.** Stale async response guard in non-busy states omits `brief` and `bookingSaved`.
   *What is wrong:* Line 143 drops stale async inputs when not in `busy`, but omits `brief` and `bookingSaved`. While unhandled events currently fall through to `return stay` at line 251, omitting them from the explicit guard violates state machine invariants and relies on fall-through behavior.
   *Smallest fix:* Add `|| input.k === 'brief' || input.k === 'bookingSaved'` to line 143.

5. **Verified Clean — False "Booking saved" or "reserved" claims.**
   *Result:* No path shows a false "Booking saved" or "reserved" claim. `server/index.mjs:138, 143` always returns `reserved: false`, and `machine.ts:138` explicitly displays `"Nothing was reserved with a provider yet."` on the glasses screen. If `api.saveBooking` rejects, `runtime.ts:238` dispatches `{ k: 'fail' }`, correctly transitioning the machine to `{ t: 'error' }` instead of `{ t: 'done' }`. Brief paging (`machine.ts:222-225`, `text.ts:23-28`) and double-tap cancellation during read-only busy states (`Thinking`, `Researching`) correctly drop late responses via `epoch`.
