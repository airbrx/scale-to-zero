# Report films: a style guide

A guide, not a rulebook. These are defaults with reasons. Break one when the
story is better for it, and say why in the storyboard.

The short version: **every film is a place, folded out of paper.** We build a
small, real-feeling world out of polygons (a river, a town, a warehouse, a
road at night), put the article's story in it, and let the camera travel
through it. Things are folded into being when they're needed and folded back
flat when they're not. Scaling to zero is the world folding itself back into
the page.

Watch the Report's own films before starting one: *Probe All You Want*
(`every-scanner/`) follows one bot down a street at night and tells the
night twice, and *GitHub Didn't Break Today* (`model-vendor/`) keeps a
clock of lost minutes as its spine. Those are the bar. This guide is how
they were made.

---

## 1. Story first: find the world

Before drawing anything, answer four questions in `storyboard.md`. They decide
more about the film than any colour or shape.

### What is the place?

An article about compute is always really about somewhere: a gorge with a
dam, a harbour with a mill, a street at night in fog, an office at 9 a.m. Pick a
place where the article's mechanism **is physically true**, so the audience
understands the system by understanding the place.

| Article | Abstract version (avoid) | A place (prefer) |
|---|---|---|
| Data centers in the Columbia Gorge | Bars of megawatts | The Gorge itself: the river, the dams, the sites on the Washington bank |
| Scanners probe every new site | Dots hitting a box | A street at night, in fog. The full-stack shop has every door a scanner hopes for; our site is a house front printed on a single sheet, its door cut into the paper. Reach through and your hand closes on fog. The CDN isn't a wall: it hands out "not here" for next to nothing, and the protection is that there's nothing behind the page to grab |
| Copilot loses its model vendor | A node turning red | A mill town on a river. Copilot's mill is turned by water from someone else's dam upstream. When they close the gate, the wheel stops. Repos and Actions run on their own stream and keep turning |
| An agent provisions five huge servers | Big rectangles | A small job, a bicycle courier's package, delivered by a convoy of lorries |

A good place makes the turn possible: the flat version is the **same place
with less in it**. A mill that takes its water from its own stream. A yard
with nothing left out.

### What does the camera follow?

The strongest moment in a film is following one thing all the way: a
single query, from a manager's desk, into the warehouse, and back. Every
film should have **one thing we follow** through the place: one query, one request, one probe, one
megawatt, one key. Specifics make it real: *9:00, Monday. A sales manager
opens the revenue dashboard.*

### What is the spine?

A device that runs through the whole film and reads the story's state at a
glance: the town clock of lost minutes in *GitHub Didn't Break Today*, a fuel gauge, a clock, a river's
level, a pile of receipts. It lives at the edge of the frame and changes
when the story does. The spine is how the audience knows where they are
without being told.

### What rhymes?

The strongest films tell the story twice: the morning as it happened, then
the same morning **rewound** with the fix in place. Same geography, same
camera path, one change. The rhyme is what makes the fix land without a
diagram.

### The article's shape still holds

The Report's articles share a shape, and the film keeps it:

1. **The cold open.** A hook, before the title: whatever pulls the viewer in
   fastest. Often that's the receipt, something real and exact (a bill, a
   clock that ran 174 minutes, 50 bots in minutes), but it can be a picture of
   the whole idea at once: ten rules folding an application down to nothing.
2. **The case.** The news story, as events in the place, with exact figures.
3. **The fair hearing.** The articles concede the other side ("the agent
   wasn't being stupid"). Show the sensible reasoning that led there. The
   architecture is the villain, never the people.
4. **The turn.** A one-line reframe. The camera, the picture and the score
   change at once, often into silence.
5. **The other side of the ledger.** The same economy read backwards.
6. **Rebuild it flat.** The rhyme: the same place, rewound, emptied.
7. **The honest caveat.** "Flat isn't zero." Show what's left, plainly.
8. **The line.** The closing sentence, held until the picture is still.

### Assume a voiceover

Every film is narrated. The picture shows what the voice can't: scale,
cause, where things are, what's connected to what. It never puts the
narrator's words on screen. A picture lands on its word (a `{cue}`, never a
clock time). After the turn or a punchline, leave two or three seconds of
picture with no new information. The film should still make sense with the
sound off.

