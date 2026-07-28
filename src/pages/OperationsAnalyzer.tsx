import { Fragment, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Printer,
  RefreshCw,
  Search,
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
const relatedRecord = <T,>(value: T[] | T | null | undefined): T | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
const scoreValue = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : null;
};
const avgScored = (values: Array<number | null>) => {
  const scored = values.filter((value): value is number => value !== null);
  return avg(scored);
};

const normalizeProduct = (value: string | null | undefined) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const productFamily = (value: string | null | undefined) => {
  const normalized = normalizeProduct(value);
  if (normalized.includes("narcan") || normalized.includes("naloxone")) {
    return "naloxone";
  }
  return normalized;
};

const normalizeSelection = (value: string | number | null | undefined) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, "");

const parseSelectionRange = (value: string | number | null | undefined) => {
  const normalized = normalizeSelection(value);
  if (!normalized) return null;
  const match = normalized.match(/^(\d+)(?:[-–—](\d+))?$/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);
  return { start: Math.min(start, end), end: Math.max(start, end) };
};

const planogramSelectionContains = (
  planogramSelection: string | number | null | undefined,
  eventSelection: string | number | null | undefined,
) => {
  const planogramRange = parseSelectionRange(planogramSelection);
  const eventRange = parseSelectionRange(eventSelection);
  if (!planogramRange || !eventRange) return false;
  return (
    eventRange.start >= planogramRange.start &&
    eventRange.start <= planogramRange.end
  );
};

const machineKey = (value: unknown) => String(value ?? "").trim().toLowerCase();

const machineSummaryFor = (data: any, machine: any) =>
  (data?.machineSummary ?? []).find((row: any) =>
    row.machine_uuid === machine.id ||
    row.machine_id === machine.id ||
    row.machine_wtn_id === machine.machine_id ||
    row.source_name === machine.machine_id,
  );

const summaryDispensed = (row: any) =>
  n(row?.units_dispensed ?? row?.dispensed);

