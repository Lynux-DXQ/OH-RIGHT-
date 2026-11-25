# OH, RIGHT! - DoraHacks submission (copy and paste)

## Project name
OH, RIGHT!

## Tagline
Catch it. Prep it. Send it. A voice-first assistant for Even G2 glasses that handles reminders, meeting prep and Telegram replies without taking your phone out.

## Track
04 - AI Assistants & Work
Also entering: Special prize - Best Telegram integration

## Links
- Code: https://github.com/Lynux-DXQ/OH-RIGHT-
- Demo video (1:10): upload oh-right-demo-v2.mp4 to YouTube (unlisted is fine) or Loom, then paste the link here

## Description

**The problem.** Most of what slips through a busy day is small: the errand you thought of while carrying bags, the thing you wanted to check before a meeting, the message that needs an answer. Each one costs a phone check, and each check pulls you out of whatever you were doing.

**Who it is for.** Anyone who is often on the move, in meetings or has their hands full, and who uses Telegram and a calendar every day.

**What it does.** OH, RIGHT! shows one short card at a time on the G2 display. You act on it in a few seconds, and you always see what will happen before it happens.

- **Catch it.** Say "remind me to get milk at six". The glasses show "Save this reminder?" with the task and the time. Tap Save and a reminder is scheduled. When it is due, it arrives on Telegram.
- **Prep it.** Ask "what is next?" and you get your next calendar event with a one-line note, such as an open item you owe someone.
- **Send it.** A card tells you who messaged you and what they said. An AI writes a draft reply. You can change it by voice ("say yes, I'll bring dessert"), then choose Send. Nothing goes out without that tap.
- **Telegram commands and pings.** In the bot chat, /notify on turns on a ping when someone writes in a chat the bot can see. It is off by default, and /mute 60 pauses it. /status and /reminders show what is waiting.
- **New message alerts.** While you are on the home menu, a new Telegram message pops up as a short card. Tap to reply or double tap to dismiss. If you are in the middle of something else, the alert waits.

## Why it helps in everyday life

Think about the moments when you cannot reach for your phone: carrying shopping, cooking, cycling, walking into a meeting, holding a child. Those are the moments when you think "oh, right!" and then forget again by the time your hands are free.

- **Capture while it is fresh.** A reminder takes one spoken sentence and one tap, so the thought is saved before it fades.
- **Walk into meetings prepared.** You see the next event and the one thing you owe someone, without opening a calendar.
- **Answer people without the phone trap.** Checking a phone for one message often turns into ten minutes of scrolling. The glasses show only the message you need and a ready draft, so you reply and carry on.
- **No surprises.** The app never sends or schedules anything without a tap from you, so you can trust it while busy.
- **Fits the tools you already use.** It works with Telegram and your existing calendar. There is nothing new to learn or move to.

## How it works

The glasses app is written in TypeScript with Vite and the Even Hub SDK. It draws cards on the 576x288 display and reads taps, scrolls and long presses. Microphone audio (16 kHz PCM) goes to a small Node.js backend. The backend transcribes it with Whisper (Groq or OpenAI), works out what you asked for, schedules reminders, reads the calendar from a private iCal link, and talks to Telegram through a bot. A language model (OpenAI or OpenRouter) writes the summaries, drafts and meeting notes. A companion page on the phone mirrors the glasses screen and accepts typed input as a fallback.

**Safety.** Sends and reminders always need a tap. Chat text is treated as untrusted input in the prompts. Repeated requests are not duplicated. The backend listens on localhost by default, rejects unknown browser origins and refuses to run on a public address without a token. API keys stay on the server. Telegram messages are kept in memory for 60 minutes.

**Testing.** 114 automated tests cover the parser, the state machine, the backend over HTTP, voice capture, the AI paths, new message alerts and the glasses runtime. I also ran the app in the Even Hub simulator.

## What existed before Nov 23
Nothing. The app was written during the hackathon. Before that there was only a one-page concept brief. Open-source libraries used: Even Hub SDK, Vite, TypeScript and Vitest.

