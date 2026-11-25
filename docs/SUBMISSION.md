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

**Testing.** 110 automated tests cover the parser, the state machine, the backend over HTTP, voice capture, the AI paths, new message alerts and the glasses runtime. I also ran the app in the Even Hub simulator.

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
