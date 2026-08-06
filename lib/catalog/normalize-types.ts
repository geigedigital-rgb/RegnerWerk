/**
 * Shared types for RegnerWerk catalog normalization (TZ §4–§13).
 * Source of truth for scripts that emit data/catalog/normalized/*.json
 */

/** Display names — German only (catalog locale). */
export type LocaleName = { de: string };

export type PerformanceTableRow = Record<string, number | string | null>;

export type PerformanceTable = {
  table_id: string;
  table_type: "pressure_loss" | "radius_flow" | "precipitation" | "other";
  model_key: string | null;
  units: Record<string, string>;
  columns: string[];
  rows: PerformanceTableRow[];
  notes: string[];
  provenance: {
    source_type: string;
    source_url: string | null;
    document_title: string | null;
    page: number | null;
  };
};

export type FieldStatus =
  | "confirmed"
  | "derived"
  | "not_found"
  | "not_applicable"
  | "conflict"
  | "needs_review";

export type DataType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "enum"
  | "object"
  | "array"
  | "performance_table"
  | "product_reference";

export type CalculationRole =
  | "none"
  | "geometry"
  | "hydraulic"
  | "compatibility"
  | "electrical"
  | "bill_of_materials"
  | "control_logic";

export type ConnectionType =
  | "pe_compression"
  | "barbed"
  | "spx_flex"
  | "bsp_thread"
  | "npt_thread"
  | "hose"
  | "push_fit"
  | "solvent_socket"
  | "electrical_wire"
  | "proprietary";

export type AttributeDef = {
  attribute_id: string;
  name: LocaleName;
  data_type: DataType;
  unit: string | null;
  required: boolean;
  nullable: boolean;
  multiple: boolean;
  allowed_values: string[] | null;
  minimum: number | null;
  maximum: number | null;
  calculation_role: CalculationRole;
  critical_for_calculation: boolean;
  description: string;
  example: string | number | boolean | null;
};

export type GroupSchema = {
  group_id: string;
  section_id: string;
  name: LocaleName;
  description: string;
  allowed_subtypes: string[];
  attributes: AttributeDef[];
  calculation_roles: CalculationRole[];
};

export type ConnectionPort = {
  port_id: string;
  role: "inlet" | "outlet" | "bidirectional" | "nozzle_seat" | "side";
  connection_type: ConnectionType;
  nominal_size_mm: number | null;
  thread_size_inch: string | null;
  thread_gender: "IG" | "AG" | "not_applicable" | null;
  thread_standard: "BSP" | "NPT" | "not_applicable" | null;
};

export type NormalizedProduct = {
  product_id: string;
  parent_product_id: string | null;
  article: string | null;
  manufacturer: string | null;
  brand: string | null;
  series: string | null;
  model: string | null;
  name: LocaleName;
  group_id: string;
  subtype_id: string;
  unit: "piece" | "meter" | "roll" | "set";
  package_quantity: number | null;
  lifecycle_status: "active" | "discontinued" | "unknown";
  attributes: Record<string, unknown>;
  connections: ConnectionPort[];
  performance_tables: PerformanceTable[];
  compatibility: {
    compatible_product_ids: string[];
    compatible_group_ids: string[];
    incompatible_product_ids: string[];
    requirements: string[];
  };
  bom: unknown[];
  media: {
    images: string[];
    documents: { title: string; url: string }[];
  };
  source: {
    source_record_id: string;
    source_name: string;
    source_url: string;
    source_category: string;
    source_title: string;
    source_variant: string | null;
  };
  field_status: Record<string, FieldStatus>;
  provenance: Record<
    string,
    {
      source_type: string;
      source_url: string | null;
      document_title: string | null;
      page: number | null;
    }
  >;
  quality: {
    classification_confidence: number;
    extraction_confidence: number;
    calculation_ready: boolean;
    needs_review: boolean;
    warnings: string[];
  };
};
