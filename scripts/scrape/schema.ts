/**
 * Zod schema for the AI extraction payload — the part of `Product`
 * (lib/catalog/types.ts) that the LLM derives from rawText.
 * Identity/price/image fields are copied from raw data directly.
 */
import { z } from "zod";

export const productKindSchema = z.enum([
  "rotor",
  "spray",
  "nozzle",
  "valve",
  "controller",
  "controller-module",
  "wifi-module",
  "sensor",
  "decoder",
  "pipe",
  "flex-pipe",
  "swing-joint",
  "drip-line",
  "drip-accessory",
  "fitting",
  "valve-box",
  "filter",
  "pressure-regulator",
  "pump",
  "tool",
  "accessory",
  "other",
]);

const threadSizeSchema = z.enum(['1/2"', '3/4"', '1"', '1 1/4"', '1 1/2"', '2"']);
const portRoleSchema = z.enum(["inlet", "outlet", "side", "universal"]);

export const portSpecSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("thread"),
    size: threadSizeSchema,
    gender: z.enum(["IG", "AG"]),
    role: portRoleSchema.optional(),
    count: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("pe-clamp"),
    diameterMm: z.number().positive(),
    role: portRoleSchema.optional(),
    count: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("barb"),
    diameterMm: z.number().positive(),
    role: portRoleSchema.optional(),
    count: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("drip-lock"),
    diameterMm: z.number().positive(),
    role: portRoleSchema.optional(),
    count: z.number().int().positive().optional(),
  }),
]);

export const productSpecsSchema = z
  .object({
    riserHeightCm: z.number(),
    throwRadiusMinM: z.number(),
    throwRadiusMaxM: z.number(),
    arcMinDeg: z.number(),
    arcMaxDeg: z.number(),
    fullCircle: z.boolean(),
    pressureMinBar: z.number(),
    pressureMaxBar: z.number(),
    flowMinM3h: z.number(),
    flowMaxM3h: z.number(),
    hasSAM: z.boolean(),
    hasPRS: z.boolean(),
    stainlessRiser: z.boolean(),
    nozzlesIncluded: z.boolean(),
    precipRateMmH: z.number(),
    voltage: z.enum(["24VAC", "9VDC"]),
    withFlowControl: z.boolean(),
    stationsBase: z.number().int(),
    stationsMax: z.number().int(),
    stationsAdded: z.number().int(),
    wifi: z.boolean(),
    outdoor: z.boolean(),
    compatibleWith: z.array(z.string()),
    diameterMm: z.number(),
    pressureRatingBar: z.number(),
    lengthM: z.number(),
    soldByMeter: z.boolean(),
    emitterSpacingCm: z.number(),
    emitterFlowLh: z.number(),
    fittingShape: z.enum([
      "elbow",
      "tee",
      "coupler",
      "adapter",
      "end-cap",
      "reducer",
      "manifold",
      "other",
    ]),
    boxValveCapacity: z.number().int(),
    boxDiameterMm: z.number(),
    boxLengthMm: z.number(),
    boxWidthMm: z.number(),
    boxHeightMm: z.number(),
    material: z.string(),
    seriesCompatibility: z.array(z.string()),
  })
  .partial();

/** What the LLM must return for one product. */
export const extractionSchema = z.object({
  displayName: z.string().min(3),
  kind: productKindSchema,
  manufacturerNr: z.string().nullable(),
  series: z.string().nullable(),
  brand: z.string(),
  ports: z.array(portSpecSchema),
  specs: productSpecsSchema,
  summary: z.string().min(10),
});

export type Extraction = z.infer<typeof extractionSchema>;
