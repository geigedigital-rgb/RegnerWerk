import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DrawnZone } from "@/lib/mapbox";
import type { SprinklerHead } from "../types";
import { selectManifoldKit } from "./bom";
import {
  buildHeadCompatibilityGroups,
  buildManagementAreas,
  designValveZones,
} from "./zoning";

const ORIGIN = { lng: 11.58, lat: 48.14 };

function m(east: number, north: number) {
  const R = 6371000;
  const dLat = (north / R) * (180 / Math.PI);
  const dLng =
    (east / (R * Math.cos((ORIGIN.lat * Math.PI) / 180))) * (180 / Math.PI);
  return { lng: ORIGIN.lng + dLng, lat: ORIGIN.lat + dLat };
}

function head(
  id: string,
  east: number,
  north: number,
  flowLMin: number,
  opts?: Partial<SprinklerHead>,
): SprinklerHead {
  return {
    id,
    position: m(east, north),
    kind: "spray",
    configKey: "MP1000",
    radiusM: 4,
    arcDeg: 180,
    rotationDeg: 0,
    flowLMin,
    lawnZoneId: "lawn1",
    hydraulicZone: 0,
    ...opts,
  };
}

describe("v3 professional zoning", () => {
  it("homogeneous lawn within Q → 1 zone", () => {
    const heads = [
      head("a", 0, 0, 8),
      head("b", 3, 0, 8),
      head("c", 0, 3, 8),
      head("d", 3, 3, 8),
    ];
    // 32 l/min, source 40 * 0.85 ≈ 34 → 1 zone
    const sourceFlowLMin = 40;
    const z = designValveZones({
      heads,
      lawns: [{ id: "lawn1", type: "rasen", coordinates: [m(0, 0), m(6, 0), m(6, 6), m(0, 6)] }],
      obstacles: [],
      sourceFlowLMin,
      verteilerPos: m(-1, -1),
    });
    assert.equal(z.zoneCount, 1);
    assert.ok(z.decisions.length >= 1);
    assert.ok(
      z.decisions[0].primaryReason === "SOURCE_FLOW" ||
        z.decisions[0].explanation.includes("eine Ventilzone"),
    );
  });

  it("flow slightly over cap → 2 balanced zones (not max+orphan)", () => {
    // 36 l/min, cap ≈ 35 → need 2 zones; must not be ~34+2
    const heads = [
      head("a", 0, 0, 6),
      head("b", 2, 0, 6),
      head("c", 4, 0, 6),
      head("d", 0, 2, 6),
      head("e", 2, 2, 6),
      head("f", 4, 2, 6),
    ];
    const sourceFlowLMin = 35 / 0.85; // cap = 35
    const z = designValveZones({
      heads,
      lawns: [{ id: "lawn1", type: "rasen", coordinates: [m(0, 0), m(8, 0), m(8, 4), m(0, 4)] }],
      obstacles: [],
      sourceFlowLMin,
      verteilerPos: m(-1, -1),
    });
    assert.equal(z.zoneCount, 2);
    const flows = [0, 1].map((zi) =>
      z.heads
        .filter((h) => h.hydraulicZone === zi)
        .reduce((s, h) => s + h.flowLMin, 0),
    );
    flows.sort((a, b) => a - b);
    assert.ok(flows[0] >= 12, `orphan-like low zone: ${flows.join("+")}`);
    assert.ok(
      Math.abs(flows[0] - flows[1]) <= 12,
      `imbalanced: ${flows.join("+")}`,
    );
  });

  it("MP800 + standard MP → different zones, PRECIPITATION_CLASS", () => {
    const heads = [
      head("mp1", 0, 0, 5, { configKey: "MP800" }),
      head("mp2", 2, 0, 5, { configKey: "MP800" }),
      head("std1", 0, 3, 5, { configKey: "MP1000" }),
      head("std2", 2, 3, 5, { configKey: "MP1000" }),
    ];
    const z = designValveZones({
      heads,
      lawns: [{ id: "lawn1", type: "rasen", coordinates: [m(0, 0), m(6, 0), m(6, 6), m(0, 6)] }],
      obstacles: [],
      sourceFlowLMin: 50,
      verteilerPos: m(-1, -1),
    });
    assert.ok(z.zoneCount >= 2);
    const zonesMp = new Set(
      z.heads.filter((h) => h.configKey.startsWith("MP8")).map((h) => h.hydraulicZone),
    );
    const zonesStd = new Set(
      z.heads.filter((h) => h.configKey === "MP1000").map((h) => h.hydraulicZone),
    );
    for (const zm of zonesMp) {
      assert.ok(!zonesStd.has(zm), "MP800 must not share valve with standard MP");
    }
    assert.ok(
      z.decisions.some((d) => d.primaryReason === "PRECIPITATION_CLASS"),
      JSON.stringify(z.decisions.map((d) => d.primaryReason)),
    );
  });

  it("orphan without hard reason is merged when feasible", () => {
    // Tiny residual would be 2 l/min if greedy; balanced should merge or balance
    const heads = [
      head("a", 0, 0, 10),
      head("b", 2, 0, 10),
      head("c", 4, 0, 10),
      head("orphan", 20, 20, 2),
    ];
    const sourceFlowLMin = 32 / 0.85; // cap 32 — all fit in one zone
    const z = designValveZones({
      heads,
      lawns: [
        {
          id: "lawn1",
          type: "rasen",
          coordinates: [m(0, 0), m(25, 0), m(25, 25), m(0, 25)],
        },
      ],
      obstacles: [],
      sourceFlowLMin,
      verteilerPos: m(-1, -1),
    });
    assert.equal(z.zoneCount, 1, "32 l/min under cap must stay one zone");
  });

  it("two separate Rasen polygons → two valve zones (DISCONNECTED_AREA)", () => {
    const heads = [
      head("a1", 0, 0, 6, { lawnZoneId: "lawn-a" }),
      head("a2", 2, 0, 6, { lawnZoneId: "lawn-a" }),
      head("b1", 20, 0, 6, { lawnZoneId: "lawn-b" }),
      head("b2", 22, 0, 6, { lawnZoneId: "lawn-b" }),
    ];
    const z = designValveZones({
      heads,
      lawns: [
        {
          id: "lawn-a",
          type: "rasen",
          coordinates: [m(0, 0), m(5, 0), m(5, 5), m(0, 5)],
        },
        {
          id: "lawn-b",
          type: "rasen",
          coordinates: [m(18, 0), m(25, 0), m(25, 5), m(18, 5)],
        },
      ],
      obstacles: [],
      sourceFlowLMin: 50, // both fit hydraulically on one valve if allowed
      verteilerPos: m(10, -2),
    });
    assert.equal(z.zoneCount, 2);
    const zoneA = z.heads.find((h) => h.id === "a1")!.hydraulicZone;
    const zoneB = z.heads.find((h) => h.id === "b1")!.hydraulicZone;
    assert.notEqual(zoneA, zoneB);
    assert.ok(
      z.decisions.some((d) => d.primaryReason === "DISCONNECTED_AREA"),
      JSON.stringify(z.decisions.map((d) => d.primaryReason)),
    );
    assert.ok(
      z.assumptions.some((a) => /Getrennte Rasenflächen/i.test(a)),
    );
  });

  it("buildManagementAreas records sun/soil assumption", () => {
    const lawns: DrawnZone[] = [
      { id: "l1", type: "rasen", coordinates: [m(0, 0), m(1, 0), m(1, 1), m(0, 1)] },
    ];
    const { areas, assumptions } = buildManagementAreas(lawns);
    assert.equal(areas.length, 1);
    assert.equal(areas[0].scheduleGroupId, "SG-LAWN");
    assert.ok(assumptions.some((a) => /Sonne|Boden|sun/i.test(a)));
  });

  it("compatibility separates strip from spray", () => {
    const heads = [
      head("s1", 0, 0, 4),
      head("st1", 3, 0, 4, { kind: "strip", configKey: "LCS-500" }),
    ];
    const groups = buildHeadCompatibilityGroups(
      heads,
      buildManagementAreas([
        { id: "lawn1", type: "rasen", coordinates: [m(0, 0), m(5, 0), m(5, 5), m(0, 5)] },
      ]).areas,
      m(0, 0),
    );
    assert.ok(groups.size >= 2);
  });
});

describe("v3 manifold kit", () => {
  it("zoneCount=3 → Verteiler with outlets ≥ 3", () => {
    const kit = selectManifoldKit(3);
    assert.equal(kit.outletsNeeded, 3);
    assert.ok(kit.articles.length >= 1);
    assert.ok(kit.valveBoxQty >= 1);
    assert.match(kit.note, /3 Zonen/);
    const verteilerLines = kit.lines.filter((l) => l.key.startsWith("verteiler-"));
    assert.ok(verteilerLines.length >= 1);
    const outlets = verteilerLines.reduce((s, l) => {
      const m = l.label.match(/(\d+)-fach/);
      return s + (m ? Number(m[1]) * l.qty : 0);
    }, 0);
    assert.ok(outlets >= 3, `outlets=${outlets}`);
  });

  it("zoneCount=1 still includes Ventilkasten", () => {
    const kit = selectManifoldKit(1);
    assert.ok(kit.lines.some((l) => l.key === "valvebox"));
  });
});
