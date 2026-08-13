export const metadata = { title: "Install guide" };

export default function InstallGuidePage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 text-sm leading-relaxed">
      <h1 className="font-display text-3xl">Installing configs</h1>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl">One-click install (Chrome / Edge)</h2>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          <li>Hit "Install to TF2" on any config page.</li>
          <li>
            Pick your <strong>Team Fortress 2</strong> folder — usually{" "}
            <code>C:\Program Files (x86)\Steam\steamapps\common\Team Fortress 2</code>. Your
            browser will ask permission to save into it; that permission is remembered for next
            time.
          </li>
          <li>Restart TF2 (or run <code>exec autoexec</code> in the console).</li>
        </ol>
        <p className="text-ink-muted">
          Files go into <code>tf/cfg/overrides</code> (the mastercomfig-standard slot for user
          configs) and <code>tf/custom/execs-custom</code>. The{" "}
          <a href="/installed" className="text-brand underline">
            Installed
          </a>{" "}
          page lists everything execs has installed and uninstalls cleanly — files you've
          modified are never deleted without asking.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl">Manual install (any browser)</h2>
        <ol className="flex list-decimal flex-col gap-1 pl-5">
          <li>Download the zip from the config page.</li>
          <li>
            Extract it over your <strong>Team Fortress 2</strong> folder — the zip contains a{" "}
            <code>tf/</code> tree that merges into place.
          </li>
          <li>Restart TF2.</li>
        </ol>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl">Tips</h2>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            Running mastercomfig? Perfect — the overrides folder is exactly where mastercomfig
            wants your personal settings.
          </li>
          <li>
            To start fresh, uninstall from the Installed page, then in TF2:{" "}
            <code>exec config_default</code> and restart.
          </li>
          <li>
            Steam Cloud can resurrect old cfg files. If settings keep coming back, disable
            Steam Cloud for TF2 (Properties → General) before cleaning up.
          </li>
        </ul>
      </section>
    </div>
  );
}
