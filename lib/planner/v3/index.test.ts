import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DrawnZone, PlotFixture } from "@/lib/mapbox";
import { computeSofortPlan, computeSofortPlanV3Raw } from "../index";
import { pointInPolygon } from "./geometry";
import { layoutLawnZone } from "./layout";
import { pickPipeSize } from "./hydraulics";
import { classifyProjectLevel } from "./validation";

const ORIGIN = { lng: 11.58, lat: 48.14 };

function m(east: number, north: number) {
  const R = 6371000;
  const dLat = (north / R) * (180 / Math.PI);
  const dLng =
    (east / (R * Math.cos((ORIGIN.lat * Math.PI) / 180))) * (180 / Math.PI);
  return { lng: ORIGIN.lng + dLng, lat: ORIGIN.lat + dLat };
}

function rectLawn(w: number, h: number, id = "lawn1"): DrawnZone {
  return {
    id,
    type: "rasen",
    coordinates: [m(0, 0), m(w, 0), m(w, h), m(0, h)],
  };
}

function fixtures(flowM3h = 2.5, pressureBar?: number): PlotFixture[] {
  return [
    {
      id: "q",
      kind: "wasserquelle",
      position: m(-2, -2),
      wassermengeM3h: flowM3h,
      dynamicPressureBar: pressureBar,
    },
    {
      id: "v",
      kind: "wasserverteiler",
      position: m(-1, -1),
    },
  ];
}

describe("computeSofortPlan v3", () => {
  it("returns algorithmVersion v3 and ESTIMATE without Q–P curve", () => {
    const plan = computeSofortPlan([rectLawn(12, 8)], fixtures(2.5), {
      algorithmVersion: "v3",
      brand: "hunter",
    });
    assert.equal(plan.algorithmVersion, "v3");
    assert.equal(plan.projectLevel, "ESTIMATE");
    assert.ok(plan.heads.length > 0);
    assert.ok(
      plan.bom.some((l) => l.key === "backflow-review"),
      "backflow review line required",
    );
    assert.equal(plan.requiresBackflowProtectionReview, true);
  });

  it("raises to PRELIMINARY when flow+dynamic pressure present", () => {
    const raw = computeSofortPlanV3Raw(
      [rectLawn(12, 8)],
      fixtures(2.5, 3.2),
      { brand: "hunter" },
    );
    assert.equal(raw.hydraulicSummary.sourceCurveUsed, true);
    assert.equal(raw.projectLevel, "PRELIMINARY_ENGINEERING");
  });

  it("sizes pipe diameters on segments", () => {
    const plan = computeSofortPlan([rectLawn(14, 10)], fixtures(3), {
      algorithmVersion: "v3",
    });
    const laterals = plan.pipes.filter((p) => p.kind === "lateral");
    assert.ok(laterals.length > 0);
    assert.ok(laterals.every((p) => p.odMm === 25 || p.odMm === 32));
  });

  it("L-shape keeps heads outside Gebäude", () => {
    const lawn: DrawnZone = {
      id: "L",
      type: "rasen",
      coordinates: [
        m(0, 0),
        m(16, 0),
        m(16, 6),
        m(6, 6),
        m(6, 14),
        m(0, 14),
      ],
    };
    const bldg: DrawnZone = {
      id: "b",
      type: "gebaeude",
      coordinates: [m(7, 7), m(15, 7), m(15, 13), m(7, 13)],
    };
    const plan = computeSofortPlan([lawn, bldg], fixtures(3), {
      algorithmVersion: "v3",
      brand: "hunter",
    });
    const origin = lawn.coordinates[0];
    // crude: none of head positions inside building bbox in lng/lat
    for (const h of plan.heads) {
      const inside =
        h.position.lng > bldg.coordinates[0].lng &&
        h.position.lng < bldg.coordinates[1].lng &&
        h.position.lat > bldg.coordinates[0].lat &&
        h.position.lat < bldg.coordinates[2].lat;
      assert.equal(inside, false, `head ${h.id} inside building`);
    }
    void origin;
  });

  it("narrow strip uses strip emitters", () => {
    const strip = rectLawn(12, 1.8);
    const res = layoutLawnZone(strip, [], "hunter");
    assert.ok(res.heads.length > 0);
    assert.ok(res.heads.every((h) => h.kind === "strip"));
  });

  it("compact ~18 m² square uses spray heads, not a single strip", () => {
    const sq = rectLawn(4.24, 4.24);
    const res = layoutLawnZone(sq, [], "hunter");
    assert.ok(res.heads.length >= 4, `expected multi-head layout, got ${res.heads.length}`);
    assert.ok(
      res.heads.every((h) => h.kind !== "strip"),
      "compact square must not be classified as Streifen",
    );
  });

  it("edge heads stay ≤180° (no 195° overspray inflate)", () => {
    const res = layoutLawnZone(rectLawn(8, 6), [], "hunter");
    const edgeLike = res.heads.filter((h) => h.arcDeg >= 150 && h.arcDeg < 300);
    assert.ok(edgeLike.length > 0, "expected mid-edge heads");
    assert.ok(
      edgeLike.every((h) => h.arcDeg <= 180),
      `edge arcs too wide: ${edgeLike.map((h) => h.arcDeg).join(",")}`,
    );
  });

  it("compact ~25 m² square uses corner heads only (no mid-edge 180°)", () => {
    const res = layoutLawnZone(rectLawn(5, 5), [], "hunter");
    const midEdge = res.heads.filter((h) => h.arcDeg >= 150 && h.arcDeg <= 200);
    assert.equal(midEdge.length, 0, "compact square should skip mid-edge 180°");
    assert.ok(res.heads.length >= 4);
    assert.ok(res.heads.some((h) => h.arcDeg > 0 && h.arcDeg < 150));
  });

  it("Hunter vs Rain Bird produce different layout keys", () => {
    const zones = [rectLawn(15, 10)];
    const fx = fixtures(3);
    const h = computeSofortPlan(zones, fx, {
      algorithmVersion: "v3",
      brand: "hunter",
    });
    const r = computeSofortPlan(zones, fx, {
      algorithmVersion: "v3",
      brand: "rainbird",
    });
    const hKeys = h.heads.map((x) => x.configKey).sort().join(",");
    const rKeys = r.heads.map((x) => x.configKey).sort().join(",");
    assert.notEqual(hKeys, rKeys);
  });

  it("pickPipeSize respects velocity cap", () => {
    const small = pickPipeSize(5, 10);
    assert.ok(small.odMm >= 25);
    const big = pickPipeSize(80, 40);
    assert.equal(big.odMm, 32);
  });

  it("classifyProjectLevel never INSTALL_READY without approvals", () => {
    const level = classifyProjectLevel({
      assumedFlow: false,
      sourceCurveUsed: true,
      hasHeights: true,
      scaleConfirmed: true,
      blockers: [],
      backflowApproved: false,
    });
    assert.equal(level, "PRELIMINARY_ENGINEERING");
  });
});

