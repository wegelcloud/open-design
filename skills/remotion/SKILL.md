---
name: remotion
description: Create video compositions with Remotion (React components rendered to MP4). Use when asked to build any React-based video — animated title cards, kinetic typography, data dashboards, product walkthroughs, code reveals, marketing reels — or when the user explicitly picks "Remotion" as the engine. Covers project scaffolding, composition authoring, frame-by-frame timing via `useCurrentFrame()`, and the experimental HTML-in-Canvas capture path for compositions that need CSS the default DOM composer can't capture (mix-blend + filter stacks, position:sticky inside clipped scrollers).
triggers:
  - "remotion"
  - "react video"
  - "html-in-canvas"
  - "video composition react"
od:
  mode: video
  surface: video
  scenario: video
  preview:
    type: html
  design_system:
    requires: false
  example_prompt: |
    A 6-second product reveal in Remotion: minimal cream backdrop, the
    product slides up from below with a subtle bloom, headline
    kinetic-types in 4 staggered lines, end-card with brand mark.
---

# Remotion (React → MP4)

Remotion is a React-based renderer: you author your video as a normal
React component tree, drive timing with `useCurrentFrame()`, and `npx
remotion render` captures the result frame-by-frame to MP4 via headless
Chromium. It's the React-shaped sibling of HyperFrames — pick whichever
matches the user's preferred authoring surface.

## When to pick Remotion (vs. HyperFrames vs. a t2v model)

- **Remotion** — long-form (>15s) compositions, anything with rich data
  (charts, dashboards, code reveals), product lifecycle/marketing
  storytelling, anything that benefits from React's component reuse and
  prop-driven variants. Scales well past 1000 frames.
- **HyperFrames** — when the user wants a single HTML file with a GSAP
  timeline, or when a composition is closer to "animated landing page"
  than "video."
- **Photoreal t2v (Seedance, Veo, Sora, Grok Imagine, Kling)** — when the
  user wants real-world footage / cinematic shots, not motion graphics.

When in doubt and the project metadata pre-selected `remotion-html` or
`remotion-html-in-canvas`, use Remotion.

### `remotion-html` vs. `remotion-html-in-canvas`

The default model is **`remotion-html`**. Pick **`remotion-html-in-canvas`**
only when the composition uses CSS that the default DOM composer cannot
capture cleanly:

- mix-blend-mode + filter() stacks layered on top of each other
- backdrop-filter blur with elements crossing the boundary
- position: sticky inside a clipped scroller
- 3D transforms with perspective + complex children
- the user explicitly asked for HTML-in-canvas

The `-in-canvas` variant requires Chromium's experimental
`drawElementImage` API. Early-2026 release Chrome has partial support;
Chrome Canary has full. The renderer prints a clear warning and falls
back to software rasterisation if the API is unavailable, so if the user
is on regular Chrome the composition still renders — colours may differ
from the editor preview.

## Open Design integration (load-bearing for this surface)

When this skill runs inside Open Design (i.e. `$OD_PROJECT_DIR` is set),
the output flow is fixed: only the rendered `.mp4` should land in the
project root. Composition source files (the Remotion project) belong
inside `.remotion-cache/<id>/` so they don't clutter the user's
FileViewer or the chat's "produced files" chips.

**Render workflow inside OD — fast path:**

```bash
# 1. Pick a hidden cache slot. Dotfile prefix → OD's project file
#    listing skips it, so the React project never clutters the chat.
COMP_REL=".remotion-cache/$(date +%s)-$(openssl rand -hex 2)"
COMP="$OD_PROJECT_DIR/$COMP_REL"
mkdir -p "$COMP/src"

# 2. Author the four files: package.json, src/index.ts, src/Root.tsx,
#    and the composition component (e.g. src/MyComp.tsx).
#    See "Canonical scaffold" below for the exact contents to write.

# 3. Dispatch through the OD daemon. Do NOT run `npx remotion render`
#    from this shell — many agent CLIs (Claude Code in particular) wrap
#    Bash in macOS sandbox-exec, under which puppeteer's Chrome
#    subprocess hangs partway through frame capture. The daemon
#    process is unsandboxed and renders reliably.
out=$(node "$OD_BIN" media generate \
  --project "$OD_PROJECT_ID" \
  --surface video \
  --model remotion-html \
  --output "<descriptive-name>.mp4" \
  --composition-dir "$COMP_REL" \
  --composition-id "MyComp")
ec=$?
task_id=$(printf '%s\n' "$out" | tail -1 | jq -r '.taskId // empty')
since=$(printf '%s\n' "$out" | tail -1 | jq -r '.nextSince // 0')
while [ "$ec" -eq 2 ] && [ -n "$task_id" ]; do
  out=$(node "$OD_BIN" media wait "$task_id" --since "$since")
  ec=$?
  since=$(printf '%s\n' "$out" | tail -1 | jq -r '.nextSince // '"$since")
done
[ "$ec" -ne 0 ] && { echo "$out" >&2; exit "$ec"; }
```