const summaryStockouts = (row: any) =>
  n(row?.stockout_count ?? row?.stockouts);

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
    [selectedProducts, setSelectedProducts] = useState<string[]>([]),
    [productMenuOpen, setProductMenuOpen] = useState(false),
    [productSearch, setProductSearch] = useState(""),
    [startDate, setStartDate] = useState(""),
    [endDate, setEndDate] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({
    agency: "",
    locationId: "",
    machineId: "",
    selectedProducts: [] as string[],
    startDate: "",
    endDate: "",
  });
  const [hasReviewed, setHasReviewed] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [formulaOpen, setFormulaOpen] = useState(false),
    [formulaTab, setFormulaTab] = useState("Location"),
    [expanded, setExpanded] = useState<Set<string>>(new Set());
  async function load() {
    setLoading(true);
    const d = await loadReportingData();
    setData(d);
    setEvents([]);
    setHasReviewed(false);
    setLoading(false);
  }

  async function reviewSelection() {
    if (!data) return;
    setReviewing(true);

    const nextFilters = {
      agency,
      locationId,
      machineId,
      selectedProducts: [...selectedProducts],
      startDate,
      endDate,
    };

    if (supabase) {
      const selectedLocations = (data.locations ?? []).filter((l: any) =>
        (!agency || l.agency === agency) && (!locationId || l.id === locationId),
      );
      const selectedLocationIds = new Set(selectedLocations.map((l: any) => l.id));
      const selectedMachines = (data.machines ?? []).filter((m: any) =>
        (!machineId || m.id === machineId) &&
        (!agency && !locationId || selectedLocationIds.has(m.location_id)),
      );
      const machineUuids = selectedMachines.map((m: any) => m.id).filter(Boolean);

      let query = supabase
        .from("machine_events")
        .select(
          "machine_uuid,machine_wtn_id,event_datetime,product,quantity,event_type,action,status,message,error_type,selection",
        );

      if (machineUuids.length) query = query.in("machine_uuid", machineUuids);
      if (startDate) query = query.gte("event_datetime", startDate);
      if (endDate) query = query.lte("event_datetime", `${endDate}T23:59:59`);

      const { data: eventRows, error } = await query.limit(50000);
      if (error) console.warn("Operations Analyzer event query failed:", error.message);
      setEvents(eventRows ?? []);
    }

    setAppliedFilters(nextFilters);
    setHasReviewed(true);
    setReviewing(false);
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
  const visibleProducts = useMemo(() => {
    const query = productSearch.trim().toLowerCase();
    if (!query) return products;
    return products.filter((productName) =>
      productName.toLowerCase().includes(query),
    );
  }, [products, productSearch]);
  const appliedLocations = useMemo(
    () =>
      (data?.locations ?? []).filter(
        (l: any) =>
          (!appliedFilters.agency || l.agency === appliedFilters.agency) &&
          (!appliedFilters.locationId || l.id === appliedFilters.locationId),
      ),
    [data, appliedFilters.agency, appliedFilters.locationId],
  );
  const appliedMachines = useMemo(() => {
    const locationIds = new Set(appliedLocations.map((l: any) => l.id));
    return (data?.machines ?? []).filter(
      (m: any) =>
        (!appliedFilters.machineId || m.id === appliedFilters.machineId) &&
        (!appliedFilters.agency && !appliedFilters.locationId ||
          locationIds.has(m.location_id)),
    );
  }, [data, appliedLocations, appliedFilters.agency, appliedFilters.locationId, appliedFilters.machineId]);

  const filtered = useMemo(() => {
    if (!data || !hasReviewed) return null;

    const locs = appliedLocations;
    const selected = new Set(appliedFilters.selectedProducts);
    const selectedFamilies = new Set(
      appliedFilters.selectedProducts.map(productFamily).filter(Boolean),
    );

    const selectedMachineKeys = new Set(
      appliedMachines
        .flatMap((machine: any) => [machine.id, machine.machine_id, machine.machine_uuid, machine.machine_wtn_id])
        .map(machineKey)
        .filter(Boolean),
    );

    const belongsToSelectedMachine = (row: any) =>
      [row.machine_uuid, row.machine_id, row.machine_wtn_id]
        .map(machineKey)
        .some((key) => key && selectedMachineKeys.has(key));

    const allPlans = (data.planogram ?? []).filter(belongsToSelectedMachine);
    const plans = selected.size === 0
      ? allPlans
      : allPlans.filter((plan: any) => {
          const exactProduct = String(plan.product_name || "").trim();
          return (
            selected.has(exactProduct) ||
            selectedFamilies.has(productFamily(exactProduct))
          );
        });

    const plansByMachine = new Map<string, any[]>();
    for (const plan of allPlans) {
      for (const key of [plan.machine_uuid, plan.machine_id, plan.machine_wtn_id]
        .map(machineKey)
        .filter(Boolean)) {
        const current = plansByMachine.get(key) ?? [];
        current.push(plan);
        plansByMachine.set(key, current);
      }
    }

    const matchingPlansByMachine = new Map<string, any[]>();
    for (const plan of plans) {
      for (const key of [plan.machine_uuid, plan.machine_id, plan.machine_wtn_id]
        .map(machineKey)
        .filter(Boolean)) {
        const current = matchingPlansByMachine.get(key) ?? [];
        current.push(plan);
        matchingPlansByMachine.set(key, current);
      }
    }

    const productMatches = (row: any) => {
      if (selected.size === 0) return true;

      const rowKeys = [row.machine_uuid, row.machine_id, row.machine_wtn_id]
        .map(machineKey)
        .filter(Boolean);
      const machinePlans = rowKeys.flatMap((key) => plansByMachine.get(key) ?? []);
      const matchingMachinePlans = rowKeys.flatMap(
        (key) => matchingPlansByMachine.get(key) ?? [],
      );

      const uniqueMachinePlans = Array.from(
        new Map(machinePlans.map((plan: any) => [String(plan.id ?? `${plan.selection_number}|${plan.product_name}`), plan])).values(),
      );
      const uniqueMatchingPlans = Array.from(
        new Map(matchingMachinePlans.map((plan: any) => [String(plan.id ?? `${plan.selection_number}|${plan.product_name}`), plan])).values(),
      );

      if (uniqueMachinePlans.length > 0 && uniqueMatchingPlans.length === uniqueMachinePlans.length) {
        return true;
      }

      const selection = row.selection ?? row.selection_number;
      if (normalizeSelection(selection)) {
        return uniqueMatchingPlans.some((plan: any) =>
          planogramSelectionContains(plan.selection_number, selection),
        );
      }

      const exactProduct = String(row.product_name ?? row.product ?? "").trim();
      return (
        selected.has(exactProduct) ||
        selectedFamilies.has(productFamily(exactProduct))
      );
    };

    const restocks = (data.restockEvents ?? []).filter(
      (row: any) =>
        belongsToSelectedMachine(row) &&
        productMatches(row) &&
        (!appliedFilters.startDate || row.restock_datetime >= appliedFilters.startDate) &&
        (!appliedFilters.endDate || row.restock_datetime <= `${appliedFilters.endDate}T23:59:59`),
    );

    const filteredEvents = events.filter(
      (row: any) =>
        belongsToSelectedMachine(row) &&
        productMatches(row) &&
        (!appliedFilters.startDate || row.event_datetime >= appliedFilters.startDate) &&
        (!appliedFilters.endDate || row.event_datetime <= `${appliedFilters.endDate}T23:59:59`),
    );

    return {
      locs,
      machines: appliedMachines,
      plans,
      restocks,
      events: filteredEvents,
    };
  }, [
    data,
    hasReviewed,
    appliedLocations,
    appliedMachines,
    appliedFilters,
    events,
  ]);
  const summary = useMemo(() => {
    if (!filtered) return null;
    // Supabase may return embedded one-to-one relations as either an object
    // or a single-item array. Use the same score extraction rules as Locations.
    const access = filtered.locs.map((l: any) =>
      scoreValue(
        relatedRecord<any>(l.location_access_scores)?.machine_accessibility_score,
      ),
    );
    const risk = filtered.locs.map((l: any) =>
      scoreValue(relatedRecord<any>(l.location_demographics)?.risk_score),
    );
    const max = filtered.locs.map((l: any) =>
      scoreValue(
        relatedRecord<any>(l.location_demographics)?.maximum_location_score,
      ),
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
    const rawDispensed = filtered.events
      .filter((e: any) =>
        String(e.event_type || e.action || "")
          .toLowerCase()
          .includes("dispens") ||
        (String(e.action || "").toLowerCase() === "transactions" &&
          String(e.status || "").toLowerCase() === "success"),
      )
      .reduce((s: number, e: any) => s + Math.max(1, n(e.quantity)), 0);
    const machineLogDispensed = filtered.machines.reduce(
      (total: number, machine: any) =>
        total + summaryDispensed(machineSummaryFor(data, machine)),
      0,
    );
    // Machine Logs are authoritative for all-product totals. Product-filtered
    // totals use raw matching events because the summary RPC is machine-level.
    const dispensed =
      appliedFilters.selectedProducts.length === 0 ? machineLogDispensed : rawDispensed;
    const eventStockouts = filtered.events.filter((e: any) =>
      /stock.?out|out.?of.?stock/i.test(`${e.event_type} ${e.action} ${e.status}`),
    ).length;
    const machineLogStockouts = filtered.machines.reduce(
      (total: number, machine: any) =>
        total + summaryStockouts(machineSummaryFor(data, machine)),
      0,
    );
    // Machine Logs are the authoritative source for unfulfilled/out-of-stock
    // attempts when no product filter is active. Product-filtered analysis falls
    // back to raw matching events because the machine summary is not product-specific.
    const stockouts =
      appliedFilters.selectedProducts.length === 0 ? machineLogStockouts : eventStockouts;
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
      dispensed + stockouts > 0
        ? dispensed / (dispensed + stockouts)
        : 1;
    const averageAccess = avgScored(access);
    const averageRisk = avgScored(risk);
    const averageMaximum = avgScored(max);
    const effective = averageAccess * Math.max(0, inventoryAvailability);
    return {
      access: averageAccess,
      risk: averageRisk,
      max: averageMaximum,
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
  }, [filtered, data, appliedFilters.selectedProducts]);
  const rows = useMemo(() => {
    if (!filtered || !data) return [];
    return filtered.machines.map((m: any) => {
      const l =
        data.locations.find(
          (x: any) => x.id === m.location_id || x.machine_id === m.machine_id,
        ) || {};
      const machineKeys = new Set(
        [m.id, m.machine_id, m.machine_uuid, m.machine_wtn_id]
          .map(machineKey)
          .filter(Boolean),
      );
      const belongsToMachine = (x: any) =>
        [x.machine_uuid, x.machine_id, x.machine_wtn_id]
          .map(machineKey)
          .some((key) => key && machineKeys.has(key));
      const p = filtered.plans.filter(belongsToMachine);
      const r = filtered.restocks.filter(belongsToMachine);
      const e = filtered.events.filter(belongsToMachine);
      const machineSummary = machineSummaryFor(data, m) || {};
      const eventStockouts = e.filter((x: any) =>
        /stock.?out|out.?of.?stock/i.test(`${x.event_type} ${x.action} ${x.status}`),
      ).length;
      return {
        agency: l.agency || "Unassigned",
        location: l.location_name || "Unknown",
        machine: m.machine_id,
        capacity: p.reduce((s: number, x: any) => s + n(x.max_level), 0),
        par: p.reduce((s: number, x: any) => s + n(x.par_level), 0),
        current: p.reduce((s: number, x: any) => s + n(x.current_quantity), 0),
        dispensed:
          appliedFilters.selectedProducts.length === 0
            ? summaryDispensed(machineSummary)
            : e
                .filter((x: any) =>
                  String(x.event_type || x.action || "")
                    .toLowerCase()
                    .includes("dispens") ||
                  (String(x.action || "").toLowerCase() === "transactions" &&
                    String(x.status || "").toLowerCase() === "success"),
                )
                .reduce((s: number, x: any) => s + Math.max(1, n(x.quantity)), 0),
        stockouts:
          appliedFilters.selectedProducts.length === 0
            ? summaryStockouts(machineSummary)
            : eventStockouts,
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
  }, [filtered, data, appliedFilters.selectedProducts]);
  const report = useMemo<ReportModel>(
    () => ({
      title: "Agency Operations Analyzer",
      subtitle: `${appliedFilters.agency || "All agencies"} · ${appliedFilters.selectedProducts.length ? appliedFilters.selectedProducts.join(", ") : "All products"}`,
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
    [appliedFilters.agency, appliedFilters.selectedProducts, summary, filtered, rows],
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
      <div className="grid gap-3 rounded-2xl border bg-white p-4 shadow-sm md:grid-cols-6 print:hidden">
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
        <div className="relative">
          <button
            type="button"
            onClick={() => setProductMenuOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2 text-left text-sm"
          >
            <span className="truncate">
              {selectedProducts.length === 0
                ? "All products"
                : selectedProducts.length === 1
                  ? selectedProducts[0]
                  : `${selectedProducts.length} products selected`}
            </span>
            <ChevronDown size={16} className="shrink-0 text-slate-500" />
          </button>
          {productMenuOpen && (
            <div className="absolute left-0 top-full z-30 mt-2 w-full min-w-72 rounded-xl border bg-white p-3 shadow-xl">
              <div className="mb-2 flex items-center justify-between gap-2 border-b pb-2">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Filter products
                </p>
                <div className="flex gap-2 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedProducts((current) =>
                        Array.from(new Set([...current, ...visibleProducts])),
                      )
                    }
                    className="text-blue-700 hover:underline"
                  >
                    Select matching
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedProducts([])}
                    className="text-slate-600 hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="relative mb-2">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  type="search"
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                  placeholder="Type a product name..."
                  autoFocus
                  className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-8 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                {productSearch && (
                  <button
                    type="button"
                    onClick={() => setProductSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Clear product search"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {visibleProducts.length === 0 ? (
                  <p className="py-3 text-sm text-slate-500">
                    No products match “{productSearch}”.
                  </p>
                ) : (
                  visibleProducts.map((productName) => {
                    const checked = selectedProducts.includes(productName);
                    return (
                      <label
                        key={productName}
                        className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-sm hover:bg-slate-50"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedProducts((current) =>
                              checked
                                ? current.filter((name) => name !== productName)
                                : [...current, productName],
                            )
                          }
                          className="mt-0.5 h-4 w-4 rounded border-slate-300"
                        />
                        <span>{productName}</span>
                      </label>
                    );
                  })
                )}
              </div>
              <div className="mt-3 flex justify-end border-t pt-2">
                <button
                  type="button"
                  onClick={() => setProductMenuOpen(false)}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
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
        <button
          type="button"
          onClick={reviewSelection}
          disabled={reviewing}
          className="rounded-xl bg-blue-600 px-5 py-2 font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
        >
          {reviewing ? "Loading…" : hasReviewed ? "Update Review" : "Review"}
        </button>
      </div>
      {!hasReviewed && (
        <div className="rounded-2xl border border-dashed bg-white p-10 text-center">
          <p className="text-lg font-semibold text-slate-900">Choose the scope you want to analyze</p>
          <p className="mt-2 text-sm text-slate-500">Select an agency, location, machine, products, and date range, then choose Review to load the results.</p>
        </div>
      )}
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
