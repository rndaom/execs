export const metadata = { title: "Legal" };

export default function LegalPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 text-sm leading-relaxed">
      <h1 className="font-display text-3xl">Legal</h1>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl">Who we are</h2>
        <p>
          execs is a free, non-commercial fan project for the Team Fortress 2 community. It is
          not affiliated with, endorsed by, or sponsored by Valve Corporation. Team Fortress,
          Steam, and the Steam logo are trademarks and/or registered trademarks of Valve
          Corporation. Sign-in is provided through Steam; execs only ever receives your public
          SteamID — never your login credentials.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl">Content policy</h2>
        <p>
          Uploads must be Team Fortress 2 client configs and directly related material. Not
          allowed: cheats or exploits, malicious commands (every upload is automatically checked
          and hostile configs are rejected), content you didn't create without credit, and media
          unrelated to TF2. Screenshots and videos on config pages must show TF2.
        </p>
        <p>
          Configs execute console commands in your game. execs lints every upload and shows you
          exactly what a config changes before you install it — read the safety report. Installs
          only ever write to <code>tf/cfg/overrides</code> and{" "}
          <code>tf/custom/execs-custom</code>, and can be reversed from the Installed page.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-display text-xl">Takedowns</h2>
        <p>
          If a config or media item infringes your rights or violates the policy above, use the
          "Report this config" link on its page. Verified owners can request removal of their
          work; repeat infringers are banned.
        </p>
      </section>
    </div>
  );
}
