import { Icon } from './icon.tsx';

/** Shown on every screen of a simulated film. */
export function SimulatedNote() {
  return (
    <div className="alert" role="note">
      <Icon name="warning" />
      <p>
        <strong>This is a simulated video.</strong> No crew is working on it. The script is a
        sample, and the files it delivers do not exist.
      </p>
    </div>
  );
}
