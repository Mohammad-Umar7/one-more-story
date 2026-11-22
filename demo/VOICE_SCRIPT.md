# Demo voice script (India)

Two people speak in the demo: **Aamir** (recorded once, beforehand) and **Dada** (live, on camera, voice only, no tapping).

## 1. Aamir: record these lines (one take, any phone)

Read them top to bottom with a one-second pause between lines. Saying the number first is fine ("Two. Good morning, Dada…"). Lines marked *already recorded* can be skipped. Send the recording(s), or put them in `demo/aamir stuff/` and run:

```powershell
npm run demo:voice -- "demo/aamir stuff/<your file>"
```

Every line he records is played in his real voice; anything not recorded falls back to the matched AI voice.

**Hello**

1. Hello Dada, it's me, Aamir!  *(already recorded)*
2. Good morning, Dada. It's so lovely to see you today.
3. I have a picture to show you.

**Tell the Story**

4. Here's a photo from your album. What would you like to share about this day?
5. That was the day you taught me to ride my bike, Dada. What do you remember most about it?
6. You kept running behind me, holding the seat. How did it feel when I finally rode on my own?
7. I'll never forget it, Dada. Tell me a little more.
8. Thank you for sharing that. Would you like to listen back, save it, or let it go?
9. Saved. Your family will love hearing this. Thank you, Dada.

**My Memory Room**

10. Now let's find four things in your living room.
11. Where do you usually keep your glasses?
12. Yes, the blue bowl. That's where your glasses live.
13. Now, where do you usually keep your keys?
14. That's the top drawer. Your keys usually live somewhere else. Would you like to hear your clue?
15. Here's your clue, in your own voice.
16. Where do you think they are?
17. That's right, the hooks by the door.
18. Now, where do you usually keep your watch?
19. Lovely. Your watch goes in the top drawer.
20. Now, where do you usually keep your prayer beads?
21. Yes, the windowsill. Just where they belong.
22. All four, back where they belong. Well done, Dada.

**Show Me Your Street**

23. Now you're the tour guide, Dada. Let's walk down your street.
24. We're starting at the front gate. What can you tell me about this place?
25. What a lovely gate, Dada. Shall we go on to the bakery straight ahead?
26. Here we are at Noor Bakery. What can you tell me about this place?
27. I can almost smell the fresh bread. Which way shall we go: the lane on the left, or the main road on the right?
28. Here we are at Jasmine Lane. What can you tell me about this place?
29. It's so peaceful here. Shall we go on to the little park?
30. Here we are at the little park. This is as far as the path goes. What can you tell me about it?
31. I love this park too, Dada. Shall we finish the tour here?
32. Thank you for the tour, Dada. Your family can walk it with you any time.

**Goodbye**

33. Well done, Dada! I'm so proud of you.  *(already recorded)*
34. That was wonderful, Dada. Thank you for playing with me.
35. I love you, Dada. See you tomorrow.  *(already recorded)*


## 2. Dada: what to say live (voice only, nothing to tap)

| When Aamir says… | Dada says |
|---|---|
| "What would you like to share about this day?" | "This is the day I taught Aamir to ride his bike on the Corniche." |
| "What do you remember most about it?" | "He kept falling, but he never gave up." |
| "How did it feel when I finally rode on my own?" | "I was so proud. I bought him mango ice cream." |
| "Tell me a little more." | "That's all." |
| "…listen back, save it, or let it go?" | "Save it." |
| "…your glasses?" | "In the blue bowl." |
| "…your keys?" | "In the drawer." (a deliberate miss, to show the clue) |
| "Would you like to hear your clue?" | "Yes please." *(his own recorded clue plays)* |
| "Where do you think they are?" | "On the hooks by the door." |
| "…your watch?" | "In the top drawer." |
| "…your prayer beads?" | "On the windowsill." |
| "We're starting at the front gate…" | "This is my front gate. I painted it green myself." |
| "Shall we go on to the bakery…?" | "Let's go to the bakery." |
| "Here we are at Noor Bakery…" | "I bought fresh bread here every morning." |
| "Which way shall we go…?" | "Let's take the lane on the left." |
| "Here we are at Jasmine Lane…" | "It smells of jasmine in the evening." |
| "Shall we go on to the little park?" | "Let's go to the park." |
| "Here we are at the little park…" | "This is where I feed the pigeons every evening." |
| "Shall we finish the tour here?" | "Let's finish the tour." |

To show that side talk is ignored, someone can say something to Dada mid-story ("Dada, your chai is ready"): the companion stays quiet and it isn't saved in the story.

## 3. Aamir: re-record three story answers (India, for setup)

Only these three mentioned Pakistan. Same as before otherwise.

**1. Where did Dada grow up?**
> Dada grew up in Lucknow, in a big old house with a courtyard and a lemon tree in the middle. He was the eldest of six children. He always tells me how his mother made fresh roti in a clay tandoor every morning, and how he and his brothers played cricket in the street until it got dark.

**3. How he met the love of his life**
> He met Dadi at a wedding in Lucknow in 1972. He says she laughed at one of his jokes, and that was it. They got married a year later, and in 1976 they moved to Abu Dhabi with just two suitcases and a small radio.

**6. What he loves**
> Dada loves strong chai with lots of sugar, and gulab jamun. He loves old Mohammed Rafi songs and he hums them all the time. He loves watching cricket, especially when India is playing, and every evening he feeds the pigeons in the park.

## Before recording the demo

- Start the companion with no touch at all: this opens a separate Chrome window that may play sound and use the microphone without asking.

  ```powershell
  Start-Process chrome -ArgumentList "--user-data-dir=$env:TEMP\oms-demo","--autoplay-policy=no-user-gesture-required","--use-fake-ui-for-media-stream","--app=http://localhost:3000"
  ```

  (In normal Chrome: site settings for localhost, **Microphone: Allow** and **Sound: Allow**.)
- The flow: Aamir greets → Tell the Story (one picture) → My Memory Room → Show Me Your Street → goodbye.
- To run it again, just reload http://localhost:3000.
