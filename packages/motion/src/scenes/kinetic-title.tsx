import { z } from 'zod';
import { cornerMark, SceneBase, SceneMark } from '../components/scene-base.tsx';
import { type SceneProps, useScene } from '../components/scene-runtime.tsx';
import { type StackItem, TextStack } from '../components/text.tsx';
import { titleLayout } from '../layout/scenes.ts';
import { defineScene } from './definition.ts';

const propsSchema = z.strictObject({
  align: z.enum(['left', 'center']).optional(),
});

export type KineticTitleProps = z.infer<typeof propsSchema>;

const KineticTitle = ({ scene, props }: SceneProps<KineticTitleProps>) => {
  const { stage } = useScene();
  const { text } = titleLayout(stage);
  return (
    <SceneBase seed={scene.id}>
      <SceneMark placement={cornerMark(stage)} />
      <TextStack
        items={scene.text as StackItem[]}
        rect={text}
        align={props.align ?? 'left'}
        kinetic
      />
    </SceneBase>
  );
};

export const kineticTitle = defineScene<KineticTitleProps>({
  component: KineticTitle,
  props: propsSchema,
  text: { headline: 60, subhead: 100, label: 40 },
  roles: {
    headline: { min: 1, max: 1 },
    subhead: { min: 0, max: 1 },
    label: { min: 0, max: 1 },
  },
  image: 'none',
  markAnchor: (stage) => cornerMark(stage),
});