## Tech stack
TypeScript, Vite, Even Hub SDK, Node.js (no runtime dependencies on the backend), Telegram Bot API, iCal calendar feed, OpenAI-compatible language model (OpenRouter), Whisper speech-to-text (Groq).

## Current status
What I have tested:
- The app in the Even Hub simulator.
- Real Telegram in both directions: pairing, a delivered reminder, and group messages received and answered.
- AI summaries and drafts through OpenRouter.
- Groq Whisper transcribing recorded speech.
- Alerts for new group messages, through the backend feed.

What I have not tested:
- Physical G2 glasses (the microphone format and real device events).
- A live calendar feed.

The demo video uses sample calendar and chat data, and typed commands stand in for voice in the simulator.

## Feature requests (up to 5)
1. **Even Hub SDK: speech-to-text and end-of-speech detection.** Apps have to buffer raw audio, guess when you stopped talking, and run their own transcription server. A built-in transcript or an end-of-speech event would make voice apps much simpler.
2. **Even Hub: alerts when the app is not in the foreground.** Reminders had to go through Telegram because an app cannot show anything while it is not running. A way to post a short, user-approved alert to the glasses would suit reminders.
3. **Telegram Bot API: bots cannot read a user's existing chats.** A bot only sees messages sent to it or to groups it is in, and groups need privacy mode switched off. A read-only option for chats the user chooses would allow a true "reply to my chats" experience.
4. **Google sign-in does not work inside the WebView.** Reading a live Google Calendar needs OAuth, so I used a private iCal link, which does not expand recurring events. A pairing-code sign-in flow for WebView apps would allow proper calendar access.
5. **Even Hub simulator: no way to inject microphone audio.** It only reads a live microphone. An endpoint that accepts audio would let developers test voice flows automatically.


## Who it is for, and what they reach for

- **Daily users:** people whose day is mostly messages and meetings and who cannot always look at a phone: founders, managers, parents, clinicians, anyone commuting or cooking with hands full.
- **Habit ranking:** Send it (reply to a chat by voice) is the daily habit, because messages arrive all day. Catch it (remember something) is the second most used. Prep it (what is next) is a quick glance several times a day. The home screen shows "(N new)" so the reply path is one tap away.
- **Who would pay:** busy professionals paying a small monthly fee for hands-free replies and reminders that actually reach them. The replies feature is the paid hero; reminders and prep are the free hook.

## Replies come from you, not the bot

A plain bot can only send as itself and only sees chats it was added to. Oh, Right supports Telegram Business mode: connect the bot under Telegram Settings > Business > Chatbots (needs Telegram Premium), and it then sees your private chats and sends replies as you, still only after you confirm on the glasses. Without Business mode it falls back to sending as the bot. `/status` shows which mode is active.

Status: covered by unit tests; not yet tried live, because it needs a Premium account.

## Reminders on the lens

A reminder that comes due appears on the glasses at that moment as a "Reminder" card, even when the Telegram ping is off. Tap to dismiss, double tap to snooze 10 minutes.

## New in this version

- **Other reply:** each draft comes with two alternatives with a different intent (for example one that defers). Pick "Other reply" to cycle them with one tap, no dictation.
- **Voice notes and threaded replies:** Telegram voice notes are transcribed and shown on the lens as "[Voice note] ...", so you can read them without a speaker. Replies are sent as a threaded reply to the last message.
- **Safer Business mode:** only the paired owner's account can connect, a revoked connection drops its chats, and replies are blocked if Telegram reports no permission to reply.
- **Fixes from an independent review:** spoken reminder edits like "make it 7 pm" keep the title, a stale alert timer can no longer dismiss a newer alert, and the demo inbox no longer empties after one send.

## Independent review

Two different AI models reviewed the code and researched the competition. Known limits they raised and that remain: no real G2 hardware test; Business mode and live calendar are untested live; the calendar reader ignores recurring events and time zones; the confirmation card truncates very long drafts (drafts are capped at 110 characters to keep them on screen).
