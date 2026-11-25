# OH, RIGHT! - DoraHacks submission (copy and paste)

## Project name
OH, RIGHT!

## Tagline (one line)
Catch it. Prep it. Send it: a voice-first daily assistant for Even G2 that handles reminders, meeting prep and Telegram replies without a phone check.

## Track
04 - AI Assistants & Work
Also enter: Special prize - Best Telegram integration

## Links
- Code: https://github.com/Lynux-DXQ/OH-RIGHT-
- Demo video (1:02): upload oh-right-demo.mp4 to YouTube (unlisted is fine) or Loom, then paste the link here

## Short description (problem, who it is for, how it works)

**Problem.** The small things that fall through a busy day cost a phone check each: the errand you remembered with full hands, the thing you wanted to know before a meeting, the message that needs a thoughtful answer. Every check pulls you out of what you were doing.

**Who it is for.** Anyone who is on the move, in meetings or has their hands full and uses Telegram and a calendar every day.

**What it does.** OH, RIGHT! shows one thing at a time on the G2 display and lets you act in seconds. You always see what will happen before it happens.
- **Remember something (catch it).** Say "remind me to get milk at six". The glasses show "Save this reminder?" with the task and time. You tap Save, and a Telegram reminder is scheduled for that time.
- **What is next? (prep it).** You get your next calendar event with a one-line prep note, so you walk in oriented.
- **Reply to a chat (send it).** One line says who needs you. An AI drafts a reply. You can speak a change ("say yes, I'll bring dessert"), then choose Send. Nothing is sent without that tap.

**How it works.** A TypeScript and Vite web app uses the Even Hub SDK to draw short cards on the 576x288 display and read taps, scrolls and long presses. The glasses microphone audio (16 kHz PCM) goes to a small Node backend, which does speech-to-text (OpenAI Whisper or Groq), parses the command, schedules reminders, reads Google Calendar through a secret iCal feed, and talks to Telegram through a bot. An OpenAI-compatible model (OpenAI or OpenRouter) writes summaries, drafts and prep notes. The phone-side page mirrors the glasses screen and has a typed-input fallback.

**Trust and safety.** Sends and reminders need an explicit tap. Chat text is treated as untrusted data in prompts. Sends and reminders are idempotent. The backend binds to localhost, rejects foreign browser origins, and refuses a public address without a token. Keys live only on the server. Telegram messages are held in memory for 60 minutes.

**Quality.** 87 automated tests cover the parser, the state machine, the backend over HTTP, voice capture, the AI paths and the runtime. I ran it in the Even Hub simulator and tested the voice path with real synthesized speech.

## What existed before Nov 23
Nothing. The app was written during the hackathon (Nov 25 onward). Before that there was only a one-page concept brief. Open-source libraries used: Even Hub SDK, Vite, TypeScript, Vitest.

## Tech stack
TypeScript, Vite, Even Hub SDK, Node.js (no runtime dependencies on the backend), Telegram Bot API, Google Calendar (secret iCal feed), OpenAI-compatible LLM and Whisper-compatible speech-to-text (OpenAI, OpenRouter, Groq).

## Honest status
Verified: simulator run, 87 tests, real speech through a real recognizer. Not yet verified on physical G2 hardware, and live Telegram, calendar and Whisper need the owner's keys. The video uses sample calendar and chat data and typed commands, which stand in for voice in the simulator.

## Feature requests (up to 5 things the tools were missing)
1. **Even Hub SDK: no voice activity or end-of-speech event, and no built-in speech-to-text.** Every app has to buffer raw PCM, guess when you stopped, and run its own transcription server. A built-in transcript or an end-of-speech event would make voice apps much simpler.
2. **Even Hub: an app cannot show anything when it is not in the foreground.** Reminders had to be delivered through Telegram instead of the glasses. A way to post a short, user-approved alert would fit reminders.
3. **Telegram Bot API: a bot cannot read a user's existing chats.** It only sees messages sent to it, and groups need privacy mode off. A personal "reply to my chats" glance needs user-account access, which is outside the Bot API. A scoped, read-only option for chats the user picks would help.
4. **Google sign-in does not work inside the WebView.** Reading a live Google Calendar needs OAuth, so I used a secret iCal feed, which does not expand recurring events. A first-party pairing-code sign-in flow for WebView apps would unlock proper calendar access.
5. **Even Hub simulator: no way to inject microphone audio.** It only reads a live microphone device. An automation endpoint that accepts PCM would let developers test voice flows in CI.
