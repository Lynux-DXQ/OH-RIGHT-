import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { heuristicDraft, draftReply } from '../server/replies.mjs';

const thread = (...texts: string[]) => ({ id: 'x', name: 'Chat', unread: texts.length, messages: texts.map((text) => ({ from: 'Kai', text })) });

describe('fallback drafts (no AI key)', () => {
  const cases: Array<[string, RegExp]> = [
    ["Let's get it", /Let us do it/],
    ['Hey!', /Hey!/],
    ['Good morning everyone', /Good morning/],
    ['Thanks so much for yesterday', /Anytime/],
    ['I got the job!!', /congratulations/],
    ['My grandfather passed away last night', /so sorry/],
    ['Sorry I am running late', /No worries/],
    ['Are you coming on Sunday?', /I will be there/],
    ['What time is the meeting?', /confirm the time/],
    ['Are you free for lunch tomorrow?', /works for me/],
    ['Where are you?', /On my way/],
    ['Can you send me the report please', /take care of it/],
    ['Staging is down again', /take a look/],
    ['Any update on the release?', /confirm shortly/],
    ['lol that video', /Haha/],
    ['Do you like pineapple on pizza?', /Good question/],
    ['The office is closed on Monday', /Noted/],
  ];
  it.each(cases)('%s', (message, expected) => {
    expect(heuristicDraft(thread(message))).toMatch(expected);
  });

  it('uses the earlier message when the last one is only a bare follow-up question', () => {
    expect(heuristicDraft(thread('Are you coming on Sunday?', 'Well?'))).toMatch(/I will be there/);
  });

  it('a spoken change replaces the draft and starts with a capital letter', async () => {
    const out = await draftReply(thread('Are you free tonight?'), "say yes, I'll bring dessert", 'Yes, that works for me.');
    expect(out.text).toBe("Yes, I'll bring dessert");
  });
});
