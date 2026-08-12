# Contributing

Thanks for looking. This project has a small number of rules that are not
style preferences — each one exists because breaking it produced a specific
problem. Read them before opening a pull request; a change that ignores them
will be sent back even if the code is good.

## Setup

```bash
bun install
bun run dev      # http://localhost:5178
bun run check    # must pass before every commit
bun run build
```

No global tooling beyond [Bun](https://bun.sh).

---

## The five rules

### 1. Everything in the room is procedural

No downloaded 3D models. No baked textures. No image files in the bundle.
Geometry is assembled at runtime from the primitives in `src/lib/geo.ts`;
surface detail that would normally be a texture is a fragment shader injected
through `onBeforeCompile`.

This is not asceticism. It is stated on the site itself — the room shows its
own bundle size next to the words *zero 3D assets* — so a single downloaded
`.glb` would turn a claim on the front page into a lie.

If a shader genuinely cannot do it, say so in the pull request and we will
talk about it.

### 2. No new dependencies

The project has three: `three`, `three-mesh-bvh`, `xatlas-three`. A pull
request that adds a fourth needs to argue why the thing cannot be forty lines
in `src/lib/`. Most of the time it can.

### 3. Measure first, then fix

Two performance complaints in this project's history turned out not to be
about what everyone assumed, and that only became clear from a measurement.
"It lags" was a dropped click, not a dropped frame. "Too much text" was a
layout problem, not a word count.

Before changing anything about rendering, timing or layout, take a reading
and put it in the pull request. The tools are already there:

```js
profile(4)   // geometry passes, draw calls, triangles, p50/p99 per frame
stress()     // how far the render scales before 60 fps breaks
grab()       // frame signature, so "the image did not change" is a number
measure('chair')
```

`renderer.info` is not one of these tools — it resets on every internal
`render()` call, so after the post-processing chain it holds the statistics of
the last fullscreen quad rather than the frame. `canvas.toDataURL()` is not
one either: `preserveDrawingBuffer` is off and the canvas returns blank.

### 4. No invented numbers

Any number that reaches the screen must come from a measurement, a build
report, or a cited document. The triangle count is computed by walking the
scene graph at startup. The bundle size is copied from the `vite build` output
and updated in the same commit as the build. Facts about real people and real
products come from `docs/` with a source attached, or they do not ship.

If you need a number and do not have one, measure it. If you cannot measure
it, leave the placeholder visible rather than filling it with something
plausible.

### 5. Comments are in Russian and explain *why*

Visitor-facing text is English. Source comments are Russian, and they carry
the reasoning: which measurement produced a constant, what a threshold
protects against, which bug a line prevents.

```ts
// ❌ Устанавливаем autoUpdate в false
// ✅ Солнце ставится один раз при сборке и не двигается, поэтому карта
//    теней между кадрами не меняется. Замерено: два пересчёта за кадр
//    и 270 драуколлов на них днём — полный проход по геометрии в мусор.
```

A comment restating the line below it will be removed in review. If you are
not comfortable writing Russian, write the reasoning in English in the pull
request and it will be translated — the *reasoning* is the requirement, not
the language.

---

## Checks

`bun run check` runs four things and all four must pass:

| | what it asserts |
| --- | --- |
| `tsc --noEmit` | types |
| `src/page/tree.check.ts` | landing-page structure, section order, link hygiene |
| `src/screens/tetris.check.ts` | Tetris rules, 7-bag, frame-rate-independent gravity |
| `src/lib/palette.check.ts` | the room's palette stays spread across hue and temperature |

There is no test framework and adding one is out of scope. These are plain
scripts that run without a browser, which is why they are fast and why they
get run.

The palette check deserves a note, because it is the odd one out: it does not
test behaviour, it prevents a regression of taste. The room was once
monochrome under every lighting condition, and the cause was measurable —
every coloured surface sat inside a 44° wedge of hue and every light surface
was tinted warm. The check fails if the palette collapses back into one wedge.
It measures **absolute chroma**, not HSL saturation: near-white values blow
saturation up (`0xe9e6e1` reads as S 0.15 while being eight units of 255
apart), which made the first version of the check fail a correct colour.

---

## Pull requests

- One concern per pull request.
- Commit messages explain *why*, in the same spirit as the comments. Look at
  `git log` for the register.
- Include the measurement if the change touches rendering or layout.
- Screenshots for anything visual, at the same camera pose before and after.
  `window.__pose` patterns in the debug hooks make this reproducible.

## Reporting a problem

Include your GPU and browser, and — if it is visual — the output of
`profile(4)` and a screenshot. "The room is dark" and "the room is dark at
02:00 on Firefox/Linux with an integrated GPU" are different bug reports.

## Scope

This is one person's portfolio, so some things will be declined regardless of
quality: changes to the biography, résumé or metrics; new sections; anything
that makes the room generic. Engine work, correctness, performance,
accessibility and platform coverage are all fair game.
