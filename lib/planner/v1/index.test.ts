import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DrawnZone, PlotFixture } from "@/lib/mapbox";
import { CATALOG } from "../catalog";
import { pointInPolygon } from "./geometry";
import { computeSofortPlanV1 as computeSofortPlan } from "./index";
import { assignHydraulicZones, hazenWilliamsLossBar } from "./hydraulics";
import { layoutLawnZone } from "./layout";
import type { SprinklerHead } from "../types";

const ORIGIN = { lng: 11.58, lat: 48.14 };

/** Offset meters east/north from ORIGIN → LngLat */
function m(east: number, north: number) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  return {
    lng: ORIGIN.lng + east / (R * toRad * Math.cos(ORIGIN.lat * toRad)),
    lat: ORIGIN.lat + north / (R * toRad),
  };
}

function lawn(
  id: string,
  corners: Array<[number, number]>,
): DrawnZone {
  return {
    id,
    type: "rasen",
    coordinates: corners.map(([e, n]) => m(e, n)),
  };
}

function fixturesWithVerteiler(flowM3h = 2): PlotFixture[] {
  return [
    {
      id: "q1",
      kind: "wasserquelle",
      position: m(-2, -2),
      wassermengeM3h: flowM3h,
    },
    {
      id: "v1",
      kind: "wasserverteiler",
      position: m(0, 0),
    },
  ];
}

