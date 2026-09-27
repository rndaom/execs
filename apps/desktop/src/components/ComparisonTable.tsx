import { compareSections, type ProfileComparison } from "../lib/switch-compare-ui";

/** The differences between two setups, one titled table per area. */
export function ComparisonTable({
  comparison,
  testIdPrefix,
  sameText,
}: {
  comparison: ProfileComparison;
  testIdPrefix: string;
  sameText: string;
}) {
  const sections = compareSections(comparison);
  if (sections.length === 0)
    return (
      <p className="t-body mt-4 text-ink-muted" data-testid={`${testIdPrefix}-same`}>
        {sameText}
      </p>
    );
  return (
    <>
      {sections.map((section) => (
        <section key={section.id} className="mt-5" data-testid={`${testIdPrefix}-${section.id}`}>
          <h3 className="eyebrow mb-2">{section.title}</h3>
          <table className="t-meta w-full table-fixed border-collapse">
            <thead className="sr-only">
              <tr>
                <th>Item</th>
                <th>{comparison.fromName}</th>
                <th>{comparison.toName}</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map((row) => (
                <tr key={`${row.label}:${row.from}:${row.to}`} className="border-t border-edge">
                  <td className="w-2/5 py-1.5 pr-3 align-top break-words text-ink">{row.label}</td>
                  <td className="py-1.5 pr-3 align-top break-words">{row.from}</td>
                  <td className="py-1.5 align-top break-words text-ink">{row.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {section.note ? <p className="t-meta mt-1">{section.note}</p> : null}
        </section>
      ))}
    </>
  );
}
