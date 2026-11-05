import { SEVERITY_LABEL, SEVERITY_STYLE, severityFor, titleCase } from "@/lib/format";
import type { DepartmentExposure, ShadowApp } from "@/lib/types";

import { SeverityBadge } from "./ui/badge";
import { Button } from "./ui/button";
import { Panel } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

const KEY = [
  { severity: "critical", floor: 70 },
  { severity: "high", floor: 50 },
  { severity: "moderate", floor: 30 },
] as const;

/**
 * Departments run down, worst first, with their full names; tools run across.
 * Each filled cell is that pair's exposure, and a blank cell means no use.
 */
export function DepartmentHeatmap({
  apps,
  departments,
  onOpen,
}: {
  apps: ShadowApp[];
  departments: DepartmentExposure[];
  onOpen: (app: ShadowApp) => void;
}) {
  const rows = [...departments].sort((a, b) => b.max_score - a.max_score || a.name.localeCompare(b.name));
  const columns = [...apps].sort((a, b) => b.max_score - a.max_score || a.name.localeCompare(b.name));

  return (
    <Panel
      title="Department heatmap"
      note="Exposure of each department to each tool, last 7 days. Blank means no use; struck through means mitigated."
      action={
        <ul className="flex flex-wrap items-center gap-3 text-xs text-ink2" aria-label="Score bands">
          {KEY.map(({ severity, floor }) => (
            <li key={severity} className="flex items-center gap-1.5">
              <span className={`h-3 w-3 rounded-sm ${SEVERITY_STYLE[severity].cell}`} aria-hidden />
              {SEVERITY_LABEL[severity]} <span className="font-mono">{floor}+</span>
            </li>
          ))}
        </ul>
      }
    >
      {/* relative: keeps the table's screen-reader text inside this scroller, not the page's. */}
      <div className="relative -mx-5 -mb-5 overflow-x-auto px-5 pb-5">
        <Table className="min-w-[980px] table-fixed">
          <caption className="sr-only">Exposure score for each department and tool. Higher is worse.</caption>
          <colgroup>
            <col className="w-64" />
            <col className="w-28" />
          </colgroup>
          <TableHeader>
            <TableRow ruled={false}>
              <TableHead padded={false} className="sticky left-0 bg-surface pb-2 pr-2 align-bottom">
                Department
              </TableHead>
              <TableHead padded={false} className="pb-2 pr-2 align-bottom">
                Worst
              </TableHead>
              {columns.map((app) => (
                <TableHead key={app.id} padded={false} scope="col" className="px-0.5 pb-2 text-center align-bottom">
                  <Button variant="bare" onClick={() => onOpen(app)} className="text-ink2 hover:text-ink hover:underline">
                    {app.name}
                  </Button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((d) => (
              <TableRow key={d.name} ruled={false}>
                <TableCell padded={false} className="sticky left-0 bg-surface py-1 pr-2">
                  <span className="block truncate font-medium text-ink" title={d.name}>
                    {d.name}
                  </span>
                  <span className="block text-xs text-muted">
                    {titleCase(d.data_class)}, weighted <span className="font-mono">×{d.sensitivity.toFixed(2)}</span>
                  </span>
                </TableCell>
                <TableCell padded={false} className="py-1 pr-2">
                  {d.max_score > 0 && <SeverityBadge severity={severityFor(d.max_score)} score={d.max_score} />}
                </TableCell>
                {columns.map((app) => {
                  const pair = app.departments.find((p) => p.department === d.name);
                  if (!pair) {
                    return (
                      <TableCell key={app.id} padded={false} className="p-px">
                        <span className="sr-only">No use</span>
                      </TableCell>
                    );
                  }
                  const severity = severityFor(pair.score);
                  const closed = pair.status !== "open";
                  return (
                    <TableCell key={app.id} padded={false} className="p-px">
                      <Button
                        variant="bare"
                        onClick={() => onOpen(app)}
                        aria-label={`${app.name} in ${d.name}: exposure ${pair.score}, ${SEVERITY_LABEL[severity]}, ${pair.users} users${closed ? `, ${pair.status}` : ""}`}
                        className={`flex h-11 w-full items-center justify-center rounded font-mono text-sm font-medium transition-opacity hover:opacity-80 ${
                          closed ? "text-muted line-through" : SEVERITY_STYLE[severity].cell
                        }`}
                      >
                        {pair.score}
                      </Button>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
