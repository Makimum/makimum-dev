# Architecture

How the room is put together, and why in that order. Read
[CONTRIBUTING.md](CONTRIBUTING.md) first if you intend to change something —
several decisions below only make sense next to the rules there.

---

## The load path

There are two front doors and one content tree.

```
index.html
   └─ src/entry.ts          decides what the visitor gets, and nothing else
        ├─ src/page/        landing page  (≈18 KB: index.html + entry)
        └─ src/main.ts      the room      (+324 KB, dynamic import)
```

`entry.ts` imports `main.ts` **dynamically**. That is not a style choice:
`main.ts` pulls in three.js, and a static import would put 324 KB of renderer
into the first load of a phone that is never going to open the room.
`src/lobby.ts` owns the single rule that decides which door opens
(`roomCapable()`), so there is exactly one place where that question is
answered.

The **content tree exists once**. The same document nodes serve the room's
screens, the landing page, search engines and screen readers; which of them is
visible is decided by CSS on `data-mode` on `<html>`, not by building the
markup twice. `src/page/mount.ts` is the only file in the page branch that
needs a browser.

---

## The room

### `src/main.ts`

Scene assembly, real-time lighting, the frame loop, and the debug hooks. It is
the only file that knows about all the others.

The workstation — desk, monitor, laptop, chair, lamp, tablet, book — is one
`THREE.Group`. Rotating the whole desk 90° is one line rather than a
recalculation of seven positions. Props are authored in world coordinates in
`constants.ts` and re-parented into the desk's frame on assembly.

The frame loop does four things in a fixed order, and the order matters:
the delta is read **exactly once** (`Clock.getDelta()` zeroes itself, so a
second reader would get zero), screens flush at most once per frame and only
when something changed, the post chain renders, and the shadow map is rebuilt
only if something actually moved.

### `src/constants.ts`

Every dimension and every colour. Nothing else in the project may declare a
size or a hex value. Two objects that are "the same white" are the same white
because they read the same constant, not because someone typed the same digits
twice.

### `src/room/shell.ts` and `src/props/`

The room shell (floor, two walls, ceiling, window, skirting) and the objects.
The props were built in ascending difficulty as a deliberate feasibility
ladder — desk (boxes), radiator (parametric repetition), lamp (articulated,
splines and springs), chair (swept tube frame plus shader fabric) — because if
the lamp had not come out in reasonable time, the whole procedural approach
was wrong and better to learn that early.

`src/lib/geo.ts` holds the primitives, and one rule: **a bare `BoxGeometry` is
never used**. A perfectly sharp edge is the single most recognisable tell of a
generated object, because it catches no highlight. A 3–12 mm bevel costs two
segments and changes the read completely.

### `src/lib/materials.ts`

One factory, four surface kinds, a cache keyed by colour and kind. The point
is not draw-call savings but that "the same colour" is enforced rather than
hoped for.

Two materials are shaders rather than parameters:

- `src/lib/meshFabric.ts` — the chair's mesh. Rounded-rectangular cells, warp
  threads thicker than weft, checkerboard over/under perturbing the *normal*
  so the thread has volume, and a jittered pitch. Detail fades out by
  `fwidth` as cells shrink below a pixel, which is what allows a real
  3.5 mm cell instead of a size chosen to avoid moiré.
- `src/lib/pageBlock.ts` — the book's page edges. Three hundred sheets would
  be 7,200 triangles on an object five centimetres across; the same read costs
  one line of arithmetic keyed off local Y and the physical sheet thickness.

---

## The screens

`src/screens/` is a small operating system drawn to canvases.

| file | role |
| --- | --- |
| `panel.ts` | canvas + `CanvasTexture` + emissive wiring — shared by every screen |
| `screens.ts` | `Surface` (monitor, laptop) and `NowPlaying` (tablet); scene lookup by parent name |
| `paint.ts` | every pixel: desktop, windows, documents, gallery, deck, game frame |
| `content.ts` | all screen text and the measured `FACTS` |
| `theme.ts` | design tokens, canvas primitives, procedural icons |
| `tetris.ts` | game rules — pure, no canvas, no three.js, no storage |
| `nowPlaying.ts` | the tablet's player and its procedural cover art |

