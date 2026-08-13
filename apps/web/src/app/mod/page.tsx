import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Button } from "@/components/ui/button";
import { configs, reports, users } from "@/db/schema";
import { isAdmin } from "@/lib/admin";
import { getDb } from "@/lib/cf";
import { getCurrentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!(await isAdmin(user))) notFound();
  return user;
}

async function setStatus(formData: FormData) {
  "use server";
  await requireAdmin();
  const id = formData.get("id");
  const status = formData.get("status");
  if (typeof id !== "string" || (status !== "published" && status !== "removed")) return;
  const db = await getDb();
  await db.update(configs).set({ status, updatedAt: Date.now() }).where(eq(configs.id, id));
  revalidatePath("/mod");
}

async function resolveReport(formData: FormData) {
  "use server";
  const admin = await requireAdmin();
  const id = formData.get("id");
  const outcome = formData.get("outcome");
  if (typeof id !== "string" || (outcome !== "resolved" && outcome !== "dismissed")) return;
  const db = await getDb();
  await db
    .update(reports)
    .set({ status: outcome, resolvedBy: admin?.id ?? null, resolvedAt: Date.now() })
    .where(eq(reports.id, id));
  revalidatePath("/mod");
}

export default async function ModPage() {
  await requireAdmin();
  const db = await getDb();

  const withheld = await db
    .select({ config: configs, ownerName: users.personaName })
    .from(configs)
    .innerJoin(users, eq(users.id, configs.ownerId))
    .where(eq(configs.status, "withheld"))
    .orderBy(desc(configs.createdAt))
    .all();

  const openReports = await db
    .select({ report: reports, configSlug: configs.slug, configName: configs.name })
    .from(reports)
    .innerJoin(configs, eq(configs.id, reports.configId))
    .where(eq(reports.status, "open"))
    .orderBy(desc(reports.createdAt))
    .all();

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-3xl">Moderation</h1>

      <section>
        <h2 className="mb-3 font-display text-xl">Withheld uploads ({withheld.length})</h2>
        {withheld.length === 0 ? (
          <p className="text-ink-faint">Queue is empty.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {withheld.map(({ config, ownerName }) => (
              <li key={config.id} className="flex flex-col gap-2 rounded-lg border border-edge bg-panel p-4">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/configs/${config.slug}`} className="font-semibold hover:text-brand">
                    {config.name}
                  </Link>
                  <span className="text-xs text-ink-faint">by {ownerName}</span>
                </div>
                <p className="text-sm text-ink-muted">{config.summary}</p>
                <div className="flex gap-2">
                  <form action={setStatus}>
                    <input type="hidden" name="id" value={config.id} />
                    <input type="hidden" name="status" value="published" />
                    <Button size="sm" type="submit">
                      Approve
                    </Button>
                  </form>
                  <form action={setStatus}>
                    <input type="hidden" name="id" value={config.id} />
                    <input type="hidden" name="status" value="removed" />
                    <Button size="sm" variant="destructive" type="submit">
                      Remove
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-xl">Open reports ({openReports.length})</h2>
        {openReports.length === 0 ? (
          <p className="text-ink-faint">No open reports.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {openReports.map(({ report, configSlug, configName }) => (
              <li key={report.id} className="flex flex-col gap-2 rounded-lg border border-edge bg-panel p-4">
                <p className="text-sm">
                  <Link href={`/configs/${configSlug}`} className="font-semibold hover:text-brand">
                    {configName}
                  </Link>{" "}
                  — <span className="text-q-strange">{report.reason}</span>
                </p>
                {report.detail && <p className="text-sm text-ink-muted">{report.detail}</p>}
                <div className="flex gap-2">
                  <form action={resolveReport}>
                    <input type="hidden" name="id" value={report.id} />
                    <input type="hidden" name="outcome" value="resolved" />
                    <Button size="sm" type="submit">
                      Resolved
                    </Button>
                  </form>
                  <form action={resolveReport}>
                    <input type="hidden" name="id" value={report.id} />
                    <input type="hidden" name="outcome" value="dismissed" />
                    <Button size="sm" variant="secondary" type="submit">
                      Dismiss
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
