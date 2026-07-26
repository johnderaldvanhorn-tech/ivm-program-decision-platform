import { Fragment, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Printer,
  RefreshCw,
  X,
} from "lucide-react";
import { loadReportingData } from "../lib/reporting";
import {
  exportReportCsv,
  exportReportExcel,
  exportReportPdf,
  printReport,
} from "../lib/reportExport";
import { supabase } from "../lib/supabase";
import type { ReportModel } from "../lib/reporting";

const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const date = (v: any) => (v ? new Date(v).toLocaleDateString() : "—");
const avg = (a: number[]) =>
  a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
const days = (a: string, b: string) =>
  Math.max(
    1,
    Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1,
  );

type Formula = {
  title: string;
  equation: string;
  definitions: string[];
  source: string;
  section: string;
};
const formulas: Record<string, Formula[]> = {
  Location: [
    {
      title: "Temporal Access Score",
      equation: "Tᵢ = Hᵢ / 168",
      definitions: [
        "Hᵢ = accessible hours per week",
        "168 = total weekly hours",
      ],
      source: "Location access assessment",
      section: "5.1 Location Decision",
    },
    {
      title: "Machine Accessibility Score",
      equation: "Aᵢ = wₚPᵢ + wₕHᵢ + wₜTᵢ + wᵥVᵢ",
      definitions: [
        "P = public access",
        "H = physical access",
        "T = temporal access",
        "V = visibility",
        "Weights sum to 1",
      ],
      source: "Location access scores",
      section: "5.1 Location Decision",
    },
    {
      title: "Risk Score",
      equation: "Riskᵢ = wₚₒₚPᵢ* + wcrimeCᵢ* + wzoneZᵢ*",
      definitions: ["Inputs are normalized to 0–1", "Risk weights sum to 1"],
      source: "Location demographics",
      section: "5.1 Location Decision",
    },
    {
      title: "Maximum Location Score",
      equation: "MLSᵢ = Aᵢ − β Riskᵢ",
      definitions: ["β = configurable risk penalty coefficient"],
      source: "Accessibility and risk results",
      section: "5.1 Location Decision",
    },
  ],
  Inventory: [
    {
      title: "Inventory Balance",
      equation: "Iᵢ,ₜ = Iᵢ,ₜ₋₁ + Qᵢ,ₜ − Xᵢ,ₜ",
      definitions: [
        "I = ending inventory",
        "Q = replenishment",
        "X = dispensed units",
      ],
      source: "Planogram, machine logs, restocks",
      section: "5.2 Inventory Decision",
    },
    {
      title: "Demand Satisfaction",
      equation: "Xᵢ,ₜ + Uᵢ,ₜ = Dᵢ,ₜ",
      definitions: ["U = unmet demand", "D = total demand"],
      source: "Dispense and stockout events",
      section: "5.2 Inventory Decision",
    },
    {
      title: "Supplier Fill Rate",
      equation: "Fill Rateᵢ = Actual Restockedᵢ / Requestedᵢ",
      definitions: ["Result is constrained to 0–1"],
      source: "Restock history and demand assumptions",
      section: "5.2 Inventory Decision",
    },
    {
      title: "Total Inventory Cost",
      equation: "TCᵢ = Σ(cQ·Qᵢ,ₜ + cI·Iᵢ,ₜ + p·Uᵢ,ₜ)",
      definitions: [
        "cQ = replenishment cost",
        "cI = holding cost",
        "p = unmet-demand penalty",
      ],
      source: "Cost parameters and operations data",
      section: "5.2 Inventory Decision",
    },
  ],
  "Safety Stock": [
    {
      title: "Demand During Lead Time",
      equation: "DLTᵢ = d̄ᵢLᵢ",
      definitions: ["d̄ = average daily demand", "L = replenishment lead time"],
      source: "Machine logs and restocks",
      section: "5.3 Safety Stock Decision",
    },
    {
      title: "Safety Stock",
      equation: "SSᵢ = z√(Lᵢσd² + d̄ᵢ²σL²)",
      definitions: [
        "z = service factor",
        "σd = daily demand deviation",
        "σL = lead-time deviation",
      ],
      source: "Safety Stock module",
      section: "5.3 Safety Stock Decision",
    },
    {
      title: "Reorder Point",
      equation: "Rᵢ = d̄ᵢLᵢ + SSᵢ",
      definitions: ["Order is triggered when inventory ≤ Rᵢ"],
      source: "Safety Stock module",
      section: "5.3 Safety Stock Decision",
    },
    {
      title: "Recommended Order",
      equation: "Qrec = min(max(0,Sᵢ−Iᵢ), Capᵢ−Iᵢ)",
      definitions: [
        "S = base-stock level",
        "I = current inventory",
        "Cap = machine capacity",
      ],
      source: "Safety Stock module",
      section: "5.3 Safety Stock Decision",
    },
  ],
  Staffing: [
    {
      title: "Estimated Service Time",
      equation: "sᵥ = b + uᵥtᵤ + nᵥtₛ",
      definitions: [
        "b = base visit time",
        "u = units replenished",
        "n = selections serviced",
      ],
      source: "Restock events and staffing defaults",
      section: "5.4 Staffing Level Decision",
    },
    {
      title: "Technician Workload",
      equation: "Wₖ = Σ yₖ,ᵢ fᵢ(sᵢ + τₖ,ᵢ)",
      definitions: [
        "f = visit frequency",
        "s = service time",
        "τ = travel time",
      ],
      source: "Staffing and restock operations",
      section: "5.4 Staffing Level Decision",
    },
    {
      title: "Utilization",
      equation: "Utilizationₖ = Wₖ / Hₖ × 100",
      definitions: ["H = available technician hours"],
      source: "Staffing capacity summary",
      section: "5.4 Staffing Level Decision",
    },
    {
      title: "Required Technician Count",
      equation: "Tech Required = ⌈Σ fᵢ(sᵢ+τᵢ) / H⌉",
      definitions: ["Rounded up to the next whole technician resource"],
      source: "Service-capacity model",
      section: "5.4 Staffing Level Decision",
    },
  ],
  Outcomes: [
    {
      title: "Inventory Availability",
      equation: "IAᵢ = 1 − Stockout Durationᵢ / Observed Durationᵢ",
      definitions: ["Measures time inventory was available"],
      source: "Machine logs",
      section: "4.3 Outcomes and Feedback",
    },
    {
      title: "Demand Fulfillment",
      equation: "DFᵢ = Dispensedᵢ / (Dispensedᵢ + Unmet Demandᵢ)",
      definitions: ["Availability-first fulfillment measure"],
      source: "Machine logs and unmet-demand estimate",
      section: "4.3 Outcomes and Feedback",
    },
    {
      title: "Effective Availability",
      equation: "EAᵢ = Accessᵢ × Inventory Availabilityᵢ × Uptimeᵢ",
      definitions: ["Joint availability proxy"],
      source: "Location, inventory, and telemetry",
      section: "4.3 Outcomes and Feedback",
    },
  ],
};

