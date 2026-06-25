// Full product tour — guest request flow + the DJ console, narrated.
// Run from demos/:  npm run tour   (app must be up at localhost:5173)
import { record } from '../recorder/engine.mjs';

await record({
  name: 'full-tour',
  summary: 'Guest landing → search → free request → boost/play-next → DJ console',
  base: 'http://localhost:5173',
  scenes: [
    {
      title: 'mrdj',
      subtitle: 'a social jukebox for DJs',
      vo: "This is mister D J — a social jukebox that lets the whole crowd shape the music in real time. Let me walk you through what we just shipped.",
      run: async (s) => { await s.goto('/o/demo', 1200); },
    },
    {
      caption: 'The guest arrives',
      vo: "Every event gets its own public page. Guests scan a code and land here, on the organization's branded home, where the night's live event is one tap away.",
      run: async (s) => {
        await s.sleep(900);
        await s.glide('a[href*="/events/demo"]');
        await s.sleep(1200);
      },
    },
    {
      caption: 'The live event',
      vo: "Here's the live event. At the top is the track playing right now, and just below it, the queue of songs coming up next — updating live as the room makes requests.",
      run: async (s) => {
        await s.sleep(1000);
        await s.scroll(260); await s.sleep(900); await s.scroll(-260); await s.sleep(500);
      },
    },
    {
      caption: 'Search the catalog',
      vo: "When a guest wants to hear something, they just search the catalog for it.",
      run: async (s) => {
        await s.type('input[type=search]', 'kenny', 150);
        await s.sleep(1600);
      },
    },
    {
      caption: 'Request a song — free',
      vo: "Adding a song to the queue is free, so anyone can join in. We confirm the request, so there are no accidental taps.",
      run: async (s) => {
        await s.glide('button[aria-label*="to queue (free)" i]');
        await s.sleep(800);
        await s.glide('button:has-text("Confirm")');
        await s.sleep(1200);
      },
    },
    {
      caption: 'Boost & Play Next',
      vo: "This is where it becomes a business. For one credit a guest can boost their song toward the top — and for a few more, play it next. If they're out of credits, we guide them to buy more, so the D J earns while the crowd gets what it wants.",
      run: async (s) => {
        await s.glide('button[aria-label*="Boost" i]');
        await s.sleep(1800);
        await s.page.keyboard.press('Escape').catch(() => {});
        await s.sleep(500);
      },
    },
    {
      caption: 'Switching to the booth',
      vo: "Now let's step around to the other side of the booth — the D J's console.",
      run: async (s) => {
        await s.actAs('admin');
        await s.goto('/o/demo/events/demo/console', 1400);
      },
    },
    {
      caption: 'The DJ control room',
      vo: "From the console the D J sees what's playing, reorders the upcoming queue, skips tracks, and can even grant credits on the house. It's the live control room for the entire event.",
      run: async (s) => {
        await s.sleep(800);
        await s.glide('button:has-text("Grant 10 Credits")', { click: false });
        await s.sleep(800);
        await s.glide('button:has-text("Skip")', { click: false });
        await s.sleep(800);
      },
    },
    {
      title: "That's mrdj",
      subtitle: 'request · boost · play next',
      vo: "That's mister D J — request, boost, and play next for the crowd, with a live console for the D J. Thanks for watching.",
      run: async (s) => { await s.sleep(400); },
    },
  ],
});
