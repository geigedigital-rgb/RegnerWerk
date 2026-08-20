import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countRouteElbowsByOd,
  mainOdFromPipes,
  manifoldInletAdapter,
  peElbowPart,
  spliceConnectorQty,
  sourcePeAdapter,
  wireMetersWithSpare,
} from "./bomRules";
import { buildBom } from "./v3/bom";
import type { PipeRun, SprinklerHead } from "./types";

describe("bomRules", () => {
  it("DBRY qty is zone wires + common", () => {
    assert.equal(spliceConnectorQty(0), 0);
    assert.equal(spliceConnectorQty(1), 2);
    assert.equal(spliceConnectorQty(4), 5);
  });

  it("main OD prefers main pipes and drives adapters", () => {
    const pe25Main: PipeRun[] = [
      {
        id: "m",
        kind: "main",
        hydraulicZone: null,
        lengthM: 12,
        odMm: 25,
        points: [
          { lng: 0, lat: 0 },
          { lng: 0.0001, lat: 0 },
        ],
      },
    ];
    assert.equal(mainOdFromPipes(pe25Main), 25);
    assert.equal(manifoldInletAdapter(25).odMm, 25);
    assert.equal(manifoldInletAdapter(25).part.article, "1.05-K34");
    assert.equal(sourcePeAdapter(25).part.article, "1.04-K13");
    assert.equal(manifoldInletAdapter(32).part.article, "1.05-K37");
    assert.equal(sourcePeAdapter(32).part.article, "1.04-K16");
  });

  it("wire spare is ~10%", () => {
    assert.equal(wireMetersWithSpare(10), 11);
    assert.equal(wireMetersWithSpare(1), 5);
  });

  it("counts PE elbows only on polyline bends", () => {
    assert.equal(peElbowPart(25)?.article, "1.00-W03");
    assert.equal(peElbowPart(32)?.article, "1.00-W04");
    const straight: PipeRun[] = [
      {
        id: "m",
        kind: "main",
        hydraulicZone: null,
        lengthM: 14,
        odMm: 32,
        points: [
          { lng: 0, lat: 0 },
          { lng: 0.0002, lat: 0 },
        ],
      },
    ];
    assert.equal(countRouteElbowsByOd(straight).get(32) ?? 0, 0);
    const bent: PipeRun[] = [
      {
        id: "m",
        kind: "main",
        hydraulicZone: null,
        lengthM: 20,
        odMm: 32,
        points: [
          { lng: 0, lat: 0 },
          { lng: 0.00015, lat: 0 },
          { lng: 0.00015, lat: 0.00012 },
        ],
      },
    ];
    assert.equal(countRouteElbowsByOd(bent).get(32), 1);
  });
});

describe("buildBom v3 critical fixes", () => {
  const heads: SprinklerHead[] = Array.from({ length: 2 }, (_, i) => ({
    id: `h${i}`,
    kind: "spray" as const,
    configKey: "R-VAN14",
    position: { lng: i * 0.0001, lat: 0 },
    arcDeg: 90,
    rotationDeg: 0,
    radiusM: 4,
    flowLMin: 5,
    lawnZoneId: "lawn-1",
    hydraulicZone: 1,
    lineEnd: i === 0,
  }));

  it("PE25 system does not emit PE32 manifold adapter; DBRY=5 for 4 zones; PRS in label", () => {
    const pipes: PipeRun[] = [
      {
        id: "main",
        kind: "main",
        hydraulicZone: null,
        lengthM: 8,
        odMm: 25,
        points: [
          { lng: 0, lat: 0 },
          { lng: 0.0001, lat: 0 },
        ],
      },
      {
        id: "lat",
        kind: "lateral",
        hydraulicZone: 1,
        lengthM: 20,
        odMm: 25,
        points: [
          { lng: 0.0001, lat: 0 },
          { lng: 0.0001, lat: 0.0002 },
        ],
      },
    ];
    const { bom } = buildBom({
      heads,
      pipes,
      zoneCount: 4,
      wireLengthM: 15,
      dripTubeLengthM: 0,
      brand: "rainbird",
    });

    const labels = bom.map((l) => l.label).join("\n");
    assert.match(labels, /1804-SAM-PRS-45/);
    assert.ok(!bom.some((l) => /PE 32 → Verteiler/i.test(l.label)));
    assert.ok(bom.some((l) => /PE 25 → Verteiler/i.test(l.label)));
    assert.ok(bom.some((l) => /PE 25 × 1″ AG/i.test(l.label)));

    const splice = bom.find((l) => l.key === "splice");
    assert.ok(splice);
    assert.equal(splice!.qty, 5);

    assert.ok(bom.some((l) => l.key === "backflow-review"));
    assert.ok(bom.some((l) => l.key === "winter-drain"));
    assert.ok(bom.some((l) => l.key === "source-adapter-pe25"));
    assert.ok(!bom.some((l) => l.key === "controller-power-review"));
    assert.ok(!bom.some((l) => l.key === "route-fittings-review"));
    const seal = bom.find((l) => l.key === "thread-seal");
    assert.ok(seal?.article === "Teflon_1" && seal.priceEur != null);
    const filter = bom.find((l) => l.key === "source-filter");
    assert.ok(filter?.article === "5.02-SF19" && filter.priceEur != null);
  });

  it("adds priced PE elbow when main has a 90° bend", () => {
    const pipes: PipeRun[] = [
      {
        id: "main",
        kind: "main",
        hydraulicZone: null,
        lengthM: 20,
        odMm: 32,
        points: [
          { lng: 0, lat: 0 },
          { lng: 0.00015, lat: 0 },
          { lng: 0.00015, lat: 0.00012 },
        ],
      },
      {
        id: "lat",
        kind: "lateral",
        hydraulicZone: 1,
        lengthM: 10,
        odMm: 25,
        points: [
          { lng: 0.00015, lat: 0.00012 },
          { lng: 0.00015, lat: 0.0002 },
        ],
      },
    ];
    const { bom } = buildBom({
      heads,
      pipes,
      zoneCount: 2,
      wireLengthM: 12,
      dripTubeLengthM: 0,
      brand: "rainbird",
    });
    const elbow = bom.find((l) => l.key === "pe-elbow-32");
    assert.ok(elbow);
    assert.equal(elbow!.article, "1.00-W04");
    assert.equal(elbow!.qty, 1);
    assert.ok(elbow!.priceEur != null && elbow!.priceEur > 0);
  });

  it("picks PE32 disc filter and VENT-EG for 6 zones", () => {
    const pipes: PipeRun[] = [
      {
        id: "main",
        kind: "main",
        hydraulicZone: null,
        lengthM: 20,
        odMm: 32,
        points: [
          { lng: 0, lat: 0 },
          { lng: 0.0002, lat: 0 },
        ],
      },
      {
        id: "lat",
        kind: "lateral",
        hydraulicZone: 1,
        lengthM: 30,
        odMm: 25,
        points: [
          { lng: 0.0002, lat: 0 },
          { lng: 0.0002, lat: 0.0002 },
        ],
      },
    ];
    const { bom } = buildBom({
      heads,
      pipes,
      zoneCount: 6,
      wireLengthM: 20,
      dripTubeLengthM: 0,
      brand: "rainbird",
    });
    const filter = bom.find((l) => l.key === "source-filter");
    assert.equal(filter?.article, "5.02-SF20");
    const box = bom.find((l) => l.key === "valvebox");
    assert.equal(box?.article, "VENT-EG");
    assert.equal(box?.qty, 1);
  });
});
