import {
  CATALOG,
  setVariantFor,
  brandEmitters,
  DEFAULT_BRAND,
  type RollSpec,
  type SprinklerBrand,
} from "../catalog";
import type { BomLine, PipeRun, SprinklerHead } from "../types";

/** Pick rolls covering `lengthM` with a simple greedy (cheap and readable). */
function pickRolls(lengthM: number, rolls: RollSpec[]): Array<{
  roll: RollSpec;
  qty: number;
}> {
  if (lengthM <= 0 || rolls.length === 0) return [];
  const sorted = [...rolls].sort((a, b) => b.lengthM - a.lengthM);
  const smallest = sorted[sorted.length - 1];
  const out = new Map<string, { roll: RollSpec; qty: number }>();
  let rest = lengthM;
  while (rest > 0) {
    const covering = [...sorted].reverse().find((r) => r.lengthM >= rest);
    const roll = covering ?? sorted[0];
    const key = roll.article ?? roll.label;
    const cur = out.get(key);
    if (cur) cur.qty += 1;
    else out.set(key, { roll, qty: 1 });
    rest -= roll.lengthM;
    if (roll === smallest && rest > 0 && rest < smallest.lengthM) {
      // done after this roll
    }
  }
  return [...out.values()];
}

function catalogImage(key: string): string | null {
  const imgs = CATALOG.images ?? {};
  if (imgs[key]) return imgs[key];
  const base = key.replace(/-360$/, "").replace(/@.*$/, "");
  return imgs[base] ?? null;
}

function partImage(
  part: { article?: string | null; imageUrl?: string | null } | null | undefined,
  fallbackKey?: string,
): string | null {
  if (part?.imageUrl) return part.imageUrl;
  if (part?.article) {
    const byArt = catalogImage(part.article);
    if (byArt) return byArt;
  }
  if (fallbackKey) return catalogImage(fallbackKey);
  return null;
}

/** Short shop-facing label — no long manufacturer blurb. */
function shortSprayLabel(
  nozzleKey: string,
  anschluss: "tee" | "elbow",
  brand: SprinklerBrand,
): string {
  const fit = anschluss === "tee" ? "T-Stück" : "Winkel";
  if (brand === "hunter") {
    const nozzle = nozzleKey.replace(/SR$/, "");
    return `PROS-04-PRS40-CV · ${nozzle} · ${fit}`;
  }
  const nozzle = nozzleKey.replace("R-VAN", "R-VAN ");
  return `1804-SAM · ${nozzle} · ${fit}`;
}

function shortPipeLabel(label: string): string {
  // "50 m/Rolle PE-Rohr 25 mm PN10 Schwarz/Blau" → "PE-Rohr 25 mm · 50 m"
  const m = label.match(/(\d+)\s*m\/Rolle\s+PE-Rohr\s+(\d+)\s*mm/i);
  if (m) return `PE-Rohr ${m[2]} mm · ${m[1]} m Rolle`;
  return label.replace(/\s*PN10.*$/i, "").trim();
}

