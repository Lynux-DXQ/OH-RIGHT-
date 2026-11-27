# Audit of commit 8622869 (ask, meeting research, booking requests)

Four cheap models each reviewed the commit read-only, with one lens each. Full reports are alongside this file.

| Lens | Model | Report |
| --- | --- | --- |
| Booking state flows and retries | google/gemini-3.8-flash | [gemini-3.8-flash.md](gemini-3.8-flash.md) |
| Security: prompts, routes, search | deepseek/deepseek-v4.1-flash-1017 | [deepseek-v4.1-flash.md](deepseek-v4.1-flash.md) |
| Honesty of user-facing text | minimax/minimax-m3.1-flash | [minimax-m3.1-flash.md](minimax-m3.1-flash.md) |
| Tests and failure paths | qwen/qwen3.8-flash | [qwen3.8-flash.md](qwen3.8-flash.md) |

The MiniMax run failed once with an upstream 503 and was retried. A model switch I sent to that subagent by mistake was stopped before it ran, so the report is attributed to MiniMax, its first model.

## Triage

Fixed in this change:

- A retried booking save showed "Trying again", which let a double tap start a second save. The retry now keeps the Saving, Scheduling or Sending label, so the double-tap guard holds.
- "Book a table for two at seven" was parsed as a reminder because the parser treats "book" as a task verb. Booking and reserve requests now go to the model.
- The research request sent `{}` instead of the client clock, so calendar times were read in UTC. It now sends the clock.
- Calendar text and search snippets could close the `<meeting>` and `<sources>` tags in the brief prompt. They are now stripped of angle brackets.
- A malformed model reply while picking the company failed the whole research call. It now falls back to the meeting title.
- Error responses returned the raw upstream message, which for the calendar fetch could include the secret iCal URL. Callers now get a generic message, and the detail is logged on the server.
- The "no live web search" caveat was wrong when a key was set but the search failed. The text now says which case applies.
- Booking ids are capped at 64 characters.
- The glasses render-budget test now covers the brief and booking screens.

Accepted, not changed:

- Search queries are written by the model from the meeting details. That means meeting-related text, such as a company name, goes to Brave. This is the purpose of the feature, but it is worth knowing before the calendar carries confidential detail.
- The reminder confirmation says "I will message you on Telegram", which is also true of existing reminders in demo mode. Left as it was.
- `/api/health` has no token and CORS reflects any origin when `APP_TOKEN` is set. Both are pre-existing.
- Nothing rate-limits `/api/research`, which makes two model calls per request.
- A booking records a reminder only. No airline, hotel, restaurant or calendar is contacted, and the app says so.
