/** Geometry helpers for dragging sprinkler radius / sector handles on the plan. */

export function wrapDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function clockwiseDelta(fromDeg: number, toDeg: number): number {
  return wrapDeg(toDeg - fromDeg);
}

/** Screen delta → bearing: 0 = north (up), clockwise. */
export function screenBearingDeg(dx: number, dy: number): number {
  return wrapDeg((Math.atan2(dx, -dy) * 180) / Math.PI);
}

export function sectorEdges(
  rotationDeg: number,
  arcDeg: number,
): { start: number; end: number } {
  const half = arcDeg / 2;
  return {
    start: wrapDeg(rotationDeg - half),
    end: wrapDeg(rotationDeg + half),
  };
}

export function polarScreen(
  cx: number,
  cy: number,
  radiusPx: number,
  bearingDeg: number,
): { x: number; y: number } {
  const a = ((bearingDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radiusPx * Math.cos(a),
    y: cy + radiusPx * Math.sin(a),
  };
}

/**
 * Drag one sector edge; the other edge stays put. Arc is clockwise start→end
 * and clamped to the datasheet.
 */
export function patchFromDraggedEdge(opts: {
  which: "start" | "end";
  bearingDeg: number;
  otherEdgeDeg: number;
  arcMinDeg: number;
  arcMaxDeg: number;
}): { rotationDeg: number; arcDeg: number } {
  const aMin = Math.max(1, opts.arcMinDeg);
  const aMax = Math.max(aMin, opts.arcMaxDeg);
  let start: number;
  let arc: number;
  if (opts.which === "start") {
    const end = wrapDeg(opts.otherEdgeDeg);
    arc = Math.min(
      aMax,
      Math.max(aMin, clockwiseDelta(opts.bearingDeg, end)),
    );
    start = wrapDeg(end - arc);
  } else {
    start = wrapDeg(opts.otherEdgeDeg);
    arc = Math.min(
      aMax,
      Math.max(aMin, clockwiseDelta(start, opts.bearingDeg)),
    );
  }
  return {
    arcDeg: arc,
    rotationDeg: wrapDeg(start + arc / 2),
  };
}
