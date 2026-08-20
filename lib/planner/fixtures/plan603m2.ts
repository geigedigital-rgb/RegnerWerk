/**
 * Reference geometry for the 603 m² demo plan.
 * Source: logika-konfiguratora-603m2.md + rasstanovka-603m2.html
 * Expected layout: 27 heads (21 boundary + 6×360°), families from catalog at runtime.
 */
import type { DrawnZone, PlotFixture } from "@/lib/mapbox";

const PX_PER_M = 22.88;
const ORIGIN_PX = { x: 52, y: 59 };

function pxToM(xPx: number, yPx: number) {
  return {
    x: (xPx - ORIGIN_PX.x) / PX_PER_M,
    y: (yPx - ORIGIN_PX.y) / PX_PER_M,
  };
}

const ORIGIN = { lng: 11.58, lat: 48.14 };

function mToLngLat(eastM: number, northM: number) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  return {
    lng: ORIGIN.lng + eastM / (R * toRad * Math.cos(ORIGIN.lat * toRad)),
    lat: ORIGIN.lat + northM / (R * toRad),
  };
}

const lawnPx: Array<[number, number]> = [
  [52, 59],
  [241, 57],
  [247, 511],
  [670, 507],
  [668, 731],
  [569, 897],
  [408, 965],
  [257, 965],
  [147, 912],
  [84, 688],
];

const buildingPx: Array<[number, number]> = [
  [241, 57],
  [1001, 41],
  [1006, 505],
  [670, 507],
  [247, 511],
];

export const PLAN_603M2_FINGERPRINT_NOTE =
  "Use geometrySummary() on export — expect lawn ≈603 m², building ≈670 m².";

export const plan603m2Zones: DrawnZone[] = [
  {
    id: "ref-lawn-603",
    type: "rasen",
    coordinates: lawnPx.map(([x, y]) => {
      const p = pxToM(x, y);
      return mToLngLat(p.x, p.y);
    }),
  },
  {
    id: "ref-building-603",
    type: "gebaeude",
    coordinates: buildingPx.map(([x, y]) => {
      const p = pxToM(x, y);
      return mToLngLat(p.x, p.y);
    }),
  },
];

export const plan603m2Fixtures: PlotFixture[] = [
  {
    id: "ref-q",
    kind: "wasserquelle",
    position: mToLngLat(-2, -2),
    wassermengeM3h: 2,
  },
  {
    id: "ref-v",
    kind: "wasserverteiler",
    position: mToLngLat(0, 0),
  },
];

/** Reference targets from geometry-only HTML (not catalog SKUs). */
export const plan603m2Reference = {
  headCount: 27,
  boundaryHeadCount: 21,
  interior360Count: 6,
  targetRadiusMinM: 4.9,
  targetRadiusMaxM: 8.1,
};