describe("v3 geometry helpers", () => {
  it("pointInPolygon basic", () => {
    const ring = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    assert.equal(pointInPolygon({ x: 5, y: 5 }, ring), true);
    assert.equal(pointInPolygon({ x: 15, y: 5 }, ring), false);
  });
});

describe("planner catalog performance tables", () => {
  it("R-VAN14 keeps multi-pressure rows and precip", async () => {
    const { brandEmitters } = await import("../catalog");
    const { resolveSprayAtPressure } = await import("./performance");
    const nz = brandEmitters("rainbird").sprayHead.nozzles["R-VAN14"];
    assert.ok((nz.performance?.length ?? 0) >= 6);
    assert.equal(nz.pressureMinBar, 2.1);
    assert.equal(nz.pressureMaxBar, 3.8);
    assert.ok((nz.precipMmH ?? 0) >= 15);
    const low = resolveSprayAtPressure({
      brand: "rainbird",
      familyKey: "R-VAN14",
      pressureBar: 2.1,
      arcDeg: 270,
    });
    const high = resolveSprayAtPressure({
      brand: "rainbird",
      familyKey: "R-VAN14",
      pressureBar: 3.4,
      arcDeg: 270,
    });
    assert.ok(low && high);
    assert.ok(high!.radiusM > low!.radiusM);
    assert.ok(Math.abs(low!.radiusM - 4.0) < 0.15);
    assert.ok(Math.abs(high!.radiusM - 4.6) < 0.15);
  });

  it("I-20 options span multiple pressures", async () => {
    const { brandEmitters } = await import("../catalog");
    const opts = brandEmitters("hunter").rotor.options;
    const pressures = new Set(opts.map((o) => o.pressureBar));
    assert.ok(pressures.size >= 5);
    assert.ok(opts.some((o) => o.nozzle === "2.0" && o.pressureBar === 2.5));
  });
});