---

## 2. The material: a folded-paper world

### Polygons make real things

We use polygons the way an origami artist uses paper: to make something you
recognise immediately, a river, a dam, a lorry, a heron, out of flat planes
and creases. **Not** abstract shapes, pillars or triangle confetti. If a
viewer can't name the object in a second, it isn't finished.

- **Low-poly, flat-shaded, lit from one side.** Every face is one flat
  colour, shaded by the angle it makes with a single light, upper left. That
  shading is what makes a shape read as solid, with no outlines and no
  gradients.
- **Creases, not outlines.** Where two faces meet, the change in shade *is*
  the edge. A fold can carry a hairline a touch lighter than the paper, the
  way a real crease catches light. Never a black stroke round the outside.
- **Paper colours.** The faces are tinted papers: the stage paper, warm
  greys, slate, stone, a river blue, and the Report's two accents. Atmosphere
  is paper too: things far away fade toward the ground colour, as if seen
  through tissue.
- **A real camera.** Build the world in 3D and look at it through a pinhole
  camera (`brand/fold.js`): terrain you can fly over,
  buildings you can circle and dive into. Flat 2D stages are fine for an
  interior or a close-up; the world itself has depth.
- **Detail where the camera goes.** A building far away is a folded box. The
  one we dive into has windows, a door and somebody at a desk.

### What makes it ours, not generic low-poly

Low-poly worlds are everywhere (games, stock illustration, AI renders). Ours
should be recognisable from a single frame, because it's **folded from the
Report itself**:

- **Newsprint.** The paper is the newspaper's paper. Large faces can carry
  the faintest trace of the day's page: column rules, a ghost of serif type,
  printed at a few percent, folded along with the face. A dam folded from
  the article about the dam.
- **Paper has thickness.** A folded edge shows a hairline of the paper's
  edge, and a lifted flap casts a soft, flat shadow on the ground sheet.
- **Folds, not facets.** Shapes are made the way paper is folded: big planes
  with a few decisive creases, mountain and valley folds, pleats for water,
  a squash fold for a roof. Not a mesh of random triangles. Fewer, bigger
  faces read as paper; many small ones read as a 3D engine.
- **Made by hand, slightly.** Folds are a hair off square, and a flap lifts a
  degree as the camera passes. Never wobbling line art, and never
  machine-perfect either.
- **The ground is the page.** Everything stands on one sheet of paper that
  runs to the edge of the frame. Things unfold up out of it and fold back
  down into it. At the end, it's often just the page again.

### Folding is the motion

The signature move: **things fold into being, and fold back flat.**

- A building doesn't fade in; it unfolds up out of the ground, wall by wall,
  roof last, the way a pop-up book opens.
- A server scaling up unfolds more of itself. Scaling to zero folds it back
  down into a flat paper shape on the ground, the crease lines still visible.
  It's asleep, not gone, and it can unfold again.
- Data arrives as folded objects; a cached answer is a sealed paper packet.
- The end of a film usually has more flat paper than the start. That empty,
  folded-down space is the point.

### Physics of the bill

The world obeys a consistent physics, and it's about **cost**, because cost
is the Report's subject.

- **Running costs heat.** Something switched on glows warm (lit windows,
  invoice-red faces, a shimmer above a roof). Idle warmth is the waste the
  Report points at.
- **Data has weight.** Popular data is heavy: it presses the ground into a
  well, and queries roll toward it the way water runs downhill. A big
  warehouse sits in a basin of its own making.
- **Queries have momentum.** They travel as objects along routes (boats on
  a river, cars on a road, paper planes across an office), bunch at a
  bottleneck, and back up into a queue you can see.
- **Repeats are waves.** The same question asked again and again builds a
  wave that grows each time it's answered fresh.
- **Dependencies are physical.** A rope, a pipe, a power line, a channel
  from someone else's dam. Coupling is a rope pulled tight; too many make a
  knot you can see.
