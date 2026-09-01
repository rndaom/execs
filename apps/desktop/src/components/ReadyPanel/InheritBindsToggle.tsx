import { Switch } from "../ui/Switch";

/**
 * Inherit-binds lives on the ready chrome, default off, and is deliberately
 * NOT a wizard step (RND-153).
 */
export function InheritBindsToggle({
  inheritBinds,
  disabled,
  onChange,
}: {
  inheritBinds: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div data-testid="inherit-binds" className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm text-ink">Inherit binds</p>
        <p className="mt-0.5 text-xs text-ink-muted">Use this profile's binds for new profiles.</p>
      </div>
      <Switch
        checked={inheritBinds}
        disabled={disabled}
        label="Inherit binds when creating a new profile"
        onChange={onChange}
      />
    </div>
  );
}