Two structural decisions:

**Hit regions come from the painter.** A click arrives as a raycast `uv`,
converts to canvas pixels, and is tested against the rectangles that the
painting function returned alongside the image. There is no separate model of
"where things are on screen", so the two cannot drift apart.

**The tablet is not a third `Surface`.** The monitor and laptop have a desktop,
an app registry, scrolling, keys and a game. The tablet has one window that
nobody touches. Sharing the class would mean a branch reading "this one does
none of the above" in every method, so only the genuinely shared part —
`Panel` — is shared.

`tetris.ts` is the one file with no browser dependency at all, which is why it
is the one file with an exhaustive headless suite. Gravity is time-based, and
`tetris.check.ts` asserts that 60 Hz and 120 Hz produce an identical board.

---

## Light

Two systems that must agree.

**Real time** (`main.ts`) is what production runs. Each source has its own
curve rather than a shared multiplier — that was the fix for a room that used
to be "a dimmer daytime" at night instead of a dark room. The window becomes
the key light after dark and turns cold; the screens take over as the warm
source; fill collapses almost to nothing; exposure rises so that what *is* lit
reads while everything else goes honestly black.

**Baked** (`src/bake/`) computes global illumination into **vertex colours**
rather than a texture lightmap, which avoids needing a second UV set for
every procedural mesh. Day and night are two `Float32Array`s per geometry and
the time of day interpolates between them. The bake is manual and takes about
a minute, so it does not run in production.

`src/sky/` is the window: solar position for Helsinki, a Preetham sky, a night
layer, procedural clouds and precipitation, and live weather from Open-Meteo
that arrives a fraction of a second after the sky is already up.

The lamp turns itself on after dusk and off after dawn, with two thresholds
rather than one so it cannot flicker at the boundary — and it stops listening
to the clock permanently the first time a visitor clicks it.

---

## Post-processing

`src/post/composer.ts`. Ground-truth ambient occlusion, bloom, a grade pass
carrying grain, dithering, halation, vignette and depth of field, then output.

The part worth knowing: **one G-buffer feeds two readers.** Depth of field
needs depth; GTAO needs depth and normals. Rather than each rendering the
scene for itself, a single half-resolution pass with a `MeshNormalMaterial`
override produces both, and `GTAOPass.setGBuffer()` switches the AO pass off
its own geometry pass. Its clear colour is `0x7777ff` because that is exactly
what GTAO clears with — it unpacks to a normal facing the camera, and anything
else would produce occlusion around the window and along the frame edge.

Together with event-driven shadow updates this took the frame from three
geometry passes plus two shadow rebuilds down to two passes and zero rebuilds,
with a measured image difference of 1 unit in 255.

---

## Verification

Four scripts, no framework, all headless:

```bash
bun run check
```

- `tsc --noEmit`
- `src/page/tree.check.ts` — landing page structure and section order
- `src/screens/tetris.check.ts` — game rules and frame-rate independence
- `src/lib/palette.check.ts` — the palette stays spread across hue and temperature

Plus in-browser instruments in `src/lib/profile.ts` (`profile`, `stress`,
`grab`, `compareFrames`) and a layout sanity check (`src/lib/sanity.ts`) that
catches objects that have wandered into a wall. That last one carries a
`sweeps` flag for the articulated lamp, whose bounding box describes the
volume it can reach rather than the object — it was reporting collisions with
things 23 cm away, and a check nobody reads is not a check.

---

## Deployment

Static build to Cloudflare Pages.

```bash
bun run build
bunx wrangler pages deploy dist --project-name=<project> --branch=main
```

Verify against the real domain, and not on the first request: Cloudflare
caches HTML and the previous bundle can be served for a few seconds after a
deploy.
