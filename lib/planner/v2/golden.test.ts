import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DrawnZone, PlotFixture } from "@/lib/mapbox";
import { computeSofortPlan } from "../index";

/** Small golden set (§17.1 subset) — smoke invariants for v2. */
const ORIGIN = { lng: 11.58, lat: 48.14 };

function m(east: number, north: number) {
  const R = 6371000;
  const dLat = (north / R) * (180 / Math.PI);
  const dLng =
    (east / (R * Math.cos((ORIGIN.lat * Math.PI) / 180))) * (180 / Math.PI);
  return { lng: ORIGIN.lng + dLng, lat: ORIGIN.lat + dLat };
}

function fx(): PlotFixture[] {
  return [
    {
      id: "q",
      kind: "wasserquelle",
      position: m(-2, -2),
      wassermengeM3h: 2.5,
      dynamicPressureBar: 3.0,
    },
    { id: "v", kind: "wasserverteiler", position: m(-1, -1) },
  ];
}

const CASES: Array<{ name: string; zones: DrawnZone[] }> = [
  {
    name: "rectangle",
    zones: [
      {
        id: "r",
        type: "rasen",
        coordinates: [m(0, 0), m(12, 0), m(12, 8), m(0, 8)],
      },
    ],
  },
  {
    name: "triangle",
    zones: [
      {
        id: "t",
        type: "rasen",
        coordinates: [m(0, 0), m(14, 0), m(7, 10)],
      },
    ],
  },
  {
    name: "U-shape",
    zones: [
      {
        id: "u",
        type: "rasen",
        coordinates: [
          m(0, 0),
          m(14, 0),
          m(14, 10),
          m(10, 10),
          m(10, 3),
          m(4, 3),
          m(4, 10),
          m(0, 10),
        ],
      },
    ],
  },
];

describe("v2 golden set smoke", () => {
  for (const c of CASES) {
    it(`${c.name}: runs without crash and places heads`, () => {
      const plan = computeSofortPlan(c.zones, fx(), {
        algorithmVersion: "v2",
        brand: "hunter",
      });
      assert.equal(plan.algorithmVersion, "v2");
      assert.ok(plan.heads.length >= 1);
      assert.ok(plan.coveragePct >= 0);
      assert.ok(plan.confidence != null && plan.confidence > 0);
      assert.ok(plan.metrics?.binaryCoveragePct != null);
    });
  }
});
