import { interpolate } from 'remotion';
import { z } from 'zod';
import { BrowserFrame } from '../components/browser-frame.tsx';
import { alongPath, ClickRing, Cursor, cursorPath } from '../components/cursor.tsx';
import { cornerMark, SceneBase, SceneMark } from '../components/scene-base.tsx';
import { type SceneProps, useScene } from '../components/scene-runtime.tsx';
import { type StackItem, TextStack } from '../components/text.tsx';
import {
  imageToViewport,
  lerpPose,
  type Point,
  type Pose,
  poseAt,
  WHOLE_IMAGE,
} from '../core/camera.ts';
import { presence, springAt } from '../core/presence.ts';
import { bezier, framesFor, lerp } from '../core/time.ts';
import { chromeHeight, interfaceLayout } from '../layout/scenes.ts';
import { beat, camera, duration, easing, travel } from '../tokens.ts';
import { defineScene } from './definition.ts';

const fraction = z.number().min(0).max(1);

const propsSchema = z.strictObject({
  /** The point of the image the cursor clicks and the camera moves to, as fractions of it. */
  focus: z.strictObject({ x: fraction, y: fraction }).optional(),
  zoom: z.number().min(1).max(3).optional(),
});

export type InterfaceRevealProps = z.infer<typeof propsSchema>;

const DEFAULT_FOCUS: Point = { x: 0.5, y: 0.45 };
/** Where the cursor comes from, as fractions of the viewport. */
const CURSOR_START: Point = { x: 0.92, y: 0.94 };

/** The frames the scene's story turns on: the cursor comes in, clicks, and the camera answers. */
export const interfaceBeats = (durationInFrames: number) => ({
  cursorIn: Math.round(durationInFrames * beat.cursorIn),
  click: Math.round(durationInFrames * beat.cursorArrives),
  settled: Math.round(durationInFrames * beat.cameraSettled),
});

export function interfacePose(
  frame: number,
  durationInFrames: number,
  { focus = DEFAULT_FOCUS, zoom = camera.defaultZoom }: InterfaceRevealProps,
): Pose {
  const { click, settled } = interfaceBeats(durationInFrames);
  const t = interpolate(frame, [click, Math.max(click + 1, settled)], [0, 1], {
    easing: bezier(easing.expressive),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return lerpPose(WHOLE_IMAGE, poseAt(focus, zoom), t);
}

const InterfaceReveal = ({ scene, props }: SceneProps<InterfaceRevealProps>) => {
  const runtime = useScene();
  const { frame, fps, durationInFrames, stage, timing, image } = runtime;
  const { carriedIn, overlayHides } = runtime;
  if (!image)
    throw new Error(`Scene "${scene.id}" has no image. validateFilm should have said so.`);

  const { text, media } = interfaceLayout(stage, image.aspect);
  const beats = interfaceBeats(durationInFrames);
  const pose = interfacePose(frame, durationInFrames, props);
  const focus = props.focus ?? DEFAULT_FOCUS;

  const arrived = carriedIn === 'image';
  const opened = arrived ? 1 : springAt(frame, fps, timing.container.enterAt);
  const { exit } = presence(frame, timing.container);
  const fade = arrived ? 1 : presence(frame, timing.container).enter;

  const chrome = chromeHeight(media.width);
  const toFrameSpace = ({ x, y }: Point): Point => ({
    x: x * media.width,
    y: chrome + y * (media.height - chrome),
  });
  const start = toFrameSpace(CURSOR_START);
  const target = toFrameSpace(imageToViewport(WHOLE_IMAGE, focus));
  const path = cursorPath(start, target);
  const travelled = interpolate(frame, [beats.cursorIn, beats.click], [0, 1], {
    easing: bezier(easing.standard),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // Once clicked, the cursor stays on its point while the camera moves under it.
  const cursorAt =
    frame < beats.click ? alongPath(path, travelled) : toFrameSpace(imageToViewport(pose, focus));
  const cursorOpacity =
    interpolate(frame, [beats.cursorIn - 1, beats.cursorIn + 6], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }) *
    (1 - presence(frame, timing.text).exit);
  const pressed = interpolate(frame, [beats.click - 3, beats.click, beats.click + 4], [0, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const ring = interpolate(
    frame,
    [beats.click, beats.click + framesFor(duration.moderate, fps)],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const cursorSize = stage.unit * 5;

  return (
    <SceneBase seed={scene.id}>
      <SceneMark placement={cornerMark(stage)} />
      <TextStack
        items={scene.text as StackItem[]}
        rect={text}
        align="left"
        justify={stage.orientation === 'landscape' ? 'center' : 'flex-end'}
      />
      {overlayHides('image') ? null : (
        <BrowserFrame
          rect={media}
          src={image.src}
          pose={pose}
          style={{
            opacity: fade * (1 - exit),
            // 2D only. Chrome picks the raster scale of a 3D-transformed layer from the frames
            // before it, so a tilt would make a frame depend on what was rendered first.
            transform: `translateY(${(1 - opened) * travel.container * stage.unit}px) scale(${lerp(
              camera.startScale,
              1,
              opened,
            )})`,
          }}
          overlay={
            <>
              <ClickRing at={cursorAt} size={cursorSize * 2} progress={ring} />
              <Cursor at={cursorAt} size={cursorSize} pressed={pressed} opacity={cursorOpacity} />
            </>
          }
        />
      )}
    </SceneBase>
  );
};

export const interfaceReveal = defineScene<InterfaceRevealProps>({
  component: InterfaceReveal,
  props: propsSchema,
  text: { headline: 48, subhead: 100, body: 120, label: 40 },
  roles: {
    headline: { min: 1, max: 1 },
    subhead: { min: 0, max: 1 },
    body: { min: 0, max: 1 },
    label: { min: 0, max: 1 },
  },
  image: 'required',
  imageAnchor: ({ stage, imageAspect, durationInFrames, props, frame }) => ({
    rect: interfaceLayout(stage, imageAspect).media,
    pose: interfacePose(frame, durationInFrames, props),
  }),
  markAnchor: (stage) => cornerMark(stage),
});