describe("layoutLawnZone", () => {
  it("places heads on a rectangular lawn", () => {
    const zone = lawn("r1", [
      [0, 0],
      [12, 0],
      [12, 8],
      [0, 8],
    ]);
    const { heads, areaM2, warnings } = layoutLawnZone(zone, []);
    assert.ok(areaM2 > 90 && areaM2 < 100);
    assert.ok(heads.length >= 4, `expected ≥4 heads, got ${heads.length}`);
    assert.ok(heads.every((h) => h.kind === "spray" || h.kind === "rotor"));
    assert.equal(warnings.filter((w) => /Streifendüsen/i.test(w)).length, 0);
  });

  it("places corner heads near vertices without large edge inset", () => {
    const zone = lawn("r-inset", [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    const { heads } = layoutLawnZone(zone, []);
    const corners = [m(0, 0), m(10, 0), m(10, 10), m(0, 10)];
    for (const c of corners) {
      const near = heads.some((h) => {
        const dx =
          (h.position.lng - c.lng) *
          111320 *
          Math.cos((c.lat * Math.PI) / 180);
        const dy = (h.position.lat - c.lat) * 111320;
        return Math.hypot(dx, dy) < 0.3;
      });
      assert.ok(near, "expected a head close to each corner");
    }
    const cornerish = heads.filter((h) => h.arcDeg > 0 && h.arcDeg <= 120);
    assert.ok(
      cornerish.length >= 4,
      `expected ≥4 corner arcs, got ${cornerish.length}`,
    );
  });

  it("keeps spray radii inside manufacturer min–max", () => {
    const zone = lawn("r-spec", [
      [0, 0],
      [14, 0],
      [14, 9],
      [0, 9],
    ]);
    const { heads } = layoutLawnZone(zone, []);
    const spray = heads.filter((h) => h.kind === "spray");
    assert.ok(spray.length > 0);
    for (const h of spray) {
      const base = h.configKey.replace(/-360$/, "");
      const spec = CATALOG.sprayHead.nozzles[base];
      assert.ok(spec, `missing nozzle ${base}`);
      assert.ok(
        h.radiusM >= spec.radiusMinM - 0.01,
        `${h.configKey} radius ${h.radiusM} < min ${spec.radiusMinM}`,
      );
      assert.ok(
        h.radiusM <= spec.radiusMaxM + 0.01,
        `${h.configKey} radius ${h.radiusM} > max ${spec.radiusMaxM}`,
      );
      if (h.arcDeg < 360) {
        assert.ok(h.arcDeg >= spec.arcMinDeg);
        assert.ok(h.arcDeg <= spec.arcMaxDeg);
      }
    }
  });

  it("uses strip nozzles on a narrow band", () => {
    const zone = lawn("strip", [
      [0, 0],
      [20, 0],
      [20, 2],
      [0, 2],
    ]);
    const { heads, warnings } = layoutLawnZone(zone, []);
    assert.ok(heads.length >= 1);
    assert.ok(heads.every((h) => h.kind === "strip"));
    assert.ok(warnings.some((w) => /Streifendüsen/i.test(w)));
  });

  it("avoids placing heads inside Gebäude obstacles", () => {
    const zone = lawn("r2", [
      [0, 0],
      [16, 0],
      [16, 12],
      [0, 12],
    ]);
    const building: DrawnZone = {
      id: "b1",
      type: "gebaeude",
      coordinates: [m(4, 4), m(12, 4), m(12, 10), m(4, 10)],
    };
    const { heads } = layoutLawnZone(zone, [building]);
    const center = m(8, 7);
    for (const h of heads) {
      const dx =
        (h.position.lng - center.lng) *
        111320 *
        Math.cos((center.lat * Math.PI) / 180);
      const dy = (h.position.lat - center.lat) * 111320;
      assert.ok(Math.hypot(dx, dy) > 1.5, "head inside building");
    }
  });

  it("fills a dry center with 360° when edge throw is capped by buildings", () => {
    // Wide lawn; buildings along left/right force short edge radii → dry middle
    const zone = lawn("r-dry", [
      [0, 0],
      [18, 0],
      [18, 12],
      [0, 12],
    ]);
    const left: DrawnZone = {
      id: "bl",
      type: "gebaeude",
      coordinates: [m(-0.5, 2), m(1.2, 2), m(1.2, 10), m(-0.5, 10)],
    };
    const right: DrawnZone = {
      id: "br",
      type: "gebaeude",
      coordinates: [m(16.8, 2), m(18.5, 2), m(18.5, 10), m(16.8, 10)],
    };
    const { heads, warnings } = layoutLawnZone(zone, [left, right]);
    const full = heads.filter((h) => h.arcDeg >= 360);
    assert.ok(
      full.length >= 1,
      `expected ≥1 interior 360°, got ${full.length}; heads=${heads.length}; warnings=${warnings.join(" | ")}`,
    );
    // Interior head should sit away from the left/right buildings
    const mid = full.some((h) => {
      const dx =
        (h.position.lng - m(9, 6).lng) *
        111320 *
        Math.cos((ORIGIN.lat * Math.PI) / 180);
      const dy = (h.position.lat - m(9, 6).lat) * 111320;
      return Math.hypot(dx, dy) < 4;
    });
    assert.ok(mid, "360° head should land near the dry center");
  });

  it("places heads on Gebäude façades that cut into the lawn", () => {
    const zone = lawn("r-facade", [
      [0, 0],
      [20, 0],
      [20, 14],
      [0, 14],
    ]);
    const building: DrawnZone = {
      id: "b-cut",
      type: "gebaeude",
      coordinates: [m(12, 8), m(18, 8), m(18, 14), m(12, 14)],
    };
    const { heads } = layoutLawnZone(zone, [building]);
    assert.ok(heads.length >= 6, `expected several heads, got ${heads.length}`);

    for (const c of [m(12, 8), m(18, 8)]) {
      const near = heads.some((h) => {
        const dx =
          (h.position.lng - c.lng) *
          111320 *
          Math.cos((c.lat * Math.PI) / 180);
        const dy = (h.position.lat - c.lat) * 111320;
        return Math.hypot(dx, dy) < 1.2;
      });
      assert.ok(near, "expected a head at the building façade corner");
    }
  });

  it("handles an L-shaped lawn without crashing", () => {
    const zone = lawn("L", [
      [0, 0],
      [15, 0],
      [15, 5],
      [5, 5],
      [5, 15],
      [0, 15],
    ]);
    const { heads, areaM2 } = layoutLawnZone(zone, []);
    assert.ok(areaM2 > 100);
    assert.ok(heads.length >= 3);
  });
});

describe("assignHydraulicZones", () => {
  it("does not mix spray and rotor in one zone", () => {
    const heads: SprinklerHead[] = [
      {
        id: "s1",
        position: m(1, 0),
        kind: "spray",
        configKey: "R-VAN14",
        radiusM: 4,
        arcDeg: 180,
        rotationDeg: 0,
        flowLMin: 5,
        lawnZoneId: "a",
        hydraulicZone: 0,
      },
      {
        id: "r1",
        position: m(2, 0),
        kind: "rotor",
        configKey: "3504@2.0",
        radiusM: 8,
        arcDeg: 360,
        rotationDeg: 0,
        flowLMin: 12,
        lawnZoneId: "a",
        hydraulicZone: 0,
      },
      {
        id: "s2",
        position: m(3, 0),
        kind: "spray",
        configKey: "R-VAN14",
        radiusM: 4,
        arcDeg: 90,
        rotationDeg: 0,
        flowLMin: 3,
        lawnZoneId: "a",
        hydraulicZone: 0,
      },
    ];
    const { heads: zoned, zoneCount } = assignHydraulicZones(
      heads,
      m(0, 0),
      100,
    );
    assert.ok(zoneCount >= 2);
    const byZone = new Map<number, Set<string>>();
    for (const h of zoned) {
      const set = byZone.get(h.hydraulicZone) ?? new Set();
      set.add(h.kind);
      byZone.set(h.hydraulicZone, set);
    }
    for (const kinds of byZone.values()) {
      assert.equal(kinds.size, 1, `mixed kinds in zone: ${[...kinds]}`);
    }
  });
});

describe("hazenWilliamsLossBar", () => {
  it("returns positive loss that grows with length and flow", () => {
    const a = hazenWilliamsLossBar({
      lengthM: 30,
      flowLMin: 40,
      internalDiameterMm: 20.4,
    });
    const b = hazenWilliamsLossBar({
      lengthM: 60,
      flowLMin: 40,
      internalDiameterMm: 20.4,
    });
    assert.ok(a > 0);
    assert.ok(b > a);
  });
});

describe("computeSofortPlan", () => {
  it("builds heads, zones, pipes, BOM and coverage for a rectangle", () => {
    const zones = [
      lawn("r1", [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ]),
    ];
    const plan = computeSofortPlan(zones, fixturesWithVerteiler(2.5));
    assert.ok(plan.heads.length > 0);
    assert.ok(plan.zones.length > 0);
    assert.ok(plan.pipes.some((p) => p.kind === "lateral"));
    assert.ok(plan.bom.length > 0);
    assert.ok(plan.coveragePct >= 0 && plan.coveragePct <= 100);
    assert.equal(typeof plan.totalKnownEur, "number");
  });

  it("routes laterals around Gebäude instead of through them", () => {
    // Long lawn with a building blocking the middle
    const zones: DrawnZone[] = [
      lawn("r1", [
        [0, 0],
        [24, 0],
        [24, 10],
        [0, 10],
      ]),
      {
        id: "b1",
        type: "gebaeude",
        coordinates: [m(9, 1), m(15, 1), m(15, 9), m(9, 9)],
      },
    ];
    const fixtures = [
      {
        id: "v1",
        kind: "wasserverteiler" as const,
        position: m(1, 5),
      },
      {
        id: "q1",
        kind: "wasserquelle" as const,
        position: m(0.5, 5),
        wassermengeM3h: 3,
      },
    ];
    const plan = computeSofortPlan(zones, fixtures);
    assert.ok(plan.pipes.some((p) => p.kind === "lateral"));

    const origin = m(1, 5);
    const toM = (p: { lng: number; lat: number }) => {
      const cos = Math.cos((origin.lat * Math.PI) / 180);
      return {
        x: (p.lng - origin.lng) * 111320 * cos,
        y: (p.lat - origin.lat) * 110540,
      };
    };
    const building = [
      toM(m(9, 1)),
      toM(m(15, 1)),
      toM(m(15, 9)),
      toM(m(9, 9)),
    ];
    for (const pipe of plan.pipes) {
      for (let i = 1; i < pipe.points.length; i++) {
        const a = toM(pipe.points[i - 1]);
        const b = toM(pipe.points[i]);
        const n = 12;
        for (let s = 1; s < n; s++) {
          const t = s / n;
          const p = {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
          };
          assert.equal(
            pointInPolygon(p, building),
            false,
            `pipe ${pipe.id} enters Gebäude`,
          );
        }
      }
    }
  });

  it("warns when Verteiler is missing", () => {
    const zones = [
      lawn("r1", [
        [0, 0],
        [8, 0],
        [8, 6],
        [0, 6],
      ]),
    ];
    const plan = computeSofortPlan(zones, []);
    assert.ok(plan.heads.length > 0);
    assert.ok(plan.warnings.some((w) => /Wasserverteiler/i.test(w)));
    assert.equal(plan.pipes.length, 0);
  });
});