`--composition-id` MUST match the id in your `<Composition id="…" />`
registration. The dispatcher rejects mismatches with a clear error
instead of producing a 0-byte mp4.

For the html-in-canvas variant, swap `--model remotion-html` for
`--model remotion-html-in-canvas`. Everything else is identical.

## Canonical scaffold (write these four files, edit only what changes)

`package.json`:
```json
{
  "name": "od-remotion-comp",
  "version": "1.0.0",
  "private": true,
  "scripts": { "render": "remotion render" },
  "dependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "remotion": "^4.0.0",
    "@remotion/cli": "^4.0.0"
  }
}
```

`src/index.ts`:
```ts
import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';
registerRoot(RemotionRoot);
```

`src/Root.tsx`:
```tsx
import { Composition } from 'remotion';
import { MyComp } from './MyComp';

export const RemotionRoot = () => (
  <Composition
    id="MyComp"
    component={MyComp}
    durationInFrames={180}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={{ headline: 'Hello, video.' }}
  />
);
```

`src/MyComp.tsx`:
```tsx
import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from 'remotion';

type Props = { headline: string };

export const MyComp: React.FC<Props> = ({ headline }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = spring({ frame, fps, config: { damping: 200 } });
  const y = interpolate(frame, [0, 30], [40, 0], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: '#0e1116', color: '#f5f7fa', display: 'grid', placeItems: 'center' }}>
      <h1 style={{ fontFamily: 'Inter', fontSize: 120, opacity, transform: `translateY(${y}px)` }}>
        {headline}
      </h1>
    </AbsoluteFill>
  );
};
```

Edit only the parts that the user's prompt actually changes. Most
requests want a different headline, palette, layout, or a stack of
2–4 component clips played in sequence (use `<Sequence from={…}
durationInFrames={…}>`).

## Timing primitives

- `useCurrentFrame()` — current frame index (0-based).
- `useVideoConfig()` — `{ fps, width, height, durationInFrames }`.
- `interpolate(frame, [a, b], [v1, v2], { extrapolateRight: 'clamp' })` —
  the bread-and-butter ease. Default ease is linear; pass `easing:
  Easing.out(Easing.ease)` for soft tails.
- `spring({ frame, fps, config: { damping, stiffness, mass } })` —
  physics-based. `damping: 200` reads as "soft snap"; `damping: 8` as
  "loose bouncy".
- `<Sequence from={frames} durationInFrames={…}>` — mount a child only
  during a window. Inside, `useCurrentFrame()` rebases to 0 at `from`.
- `<Series>` / `<Series.Sequence>` — play children back-to-back without
  hand-counting frame offsets.
- `<Audio src={…} startFrom={…} endAt={…}>` — synced audio track.
- `<Video src={…}>` and `<OffthreadVideo src={…}>` for embedded clips
  (offthread is the safe default for non-trivial videos — it decodes on
  a worker thread so the main render loop doesn't stall).

## Patterns that show up often in OD work

- **Product reveal / brand sizzle** — three sequenced beats: hook
  headline (0–60f), product hero with bloom + slide-in (60–150f),
  CTA + logo outro (150–180f). Each beat is its own component.
- **Data reveal / dashboard** — animate numbers with `interpolate(frame,
  [a, b], [from, to])` and `Math.round()`; stagger row reveals via
  `<Sequence>`. For chart bars, animate `width` or `transform: scaleX`
  with `transformOrigin: 'left'`.
- **Code reveal** — render `<pre>` with `code.split('\n').slice(0,
  Math.floor(frame / 4))` joined with newlines. Pair with a blinking
  caret (`opacity: frame % 30 < 15 ? 1 : 0`).
- **Lifecycle saga** (problem → solution → growth → outro) — one
  parent composition with four `<Series.Sequence>` children, each
  durationInFrames ≈ 5–8s × fps.

## HTML-in-Canvas tips (only when using `remotion-html-in-canvas`)

- The renderer prints a single `Using Chromium experimental HTML-in-
  canvas` warning per frame. That's expected, not an error.
- Pixel output may differ from the regular DOM composer — preview in
  the Remotion Studio under the "Other" → "Allow HTML-in-canvas" toggle
  before relying on the render.
- `position: fixed` and viewport-anchored CSS work the same as
  standard rendering; the new path mostly fixes layered blend / filter
  composites and sticky inside clipped containers.

## What you DO NOT do inside OD

- Do not run `npx remotion render` from your own shell — Chrome hangs
  under the agent sandbox. Always go through the daemon dispatcher.
- Do not run `npx remotion preview` / `studio` from the agent shell
  for the same reason. If the user wants to iterate visually, point
  them at the rendered MP4 and offer to re-render with edits.
- Do not write source files outside `.remotion-cache/<id>/`. The
  project-root listing is the user's chat-visible file area; render
  artefacts and tooling state belong inside the dotfile cache.
- Do not edit a previous render's source then call `--composition-dir`
  on it — pick a fresh slot per render so the chat history maps 1:1
  to source projects on disk.