function shortGeneric(label: string, max = 56): string {
  const cleaned = label
    .replace(/,\s*Inneng\..*$/i, "")
    .replace(/,\s*Original R.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function line(
  partial: Omit<BomLine, "totalEur">,
): BomLine {
  return {
    ...partial,
    totalEur:
      partial.priceEur == null
        ? null
        : Number((partial.priceEur * partial.qty).toFixed(2)),
  };
}

export function buildBom(params: {
  heads: SprinklerHead[];
  pipes: PipeRun[];
  zoneCount: number;
  wireLengthM: number;
  dripTubeLengthM: number;
  brand?: SprinklerBrand;
}): { bom: BomLine[]; totalKnownEur: number; hasUnknownPrices: boolean } {
  const {
    heads,
    pipes,
    zoneCount,
    wireLengthM,
    dripTubeLengthM,
    brand = DEFAULT_BRAND,
  } = params;
  const emitters = brandEmitters(brand);
  const bom: BomLine[] = [];

  // ── Regner ─────────────────────────────────────────────────────────────────
  const sprayGroups = new Map<
    string,
    { qty: number; headIds: string[]; nozzleKey: string; anschluss: "tee" | "elbow" }
  >();
  for (const h of heads) {
    if (h.kind !== "spray" && h.kind !== "strip") continue;
    const anschluss = h.lineEnd ? "elbow" : "tee";
    const key = `${h.configKey}|${anschluss}`;
    const cur = sprayGroups.get(key);
    if (cur) {
      cur.qty += 1;
      cur.headIds.push(h.id);
    } else {
      sprayGroups.set(key, {
        qty: 1,
        headIds: [h.id],
        nozzleKey: h.configKey.replace(/-360$/, ""),
        anschluss,
      });
    }
  }
  for (const [key, g] of [...sprayGroups.entries()].sort()) {
    const variant = setVariantFor(g.nozzleKey, g.anschluss, brand);
    bom.push(
      line({
        key: `set-${key}`,
        article: emitters.sprayHead.setArticle,
        label: shortSprayLabel(g.nozzleKey, g.anschluss, brand),
        qty: g.qty,
        unit: "piece",
        priceEur: variant?.priceEur ?? null,
        group: "regner",
        imageUrl:
          catalogImage(g.nozzleKey) ??
          catalogImage(brand === "hunter" ? "PROS-04" : "1804"),
        headIds: g.headIds,
      }),
    );
  }

  const rotorHeads = heads.filter((h) => h.kind === "rotor");
  if (rotorHeads.length > 0) {
    bom.push(
      line({
        key: "rotor",
        article: emitters.rotor.article,
        label: `${emitters.rotor.label} Getrieberegner`,
        qty: rotorHeads.length,
        unit: "piece",
        priceEur: emitters.rotor.priceEur,
        group: "regner",
        imageUrl: partImage(
          emitters.rotor,
          brand === "hunter" ? "I-20" : "3504",
        ),
        headIds: rotorHeads.map((h) => h.id),
      }),
    );
    for (const acc of emitters.rotor.accessories) {
      bom.push(
        line({
          key: `rotor-acc-${acc.article ?? acc.label}`,
          article: acc.article,
          label: shortGeneric(acc.label, 48),
          qty: rotorHeads.length,
          unit: "piece",
          priceEur: acc.priceEur,
          group: "regner",
          imageUrl: partImage(
            acc,
            brand === "hunter" ? "I-20" : "3504",
          ),
          headIds: rotorHeads.map((h) => h.id),
        }),
      );
    }
  }

  // ── Rohr ───────────────────────────────────────────────────────────────────
  // ── Rohr: group by sized OD when present (v2), else PE25 lateral / PE32 main ──
  const byOd = new Map<number, number>();
  for (const p of pipes) {
    const od = p.odMm ?? (p.kind === "main" ? 32 : 25);
    byOd.set(od, (byOd.get(od) ?? 0) + p.lengthM * 1.1);
  }
  if (byOd.size === 0) {
    // no pipes
  } else {
    for (const [od, lenM] of byOd) {
      const rolls =
        od >= 32 ? CATALOG.pipes.pe32Rolls : CATALOG.pipes.pe25Rolls;
      for (const { roll, qty } of pickRolls(Math.ceil(lenM), rolls)) {
        bom.push(
          line({
            key: `pe${od}-${roll.article}`,
            article: roll.article,
            label: shortPipeLabel(roll.label),
            qty,
            unit: "roll",
            priceEur: roll.priceEur,
            group: "rohr",
            note: `ca. ${Math.ceil(lenM)} m PE ${od}`,
            imageUrl: partImage(roll),
          }),
        );
      }
    }
  }

  // ── Ventile / Verteiler ─────────────────────────────────────────────────────
  if (zoneCount > 0) {
    const zp = CATALOG.zoneParts;
    bom.push(
      line({
        key: "valve",
        article: zp.valve.article,
        label: shortGeneric(zp.valve.label, 42),
        qty: zoneCount,
        unit: "piece",
        priceEur: zp.valve.priceEur,
        group: "ventile",
        imageUrl: partImage(zp.valve),
        linkFixtureKind: "wasserverteiler",
      }),
    );
    bom.push(
      line({
        key: "adapter25",
        article: zp.adapterPe25Valve.article,
        label: "Kupplung PE 25 → Ventil",
        qty: zoneCount,
        unit: "piece",
        priceEur: zp.adapterPe25Valve.priceEur,
        group: "ventile",
        imageUrl: partImage(zp.adapterPe25Valve),
      }),
    );
    bom.push(
      line({
        key: "adapter32",
        article: zp.adapterPe32Valve.article,
        label: "Kupplung PE 32 → Verteiler",
        qty: 1,
        unit: "piece",
        priceEur: zp.adapterPe32Valve.priceEur,
        group: "ventile",
        imageUrl: partImage(zp.adapterPe32Valve),
      }),
    );
    const sorted = [...zp.verteiler].sort((a, b) => b.outlets - a.outlets);
    let need = zoneCount;
    for (const v of sorted) {
      if (need <= 0) break;
      if (v.outlets <= 0) continue;
      const isLast = v === sorted[sorted.length - 1];
      const qty = isLast ? Math.ceil(need / v.outlets) : Math.floor(need / v.outlets);
      if (qty <= 0) continue;
      bom.push(
        line({
          key: `verteiler-${v.article}`,
          article: v.article,
          label: `PVC-Verteiler ${v.outlets}-fach`,
          qty,
          unit: "piece",
          priceEur: v.priceEur,
          group: "ventile",
          imageUrl: partImage(v),
          linkFixtureKind: "wasserverteiler",
        }),
      );
      need -= qty * v.outlets;
    }
    bom.push(
      line({
        key: "valvebox",
        article: zp.valveBox.article,
        label: "Ventilkasten",
        qty: Math.ceil(zoneCount / 4),
        unit: "piece",
        priceEur: zp.valveBox.priceEur,
        group: "ventile",
        imageUrl: partImage(zp.valveBox),
        linkFixtureKind: "wasserverteiler",
      }),
    );
  }

  // ── Steuerung ───────────────────────────────────────────────────────────────
  if (zoneCount > 0) {
    const ctl =
      CATALOG.controls.controllers.find((c) => c.stations >= zoneCount) ??
      CATALOG.controls.controllers[CATALOG.controls.controllers.length - 1];
    if (ctl) {
      bom.push(
        line({
          key: "controller",
          article: ctl.article,
          label: shortGeneric(ctl.label, 40),
          qty: 1,
          unit: "piece",
          priceEur: ctl.priceEur,
          group: "steuerung",
          imageUrl: partImage(ctl),
          linkFixtureKind: "smarthome",
        }),
      );
    }
    const wire =
      CATALOG.controls.wirePerMeter.find((w) => w.cores >= zoneCount + 1) ??
      CATALOG.controls.wirePerMeter[CATALOG.controls.wirePerMeter.length - 1];
    if (wire) {
      const qty = Math.max(5, Math.ceil(wireLengthM));
      bom.push(
        line({
          key: "wire",
          article: wire.article,
          label: `Steuerkabel ${wire.cores} Adern`,
          qty,
          unit: "meter",
          priceEur: wire.priceEurPerM,
          group: "steuerung",
          imageUrl: partImage(wire),
          linkFixtureKind: "smarthome",
        }),
      );
    }
    bom.push(
      line({
        key: "splice",
        article: CATALOG.controls.splice.article,
        label: shortGeneric(CATALOG.controls.splice.label, 40),
        qty: Math.max(1, Math.ceil(zoneCount / 3)),
        unit: "piece",
        priceEur: CATALOG.controls.splice.priceEur,
        group: "steuerung",
        imageUrl: partImage(CATALOG.controls.splice),
        linkFixtureKind: "smarthome",
      }),
    );
  }

  // ── Quelle ──────────────────────────────────────────────────────────────────
  bom.push(
    line({
      key: "ballvalve",
      article: CATALOG.sourceParts.ballValve.article,
      label: "Kugelhahn Absperrung",
      qty: 1,
      unit: "piece",
      priceEur: CATALOG.sourceParts.ballValve.priceEur,
      group: "quelle",
      imageUrl: partImage(CATALOG.sourceParts.ballValve),
      linkFixtureKind: "wasserquelle",
    }),
  );
  // v2 §13: do not treat a generic check valve as sufficient backflow protection
  bom.push(
    line({
      key: "backflow-review",
      article: null,
      label: "Sicherungseinrichtung – durch Fachbetrieb festzulegen",
      qty: 1,
      unit: "piece",
      priceEur: null,
      group: "quelle",
      note: "DIN EN 1717 / DVGW — Typ nach Anschluss und System wählen.",
      linkFixtureKind: "wasserquelle",
    }),
  );

  // ── Tropfbewässerung ────────────────────────────────────────────────────────
  if (dripTubeLengthM > 0) {
    bom.push(
      line({
        key: "drip-tube",
        article: CATALOG.drip.tube.article,
        label: shortGeneric(CATALOG.drip.tube.label, 40),
        qty: Math.ceil(dripTubeLengthM),
        unit: "meter",
        priceEur: CATALOG.drip.tube.priceEur,
        group: "tropf",
        imageUrl: partImage(CATALOG.drip.tube),
      }),
    );
    bom.push(
      line({
        key: "drip-kit",
        article: CATALOG.drip.controlKit.article,
        label: shortGeneric(CATALOG.drip.controlKit.label, 40),
        qty: 1,
        unit: "piece",
        priceEur: CATALOG.drip.controlKit.priceEur,
        group: "tropf",
        imageUrl: partImage(CATALOG.drip.controlKit),
      }),
    );
  }

  const totalKnownEur = Number(
    bom.reduce((s, l) => s + (l.totalEur ?? 0), 0).toFixed(2),
  );
  const hasUnknownPrices = bom.some((l) => l.priceEur == null);

  return { bom, totalKnownEur, hasUnknownPrices };
}