- **Agents swarm.** Small folded birds, or bots, that multiply from one
  request into a flock. Beautiful, and slightly alarming.
- **Chaos has a visible cause.** The arc runs *simple → active → growing →
  tangled → excessive → the turn → separating → folding down → still*.

### A starter vocabulary

Not a fixed cast: a place to start, so the films feel like one world.
Every entry is a real object, folded.

| Idea | Folded object | How it moves |
|---|---|---|
| A query | A paper boat, a folded car, a paper plane, depending on the place | Travels a route; bunches at a narrowing; waits in line |
| A cached answer | A sealed paper packet on a shelf | Handed out again without anything waking up |
| A warehouse / database | A long folded hall, windows dark until it wakes | Windows light, roof heats red, meter runs |
| Data | Stacked folded blocks, heavy | Sinks into the ground; pulls queries toward it |
| An agent | A folded bird or a boxy paper bot | Flocks; multiplies; circles what it's asked about |
| A dependency | Rope, pipe, power line, a channel of water | Pulls tight; carries trouble from upstream |
| The request path | A road, a river, a corridor | Flows, narrows, jams, clears |
| The gateway | A lock gate, a toll booth, a front desk | Things pass through; some are answered on the spot |
| A server scaling up | A building unfolding more floors | Unfolds up; folds back flat when idle |
| Asleep / scaled to zero | The same shape folded flat on the ground | Still. Unfolds when work arrives |
| Cost | Heat, a meter, receipts stacking up | Rises while anything is on |
| Time | A clock face of folded facets, a sun crossing | Red facets for minutes lost, grey for minutes worked |

### Colour

The Report's palette, used as meaning:

- **Paper and ink** for anything that simply exists.
- **Invoice red** for cost, heat and damage. It's the colour of somebody's
  bill.
- **Flat-stack green** for the resolution, and usually only then.
- **Paper neutrals** (slate, stone, sand, river blue) for the world itself.

More colour is fine when the world needs it (a river, a forest, a swarm),
kept muted and papery. Red and green stay reserved for meaning.

### Light and heat

Gradients come from somewhere physical: heat, lamplight, ink on paper.
Never a smooth decorative wash (mesh gradients and soft purple-blue glows
are the surest sign a frame was generated). The house look is three
treatments in `brand/fold.js`, switched on together with
`Object.assign(LOOK, HOUSE_LOOK)` at the top of `makeStory`:

- **Heat** (`heat: 1`). A building that's running warms toward amber and
  then invoice red, and heat shimmers above its roof. It's the physics of
  the bill made visible: the burst reads as a lot running hot, and folding
  to zero reads as it cooling back to paper. Driven by a building's `lit`,
  so anything switched on heats with no extra work.
- **Glow** (`glow: 1`). Lit windows glow and throw a warm pool on the page
  in front of them. It's at its best at night (dark mode): a street that's
  lived in. By day it's a faint warmth.
- **Light** (`light: .6`). A soft ramp across each larger face, lit from
  the upper left and falling into the crease, so card reads as card.
- **Halftone, on the page** (`halftone: .8`, `halftoneOn: 'page'`). The
  ground, the shadows and whatever lies flat are printed as a 45-degree dot
  screen in warm ink, like a newspaper photo. Not on standing things: a dot
  screen dulls invoice red, and red has to stay pure where it means cost.

`brand/looks/lookbook-light.png` and `lookbook-dark.png` show the same
three frames plain, with each treatment alone, with all of them (halftone
on everything is too heavy), and in the house look. Re-render them with
`node stories/tools/lookbook.mjs` after changing a treatment.

None of this is heavy: heat is colour math, glow is a few soft gradients
per lit window, and the halftone fills flat faces a second time through a
cached dot pattern. On a phone, the film to share is the exported MP4
anyway; the live renderer is the studio.

### Type

Very little. The serif in ink, with invoice red on the word that matters, as
on the site. Place names and exact figures can appear when the narrator says
them, each sourced in the info panel (`docs/EDITORIAL.md`). Invented visuals
say *illustrative*. No handwriting face, no rounded cards with soft shadows,
no tracked mono-caps eyebrows.