export default function OperationsAnalyzer() {
  const [data, setData] = useState<any>(null),
    [events, setEvents] = useState<any[]>([]),
    [loading, setLoading] = useState(true);
  const [agency, setAgency] = useState(""),
    [locationId, setLocationId] = useState(""),
    [machineId, setMachineId] = useState(""),
    [product, setProduct] = useState(""),
    [startDate, setStartDate] = useState(""),
    [endDate, setEndDate] = useState("");
  const [formulaOpen, setFormulaOpen] = useState(false),
    [formulaTab, setFormulaTab] = useState("Location"),
    [expanded, setExpanded] = useState<Set<string>>(new Set());
  async function load() {
    setLoading(true);
    const d = await loadReportingData();
    setData(d);
    if (supabase) {
      let q = supabase
        .from("machine_events")
        .select(
          "machine_uuid,machine_wtn_id,event_datetime,product,quantity,event_type,action,status",
        )
        .limit(50000);
      const { data: e } = await q;
      setEvents(e ?? []);
    }
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);
  const agencies = useMemo(
    () =>
      Array.from(
        new Set(
          (data?.locations ?? []).map((l: any) => l.agency).filter(Boolean),
        ),
      ).sort() as string[],
    [data],
  );
  const locations = useMemo(
    () =>
      (data?.locations ?? []).filter(
        (l: any) => !agency || l.agency === agency,
      ),
    [data, agency],
  );
  const machines = useMemo(
    () =>
      (data?.machines ?? []).filter((m: any) => {
        const l = (data?.locations ?? []).find(
          (x: any) => x.id === m.location_id || x.machine_id === m.machine_id,
        );
        return (
          (!agency || l?.agency === agency) &&
          (!locationId || l?.id === locationId)
        );
      }),
    [data, agency, locationId],
  );
  const products = useMemo(
    () =>
      Array.from(
        new Set(
          (data?.planogram ?? [])
            .map((p: any) => p.product_name)
            .filter(Boolean),
        ),
      ).sort() as string[],
    [data],
  );
  const filtered = useMemo(() => {
    if (!data) return null;
    const locs = locations.filter(
      (l: any) => !locationId || l.id === locationId,
    );
    const mids = new Set(
      machines
        .filter((m: any) => !machineId || m.id === machineId)
        .map((m: any) => m.id),
    );
    const plans = data.planogram.filter(
      (p: any) =>
        mids.has(p.machine_uuid || p.machine_id) &&
        (!product || p.product_name === product),
    );
    const restocks = data.restockEvents.filter(
      (r: any) =>
        mids.has(r.machine_uuid || r.machine_id) &&
        (!product || r.product_name === product) &&
        (!startDate || r.restock_datetime >= startDate) &&
        (!endDate || r.restock_datetime <= `${endDate}T23:59:59`),
    );
    const ev = events.filter(
      (e: any) =>
        mids.has(e.machine_uuid) &&
        (!product || e.product === product) &&
        (!startDate || e.event_datetime >= startDate) &&
        (!endDate || e.event_datetime <= `${endDate}T23:59:59`),
    );
    return {
      locs,
      machines: machines.filter((m: any) => mids.has(m.id)),
      plans,
      restocks,
      events: ev,
    };
  }, [
    data,
    locations,
    machines,
    machineId,
    product,
    startDate,
    endDate,
    events,
    locationId,
  ]);
  const summary = useMemo(() => {
    if (!filtered) return null;
    const access = filtered.locs.map((l: any) =>
      n(l.location_access_scores?.[0]?.machine_accessibility_score),
    );
    const risk = filtered.locs.map((l: any) =>
      n(l.location_demographics?.[0]?.risk_score),
    );
    const max = filtered.locs.map((l: any) =>
      n(l.location_demographics?.[0]?.maximum_location_score),
    );
    const capacity = filtered.plans.reduce(
      (s: number, p: any) => s + n(p.max_level),
      0,
    );
    const par = filtered.plans.reduce(
      (s: number, p: any) => s + n(p.par_level),
      0,
    );
    const current = filtered.plans.reduce(
      (s: number, p: any) => s + n(p.current_quantity),
      0,
    );
    const dispensed = filtered.events
      .filter((e: any) =>
        String(e.event_type || e.action || "")
          .toLowerCase()
          .includes("dispens"),
      )
      .reduce((s: number, e: any) => s + Math.max(1, n(e.quantity)), 0);
    const stockouts = filtered.events.filter((e: any) =>
      /stock.?out/i.test(`${e.event_type} ${e.action} ${e.status}`),
    ).length;
    const visits = new Set(
      filtered.restocks.map(
        (r: any) =>
          `${r.machine_uuid}|${String(r.restock_datetime).slice(0, 16)}|${r.technician_id}`,
      ),
    ).size;
    const restocked = filtered.restocks.reduce(
      (s: number, r: any) => s + n(r.restock_quantity),
      0,
    );
    const technicians = new Set(
      filtered.restocks.map((r: any) => r.technician_id).filter(Boolean),
    ).size;
    const dates = filtered.events
      .map((e: any) => e.event_datetime)
      .filter(Boolean)
      .sort();
    const observed = dates.length ? days(dates[0], dates[dates.length - 1]) : 1;
    const daily = dispensed / observed;
    const unmet = stockouts;
    const inventoryAvailability =
      1 - stockouts / Math.max(1, filtered.events.length);
    const effective = avg(access) * Math.max(0, inventoryAvailability);
    return {
      access: avg(access),
      risk: avg(risk),
      max: avg(max),
      capacity,
      par,
      current,
      fill: capacity ? current / capacity : 0,
      dispensed,
      stockouts,
      visits,
      restocked,
      technicians,
      daily,
      unmet,
      effective,
    };
  }, [filtered]);
  const rows = useMemo(() => {
    if (!filtered || !data) return [];
    return filtered.machines.map((m: any) => {
      const l =
        data.locations.find(
          (x: any) => x.id === m.location_id || x.machine_id === m.machine_id,
        ) || {};
      const p = filtered.plans.filter(
        (x: any) => (x.machine_uuid || x.machine_id) === m.id,
      );
      const r = filtered.restocks.filter(
        (x: any) => (x.machine_uuid || x.machine_id) === m.id,
      );
      const e = filtered.events.filter((x: any) => x.machine_uuid === m.id);
      return {
        agency: l.agency || "Unassigned",
        location: l.location_name || "Unknown",
        machine: m.machine_id,
        capacity: p.reduce((s: number, x: any) => s + n(x.max_level), 0),
        par: p.reduce((s: number, x: any) => s + n(x.par_level), 0),
        current: p.reduce((s: number, x: any) => s + n(x.current_quantity), 0),
        dispensed: e
          .filter((x: any) =>
            String(x.event_type || x.action || "")
              .toLowerCase()
              .includes("dispens"),
          )
          .reduce((s: number, x: any) => s + Math.max(1, n(x.quantity)), 0),
        stockouts: e.filter((x: any) =>
          /stock.?out/i.test(`${x.event_type} ${x.action} ${x.status}`),
        ).length,
        visits: new Set(
          r.map((x: any) => String(x.restock_datetime).slice(0, 16)),
        ).size,
        restocked: r.reduce(
          (s: number, x: any) => s + n(x.restock_quantity),
          0,
        ),
        technicians: new Set(r.map((x: any) => x.technician_id).filter(Boolean))
          .size,
        first: e
          .map((x: any) => x.event_datetime)
          .filter(Boolean)
          .sort()[0],
        last: e
          .map((x: any) => x.event_datetime)
          .filter(Boolean)
          .sort()
          .at(-1),
        products: p,
      };
    });
  }, [filtered, data]);
  const report = useMemo<ReportModel>(
    () => ({
      title: "Agency Operations Analyzer",
      subtitle: `${agency || "All agencies"} · ${product || "All products"}`,
      generatedAt: new Date().toISOString(),
      kpis: summary
        ? [
            { label: "Locations", value: String(filtered?.locs.length || 0) },
            {
              label: "Machines",
              value: String(filtered?.machines.length || 0),
            },
            { label: "Accessibility", value: pct(summary.access) },
            { label: "Risk", value: pct(summary.risk) },
            { label: "Dispensed", value: summary.dispensed.toLocaleString() },
            { label: "Restock Visits", value: summary.visits.toLocaleString() },
          ]
        : [],
      sections: [
        {
          title: "Machine Operations",
          columns: [
            { key: "agency", label: "Agency" },
            { key: "location", label: "Location" },
            { key: "machine", label: "WTN" },
            { key: "capacity", label: "Capacity" },
            { key: "current", label: "Current" },
            { key: "dispensed", label: "Dispensed" },
            { key: "stockouts", label: "Stockouts" },
            { key: "visits", label: "Restock Visits" },
            { key: "technicians", label: "Technicians" },
          ],
          rows,
        },
      ],
    }),
    [agency, product, summary, filtered, rows],
  );
  function toggle(id: string) {
    setExpanded((s) => {
      const x = new Set(s);
      x.has(id) ? x.delete(id) : x.add(id);
      return x;
    });
  }
  if (loading)
    return (
      <div className="rounded-2xl border bg-white p-10 text-center text-slate-500">
        Loading operational data…
      </div>
    );
  return (
    <div className="space-y-6 print:space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Agency Operations Analyzer
          </h1>
          <p className="mt-1 text-slate-500">
            Phase 1 diagnostic view of placement, inventory availability,
            replenishment, staffing, and availability outcomes.
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button
            onClick={() => setFormulaOpen(true)}
            className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold"
          >
            <BookOpen size={16} />
            Research Formulas
          </button>
          <button onClick={load} className="rounded-xl border bg-white p-2.5">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      <div className="grid gap-3 rounded-2xl border bg-white p-4 shadow-sm md:grid-cols-5 print:hidden">
        <select
          value={agency}
          onChange={(e) => {
            setAgency(e.target.value);
            setLocationId("");
            setMachineId("");
          }}
          className="rounded-xl border px-3 py-2"
        >
          <option value="">All agencies</option>
          {agencies.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <select
          value={locationId}
          onChange={(e) => {
            setLocationId(e.target.value);
            setMachineId("");
          }}
          className="rounded-xl border px-3 py-2"
        >
          <option value="">All locations</option>
          {locations.map((l: any) => (
            <option key={l.id} value={l.id}>
              {l.location_name}
            </option>
          ))}
        </select>
        <select
          value={machineId}
          onChange={(e) => setMachineId(e.target.value)}
          className="rounded-xl border px-3 py-2"
        >
          <option value="">All machines</option>
          {machines.map((m: any) => (
            <option key={m.id} value={m.id}>
              {m.machine_id}
            </option>
          ))}
        </select>
        <select
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          className="rounded-xl border px-3 py-2"
        >
          <option value="">All products</option>
          {products.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="min-w-0 rounded-xl border px-2 py-2"
          />
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="min-w-0 rounded-xl border px-2 py-2"
          />
        </div>
      </div>
      {summary ? (
        <>
          <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
            {[
              ["Locations", filtered?.locs.length],
              ["Machines", filtered?.machines.length],
              ["Accessibility", pct(summary.access)],
              ["Risk", pct(summary.risk)],
              ["Capacity", summary.capacity.toLocaleString()],
              ["Dispensed", summary.dispensed.toLocaleString()],
              ["Restock Visits", summary.visits.toLocaleString()],
              ["Technicians", summary.technicians],
            ].map(([l, v]) => (
              <div
                key={String(l)}
                className="rounded-2xl border bg-white p-4 shadow-sm"
              >
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  {l}
                </p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{v}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-4">
            <MetricPanel
              title="Placement & Access"
              rows={[
                ["Avg accessibility", pct(summary.access)],
                ["Avg risk", pct(summary.risk)],
                ["Avg maximum score", pct(summary.max)],
              ]}
            />
            <MetricPanel
              title="Inventory Availability"
              rows={[
                [
                  "Current / capacity",
                  `${summary.current.toLocaleString()} / ${summary.capacity.toLocaleString()}`,
                ],
                ["Observed fill", pct(summary.fill)],
                ["Avg daily demand", summary.daily.toFixed(2)],
              ]}
            />
            <MetricPanel
              title="Service Capacity"
              rows={[
                ["Restocked units", summary.restocked.toLocaleString()],
                ["Restock visits", summary.visits.toLocaleString()],
                ["Anonymous technicians", summary.technicians],
              ]}
            />
            <MetricPanel
              title="Availability Outcomes"
              rows={[
                ["Effective availability proxy", pct(summary.effective)],
                ["Stockout events", summary.stockouts],
                ["Unmet-demand proxy", summary.unmet],
              ]}
            />
          </div>
        </>
      ) : null}
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b p-5">
          <div>
            <h2 className="font-bold">Agency → Location → Machine → Product</h2>
            <p className="text-sm text-slate-500">
              Expand a machine to see filtered product and selection details.
            </p>
          </div>
          <div className="flex gap-2 print:hidden">
            <button
              onClick={() => exportReportCsv(report)}
              className="rounded-lg border p-2"
            >
              <Download size={16} />
            </button>
            <button
              onClick={() => exportReportExcel(report)}
              className="rounded-lg border p-2"
            >
              <FileSpreadsheet size={16} />
            </button>
            <button
              onClick={() => exportReportPdf(report)}
              className="rounded-lg border px-3 py-2 text-sm font-semibold"
            >
              PDF
            </button>
            <button onClick={printReport} className="rounded-lg border p-2">
              <Printer size={16} />
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3">Hierarchy</th>
                <th>Capacity</th>
                <th>Current</th>
                <th>Dispensed</th>
                <th>Stockouts</th>
                <th>Restocks</th>
                <th>Technicians</th>
                <th>Activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <Fragment key={r.machine}>
                  <tr className="border-t">
                    <td className="px-5 py-3">
                      <button
                        onClick={() => toggle(r.machine)}
                        className="flex items-center gap-2 font-semibold"
                      >
                        {expanded.has(r.machine) ? (
                          <ChevronDown size={16} />
                        ) : (
                          <ChevronRight size={16} />
                        )}
                        <span>
                          {r.agency} → {r.location} → {r.machine}
                        </span>
                      </button>
                    </td>
                    <td>{r.capacity}</td>
                    <td>{r.current}</td>
                    <td>{r.dispensed}</td>
                    <td>{r.stockouts}</td>
                    <td>{r.visits}</td>
                    <td>{r.technicians}</td>
                    <td>
                      {date(r.first)} – {date(r.last)}
                    </td>
                  </tr>
                  {expanded.has(r.machine)
                    ? r.products.map((p: any) => (
                        <tr
                          key={`${r.machine}-${p.selection_number}`}
                          className="border-t bg-slate-50/70 text-xs"
                        >
                          <td className="py-2 pl-14">
                            Selection {p.selection_number} · {p.product_name}
                          </td>
                          <td>{n(p.max_level)}</td>
                          <td>{n(p.current_quantity)}</td>
                          <td colSpan={2}>
                            Critical {n(p.critical_level)} · Low{" "}
                            {n(p.low_level)} · PAR {n(p.par_level)}
                          </td>
                          <td colSpan={3}>{p.item_number || "—"}</td>
                        </tr>
                      ))
                    : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {formulaOpen ? (
        <FormulaDrawer
          tab={formulaTab}
          setTab={setFormulaTab}
          close={() => setFormulaOpen(false)}
        />
      ) : null}
    </div>
  );
}
function MetricPanel({
  title,
  rows,
}: {
  title: string;
  rows: [string, any][];
}) {
  return (
    <section className="rounded-2xl border bg-white p-5">
      <h2 className="font-bold">{title}</h2>
      <dl className="mt-4 space-y-3 text-sm">
        {rows.map(([l, v]) => (
          <div key={l} className="flex justify-between gap-4">
            <dt className="text-slate-500">{l}</dt>
            <dd className="font-semibold text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
function FormulaDrawer({
  tab,
  setTab,
  close,
}: {
  tab: string;
  setTab: (v: string) => void;
  close: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/45 print:hidden">
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b bg-white p-5">
          <div>
            <h2 className="text-xl font-bold">Research Formula Reference</h2>
            <p className="text-sm text-slate-500">
              Chapter 5 analytical models and availability-first outcomes.
            </p>
          </div>
          <button onClick={close}>
            <X />
          </button>
        </div>
        <div className="flex flex-wrap gap-2 border-b p-4">
          {Object.keys(formulas).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-3 py-1.5 text-sm font-semibold ${tab === t ? "bg-blue-600 text-white" : "bg-slate-100"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="space-y-4 p-5">
          {formulas[tab].map((f) => (
            <article key={f.title} className="rounded-2xl border p-5">
              <div className="flex items-start justify-between gap-4">
                <h3 className="font-bold">{f.title}</h3>
                <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                  {f.section}
                </span>
              </div>
              <div className="my-4 rounded-xl bg-slate-950 px-4 py-3 font-mono text-sm text-white">
                {f.equation}
              </div>
              <ul className="space-y-1 text-sm text-slate-600">
                {f.definitions.map((d) => (
                  <li key={d}>• {d}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-slate-500">
                <b>Data source:</b> {f.source}
              </p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
