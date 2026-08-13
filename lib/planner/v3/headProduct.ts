/**
 * Resolve a Sofort head configKey to catalog product info (image, ranges).
 * Images come from planner-catalog.json (sourced from RegnerWerk_universal.json).
 */
import {
  CATALOG,
  brandEmitters,
  DEFAULT_BRAND,
  type SprinklerBrand,
} from "../catalog";
import type { SprinklerHead } from "../types";

export type HeadProductInfo = {
  configKey: string;
  title: string;
  article: string | null;
  imageUrl: string | null;
  bodyLabel: string;
  radiusMinM: number | null;
  radiusMaxM: number | null;
  arcMinDeg: number | null;
  arcMaxDeg: number | null;
  note: string;
  radiusInSpec: boolean;
  arcInSpec: boolean;
};

function imageFor(key: string, brand: SprinklerBrand): string | null {
  const imgs = CATALOG.images ?? {};
  if (imgs[key]) return imgs[key];
  const base = key.replace(/-360$/, "").replace(/@.*$/, "");
  return (
    imgs[base] ??
    imgs[brand === "hunter" ? "PROS-04" : "1804"] ??
    null
  );
}

function nozzleBase(configKey: string): string {
  if (configKey.startsWith("3504") || configKey.startsWith("I-20")) {
    return configKey.split("@")[0];
  }
  return configKey.replace(/-360$/, "");
}

export function resolveHeadProduct(
  head: SprinklerHead,
  brand: SprinklerBrand = DEFAULT_BRAND,
): HeadProductInfo {
  const emitters = brandEmitters(brand);
  const key = head.configKey;
  const base = nozzleBase(key);

  if (head.kind === "rotor" || key.startsWith("3504") || key.startsWith("I-20")) {
    return {
      configKey: key,
      title: emitters.rotor.label,
      article: emitters.rotor.article,
      imageUrl: imageFor(brand === "hunter" ? "I-20" : "3504", brand),
      bodyLabel: emitters.rotor.label,
      radiusMinM: emitters.rotor.radiusMinM,
      radiusMaxM: emitters.rotor.radiusMaxM,
      arcMinDeg: emitters.rotor.arcMinDeg,
      arcMaxDeg: emitters.rotor.arcMaxDeg,
      note: "Getrieberegner — Düsengröße aus beiliegendem Düsensatz.",
      radiusInSpec:
        head.radiusM >= emitters.rotor.radiusMinM &&
        head.radiusM <= emitters.rotor.radiusMaxM,
      arcInSpec:
        head.arcDeg >= emitters.rotor.arcMinDeg &&
        head.arcDeg <= emitters.rotor.arcMaxDeg,
    };
  }

  if (head.kind === "strip") {
    const strip =
      emitters.sprayHead.strips[key] ?? emitters.sprayHead.strips[base];
    return {
      configKey: key,
      title: key,
      article: emitters.sprayHead.setArticle,
      imageUrl: imageFor(key, brand) ?? imageFor(base, brand),
      bodyLabel: emitters.sprayHead.bodyLabel,
      radiusMinM: null,
      radiusMaxM: null,
      arcMinDeg: null,
      arcMaxDeg: null,
      note: strip
        ? `Streifendüse ${strip.widthM}×${strip.lengthM} m (Herstellermaß).`
        : "Streifendüse.",
      radiusInSpec: true,
      arcInSpec: true,
    };
  }

  const spec = emitters.sprayHead.nozzles[base];
  return {
    configKey: key,
    title: base,
    article: emitters.sprayHead.setArticle,
    imageUrl: imageFor(base, brand),
    bodyLabel: emitters.sprayHead.bodyLabel,
    radiusMinM: spec?.radiusMinM ?? null,
    radiusMaxM: spec?.radiusMaxM ?? null,
    arcMinDeg: spec?.arcMinDeg ?? null,
    arcMaxDeg: spec?.arcMaxDeg ?? null,
    note:
      brand === "hunter"
        ? "PROS-04-PRS40-CV + MP Rotator — Wurfweite laut Herstellerblatt."
        : "Vollkreis-Düse (360°) auf 1804-SAM-PRS-45 (3,1 bar) — Wurfweite laut Herstellerblatt.",
    radiusInSpec: spec
      ? head.radiusM >= spec.radiusMinM && head.radiusM <= spec.radiusMaxM
      : true,
    arcInSpec: spec
      ? head.arcDeg >= spec.arcMinDeg && head.arcDeg <= spec.arcMaxDeg
      : true,
  };
}
