import assert from "node:assert/strict";
import test from "node:test";
import {
  clockwiseDelta,
  patchFromDraggedEdge,
  screenBearingDeg,
  sectorEdges,
  wrapDeg,
} from "./sectorEdit";

test("sectorEdges: 90° facing north", () => {
  const e = sectorEdges(0, 90);
  assert.equal(e.start, 315);
  assert.equal(e.end, 45);
});

test("patchFromDraggedEdge keeps the opposite ray", () => {
  const { start, end } = sectorEdges(0, 90);
  const next = patchFromDraggedEdge({
    which: "end",
    bearingDeg: 90,
    otherEdgeDeg: start,
    arcMinDeg: 40,
    arcMaxDeg: 360,
  });
  assert.equal(next.arcDeg, 135);
  assert.equal(wrapDeg(next.rotationDeg), wrapDeg(start + 135 / 2));
  const pulled = patchFromDraggedEdge({
    which: "start",
    bearingDeg: 0,
    otherEdgeDeg: end,
    arcMinDeg: 40,
    arcMaxDeg: 360,
  });
  assert.equal(pulled.arcDeg, 45);
});

test("arc clamp keeps the other edge", () => {
  const next = patchFromDraggedEdge({
    which: "end",
    bearingDeg: 10,
    otherEdgeDeg: 0,
    arcMinDeg: 40,
    arcMaxDeg: 210,
  });
  assert.equal(next.arcDeg, 40);
  const wide = patchFromDraggedEdge({
    which: "end",
    bearingDeg: 0,
    otherEdgeDeg: 10,
    arcMinDeg: 40,
    arcMaxDeg: 90,
  });
  assert.equal(wide.arcDeg, 90);
});

test("screenBearingDeg: up / east / south", () => {
  assert.equal(Math.round(screenBearingDeg(0, -10)), 0);
  assert.equal(Math.round(screenBearingDeg(10, 0)), 90);
  assert.equal(Math.round(screenBearingDeg(0, 10)), 180);
});

test("clockwiseDelta wraps", () => {
  assert.equal(clockwiseDelta(350, 10), 20);
  assert.equal(clockwiseDelta(10, 350), 340);
});
