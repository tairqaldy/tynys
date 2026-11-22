# Demo video

[`public/demo/tynys-demo.mp4`](../public/demo/tynys-demo.mp4) (4 min 8 s, 1440×900, served at
<https://tynys-blond.vercel.app/demo/tynys-demo.mp4>) is recorded from the files in this folder:

| File | What it holds |
|---|---|
| [`SCRIPT.md`](SCRIPT.md) | the narration as plain text, scene by scene, with times and what is on screen |
| `narration.json` | what is said in each scene, and by which narrator (`M` male, `F` female voice) |
| `scenes.mjs` | the captions and the scripted cursor actions of each scene |
| `titles.mjs` | the animated opening and closing pages |

The recorder is [explainer-video-skill](https://github.com/tairqaldy/explainer-video-skill): it plays the
actions in headless Chrome against the live site, fits each scene to its voice clip and encodes the
result with AVFoundation. The voices are two stock ElevenLabs voices (`voice.speakers` in `scenes.mjs`),
so this video needs the recorder's ElevenLabs engine and an `ELEVENLABS_API_KEY` in the environment:

```bash
node <skill>/scripts/record.mjs video/scenes.mjs --out ../public/demo/tynys-demo.mp4   # paths are relative to video/
```

Everything on screen comes from the live site at the time of recording (22 November 2026, Almaty, 22:00).
The results quoted in the narration are the ones in [`docs/evaluation.md`](../docs/evaluation.md).
