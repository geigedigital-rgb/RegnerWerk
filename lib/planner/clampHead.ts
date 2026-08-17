import type { SprinklerBrand } from "./catalog";
import { resolveHeadProduct } from "./v1/headProduct";
import type { SprinklerHead } from "./types";

export type HeadGeometryPatch = Partial<
  Pick<SprinklerHead, "radiusM" | "arcDeg" | "rotationDeg" | "position">
>;

function wrapDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Clamp radius / arc / rotation to the installed nozzle or rotor datasheet. */
export function clampHeadGeometry(
  head: SprinklerHead,
  brand: SprinklerBrand,
  patch: HeadGeometryPatch = {},
): SprinklerHead {
  const next: SprinklerHead = { ...head, ...patch };
  const info = resolveHeadProduct(next, brand);

  next.rotationDeg = Math.round(wrapDeg(next.rotationDeg));

  if (head.kind === "strip") {
    next.arcDeg = 0;
    next.radiusM = head.radiusM;
    next.stripWidthM = info.stripWidthM ?? head.stripWidthM;
    next.stripLengthM = info.stripLengthM ?? head.stripLengthM;
    return next;
  }

  const rMin = info.radiusMinM ?? Math.min(head.radiusM, 0.5);
  const rMax = info.radiusMaxM ?? head.radiusM;
  next.radiusM = Number(
    Math.min(rMax, Math.max(rMin, next.radiusM)).toFixed(1),
  );

  const aMin = info.arcMinDeg ?? 40;
  const aMax = info.arcMaxDeg ?? 360;
  if (aMin >= 360 && aMax >= 360) {
    next.arcDeg = 360;
  } else {
    const stepped = Math.round(next.arcDeg / 5) * 5;
    next.arcDeg = Math.min(aMax, Math.max(aMin, stepped));
  }

  return next;
}