### Camera

The camera is a storyteller, not a tripod.

- **Fly** across the place to establish it (a river from its mouth to the
  dam, a street from end to end).
- **Dive** into one building to follow one thing, and **pull back out** to
  show it was one of many.
- **Rewind** to replay the same moment with the fix in place.
- **Hold still** for the turn and for the last line.

Ease every move. Nothing moves linearly except a clock.

---

## 3. Sound

The sound follows the same physics as the picture.

- **Things sound like their state.** Idle infrastructure hums, and more of
  it hums thicker: a cluster you can hear as waste. Folding down is voices
  dropping out one by one until a single note is left, then silence.
- **Paper sounds.** Folds and unfolds are paper: a crisp crease, a page
  turn, a pop-up opening. That's the house's transition sound. The whoosh is
  overused.
- **The place has a sound.** A river, rain, an office's air handling, a road.
  Keep it under the voice and let it change when the story does.
- **The turn is heard as well as seen.** The score changes key or drops out
  on the reframe line.
- **Silence is a tool.** `> ♪ silence` before a pull quote does more than any
  sting.
- **Lead into changes; never drop.** A number after a score line starts
  the change that many seconds early so it lands on the word:
  `> ♪ silence 2` fades out over the two seconds before the line, reverb
  ringing, and `> ♪ tally 1.5` crossfades in early. Coming back out of
  silence, the score swells in over the section's `fade`; give that section
  a long one (2–3 s).
- **Sit under the voice.** The narrator always wins. Keep the score above
  150 Hz, where a laptop plays it, and duck it under speech.

### Tools

- **Tone.js** stays the engine. It can seek and render offline, so the
  presenter sync and the frame-perfect MP4 export keep working.
- **Strudel** is a good sketchpad for motifs, but it runs on its own clock:
  it can't seek and can't render offline. Write ideas in Strudel, then port
  them to the score.
- **For a cinematic sound:** convolution reverb with a real impulse response,
  sampled instruments (felt piano, low strings) rather than pure synths, and
  granular textures (rain, river, crowds, hum) in an AudioWorklet. If
  WebAssembly earns a place anywhere, it's there.

---

## 4. Toolkit

Canvas 2D draws all of this, and staying on canvas lets
`tools/check.mjs --stills` check frames without a browser. WebGPU isn't
needed.

- **`brand/color.js`**: colour arithmetic (`mix`, `shade`, `rgb`) on the
  palette's strings, so every colour follows the theme.
- **`LOOK`** in `brand/fold.js`: the light-and-heat treatments (above).
  `HOUSE_LOOK` is the house setting; every treatment is off until a film
  turns it on.
- **`brand/street.js`** and **`brand/hud.js`**: the shared cast and frame:
  the paper bot and its walking tracks, marks that
  sit on a wall without painting over what's in front of them, the printed
  house front with a cut door, mist; the phone feed and the receipts spine.
- **`brand/fold.js`**: the 3D half. A pinhole camera on eased keyframed
  paths (`cameraPath`), flat shading by face normal against one light,
  painter's-order sorting, distance fade to paper, and a fold animation
  (faces rotating about hinge edges) so anything can unfold out of the
  ground and fold back flat. With it come folded models the films
  share: `building` (it unfolds like a pop-up), `block`, `hills`,
  `water` (a pleated river), `wheel`, `boat`, `dam`, `pennant`,
  `belt`, `gear`, `shaft` and `lamp`, plus `newsprint` and `shadow`
  for the page. The paper bot is `bot3` in `brand/street.js`.

### Worked examples

- `how-we-make-these/`: the method as a film. The manifesto's ten rules fold
  an application down to almost nothing; one page becomes a street, a mill
  and a city; then each storytelling move, shown in that material.
- `every-scanner/`: the fullest example. A street at night in fog, one bot
  followed to every door, the phone and the receipts at the edges, the turn,
  the rewind.
- `model-vendor/`: a machine with engines it doesn't own, and a clock as
  the spine.
