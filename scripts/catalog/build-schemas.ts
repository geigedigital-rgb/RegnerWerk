/**
 * Builds catalog_taxonomy.json + group_schemas.json per RegnerWerk TZ.
 * Does not touch data/raw/products-ai.json.
 *
 * Usage: npx tsx scripts/catalog/build-schemas.ts
 */
import fs from "node:fs/promises";
import path from "node:path";
import type {
  AttributeDef,
  CalculationRole,
  DataType,
  GroupSchema,
  LocaleName,
} from "../../lib/catalog/normalize-types";

const OUT_DIR = path.resolve(process.cwd(), "data/catalog/normalized");

function attr(
  attribute_id: string,
  name: LocaleName,
  opts: Partial<AttributeDef> & {
    data_type: DataType;
    calculation_role?: CalculationRole;
  },
): AttributeDef {
  return {
    attribute_id,
    name,
    data_type: opts.data_type,
    unit: opts.unit ?? null,
    required: opts.required ?? false,
    nullable: opts.nullable ?? true,
    multiple: opts.multiple ?? false,
    allowed_values: opts.allowed_values ?? null,
    minimum: opts.minimum ?? null,
    maximum: opts.maximum ?? null,
    calculation_role: opts.calculation_role ?? "none",
    critical_for_calculation: opts.critical_for_calculation ?? false,
    description: opts.description ?? "",
    example: opts.example ?? null,
  };
}

const n = (de: string): LocaleName => ({ de });

function group(
  group_id: string,
  section_id: string,
  name: LocaleName,
  description: string,
  allowed_subtypes: string[],
  attributes: AttributeDef[],
  calculation_roles: CalculationRole[],
): GroupSchema {
  return {
    group_id,
    section_id,
    name,
    description,
    allowed_subtypes,
    attributes,
    calculation_roles,
  };
}

const GROUPS: GroupSchema[] = [
  group(
    "nozzles_rotators",
    "irrigation",
    n("Düsen und Rotatoren"),
    "Wechseldüsen und Rotatoren für Sprühgehäuse und teilweise Rotoren",
    [
      "fixed_spray_nozzle",
      "adjustable_spray_nozzle",
      "rotary_nozzle",
      "strip_nozzle",
      "bubbler_nozzle",
    ],
    [
      attr("pattern_type", n("Muster"), {
        data_type: "enum",
        allowed_values: ["arc", "full_circle", "strip", "bubbler"],
        calculation_role: "geometry",
        critical_for_calculation: true,
      }),
      attr("arc_adjustable", n("Sektor einstellbar"), {
        data_type: "boolean",
        calculation_role: "geometry",
      }),
      attr("arc_min_deg", n("Sektor min."), {
        data_type: "number",
        unit: "deg",
        calculation_role: "geometry",
        critical_for_calculation: true,
        example: 45,
      }),
      attr("arc_max_deg", n("Sektor max."), {
        data_type: "number",
        unit: "deg",
        calculation_role: "geometry",
        critical_for_calculation: true,
        example: 270,
      }),
      attr("radius_min_m", n("Wurfweite min."), {
        data_type: "number",
        unit: "m",
        calculation_role: "geometry",
        critical_for_calculation: true,
        example: 2.4,
      }),
      attr("radius_max_m", n("Wurfweite max."), {
        data_type: "number",
        unit: "m",
        calculation_role: "geometry",
        critical_for_calculation: true,
        example: 4.6,
      }),
      attr("pressure_min_bar", n("Druck min."), {
        data_type: "number",
        unit: "bar",
        calculation_role: "hydraulic",
        critical_for_calculation: true,
      }),
      attr("pressure_max_bar", n("Druck max."), {
        data_type: "number",
        unit: "bar",
        calculation_role: "hydraulic",
        critical_for_calculation: true,
      }),
      attr("pressure_recommended_bar", n("Empfohlener Druck"), {
        data_type: "number",
        unit: "bar",
        calculation_role: "hydraulic",
      }),
      attr("precipitation_rate_mm_h", n("Niederschlagsrate"), {
        data_type: "number",
        unit: "mm_h",
        calculation_role: "hydraulic",
      }),
      attr("trajectory_deg", n("Strahlanstieg"), {
        data_type: "number",
        unit: "deg",
        calculation_role: "geometry",
      }),
      attr("strip_length_m", n("Streifenlänge"), {
        data_type: "number",
        unit: "m",
        calculation_role: "geometry",
      }),
      attr("strip_width_m", n("Streifenbreite"), {
        data_type: "number",
        unit: "m",
        calculation_role: "geometry",
      }),
      attr("nozzle_thread_type", n("Düsengewinde"), {
        data_type: "string",
        calculation_role: "compatibility",
        critical_for_calculation: true,
      }),
    ],
    ["geometry", "hydraulic", "compatibility", "bill_of_materials"],
  ),

  group(
    "spray_bodies",
    "irrigation",
    n("Versenksprühgehäuse"),
    "Pop-up-Gehäuse ohne Düse; Wurfweite/Durchfluss bestimmt die Düse",
    ["pop_up_spray_body", "shrub_adapter", "pressure_regulating_spray_body"],
    [
      attr("pop_up_height_mm", n("Aufsteigerhöhe"), {
        data_type: "number",
        unit: "mm",
        calculation_role: "geometry",
        critical_for_calculation: true,
        example: 100,
      }),
      attr("inlet_position", n("Anschlussposition"), {
        data_type: "enum",
        allowed_values: ["bottom", "side"],
        calculation_role: "compatibility",
      }),
      attr("pressure_regulator_present", n("PRS vorhanden"), {
        data_type: "boolean",
        calculation_role: "hydraulic",
      }),
      attr("regulated_pressure_bar", n("Geregelter Druck"), {
        data_type: "number",
        unit: "bar",
        calculation_role: "hydraulic",
      }),
      attr("check_valve_present", n("Auslaufsperrventil"), {
        data_type: "boolean",
        calculation_role: "hydraulic",
      }),
      attr("check_valve_max_elevation_m", n("SAM max. Höhendifferenz"), {
        data_type: "number",
        unit: "m",
        calculation_role: "hydraulic",
      }),
      attr("pressure_max_bar", n("Druck max."), {
        data_type: "number",
        unit: "bar",
        calculation_role: "hydraulic",
      }),
      attr("body_height_mm", n("Gehäusehöhe"), {
        data_type: "number",
        unit: "mm",
        calculation_role: "geometry",
      }),
      attr("body_diameter_mm", n("Gehäusedurchmesser"), {
        data_type: "number",
        unit: "mm",
        calculation_role: "geometry",
      }),
      attr("top_thread_type", n("Obergewinde"), {
        data_type: "string",
        calculation_role: "compatibility",
        critical_for_calculation: true,
      }),
    ],
    ["geometry", "hydraulic", "compatibility", "bill_of_materials"],
  ),

  group(
    "rotor_sprinklers",
    "irrigation",
    n("Getrieberegner"),
    "Getrieberegner mit Düsensatz; Leistungstabellen sind für die Berechnung erforderlich",
    ["gear_drive_rotor", "impact_sprinkler", "long_range_rotor"],
    [
      attr("arc_adjustable", n("Sektor einstellbar"), {
        data_type: "boolean",
        calculation_role: "geometry",
      }),
      attr("arc_min_deg", n("Sektor min."), {
        data_type: "number",
        unit: "deg",
        calculation_role: "geometry",
        critical_for_calculation: true,
      }),
      attr("arc_max_deg", n("Sektor max."), {
        data_type: "number",
        unit: "deg",
        calculation_role: "geometry",
        critical_for_calculation: true,
      }),
      attr("full_circle_supported", n("Vollkreis"), {
        data_type: "boolean",
        calculation_role: "geometry",
      }),
      attr("radius_min_m", n("Wurfweite min."), {
        data_type: "number",
        unit: "m",
        calculation_role: "geometry",
        critical_for_calculation: true,
      }),
      attr("radius_max_m", n("Wurfweite max."), {
        data_type: "number",
        unit: "m",
        calculation_role: "geometry",
        critical_for_calculation: true,
      }),
      attr("pressure_min_bar", n("Druck min."), {
        data_type: "number",
        unit: "bar",
        calculation_role: "hydraulic",
        critical_for_calculation: true,
      }),
      attr("pressure_max_bar", n("Druck max."), {
        data_type: "number",
        unit: "bar",
        calculation_role: "hydraulic",
        critical_for_calculation: true,
      }),
      attr("pressure_recommended_bar", n("Empfohlener Druck"), {
        data_type: "number",
        unit: "bar",
        calculation_role: "hydraulic",
      }),
      attr("pop_up_height_mm", n("Aufsteigerhöhe"), {
        data_type: "number",
        unit: "mm",
        calculation_role: "geometry",
      }),
      attr("check_valve_present", n("Auslaufsperrventil"), {
        data_type: "boolean",
        calculation_role: "hydraulic",
      }),
      attr("trajectory_deg", n("Strahlanstieg"), {
        data_type: "number",
        unit: "deg",
        calculation_role: "geometry",
      }),
      attr("stainless_riser", n("Edelstahl-Aufsteiger"), {
        data_type: "boolean",
        calculation_role: "none",
      }),
      attr("nozzles_included", n("Düsen inklusive"), {
        data_type: "boolean",
        calculation_role: "bill_of_materials",
      }),
    ],
    ["geometry", "hydraulic", "compatibility", "bill_of_materials"],
  ),

  group(
    "drip_irrigation",
    "irrigation",
    n("Tropfbewässerung"),
    "Tropfrohre, Tropfer, Mikroschläuche und Tropfbewässerungsfittings",
    ["dripline", "online_emitter", "micro_tube", "drip_fitting", "flush_end"],
    [
      attr("outer_diameter_mm", n("Außendurchmesser"), {
        data_type: "number",
        unit: "mm",
        calculation_role: "compatibility",
        critical_for_calculation: true,
      }),
      attr("inner_diameter_mm", n("Innendurchmesser"), {
        data_type: "number",
        unit: "mm",
        calculation_role: "hydraulic",
      }),
      attr("emitter_flow_l_h", n("Tropferdurchfluss"), {
        data_type: "number",
        unit: "l_h",
        calculation_role: "hydraulic",
        critical_for_calculation: true,
      }),
      attr("emitter_spacing_m", n("Tropferabstand"), {
        data_type: "number",
        unit: "m",
        calculation_role: "geometry",
        critical_for_calculation: true,
      }),
      attr("pressure_compensating", n("Druckkompensierend"), {
        data_type: "boolean",
        calculation_role: "hydraulic",
      }),
      attr("pressure_min_bar", n("Druck min."), {
        data_type: "number",
        unit: "bar",
        calculation_role: "hydraulic",
      }),
      attr("pressure_max_bar", n("Druck max."), {
        data_type: "number",
        unit: "bar",
        calculation_role: "hydraulic",
      }),
      attr("coil_length_m", n("Rollenlänge"), {
        data_type: "number",
        unit: "m",
        calculation_role: "bill_of_materials",
      }),
      attr("sold_by_meter", n("Meterware"), {
        data_type: "boolean",
        calculation_role: "bill_of_materials",
      }),
    ],
    ["geometry", "hydraulic", "compatibility", "bill_of_materials"],
  ),

  group(
    "pressure_pipes",
    "hydraulics",
    n("Druckrohre"),
    "PE/PVC-Druckrohre; für Hydraulik ist der Innendurchmesser erforderlich",
    ["pe_pressure_pipe", "pe_soft_pipe", "pvc_pressure_pipe"],
    [
      attr("material", n("Material"), {
        data_type: "string",
        calculation_role: "compatibility",
        required: true,
      }),
      attr("outer_diameter_mm", n("Außendurchmesser"), {
        data_type: "number",
        unit: "mm",
        calculation_role: "compatibility",
        critical_for_calculation: true,
        required: true,
      }),
      attr("wall_thickness_mm", n("Wandstärke"), {
        data_type: "number",
        unit: "mm",
        calculation_role: "hydraulic",
      }),
      attr("internal_diameter_mm", n("Innendurchmesser"), {
        data_type: "number",
        unit: "mm",
        calculation_role: "hydraulic",
        critical_for_calculation: true,
      }),
      attr("sdr", n("SDR"), {
        data_type: "number",
        calculation_role: "hydraulic",
      }),
      attr("pressure_rating_bar", n("Nenndruck"), {
        data_type: "number",
        unit: "bar",
        calculation_role: "compatibility",
        critical_for_calculation: true,
      }),
      attr("roughness_coefficient", n("Rauheit"), {
        data_type: "number",
        calculation_role: "hydraulic",
      }),
      attr("length_m", n("Länge"), {
        data_type: "number",
        unit: "m",
        calculation_role: "bill_of_materials",
      }),
      attr("potable_water_approved", n("Trinkwassergeeignet"), {
        data_type: "boolean",
        calculation_role: "none",
      }),
    ],
    ["hydraulic", "compatibility", "bill_of_materials"],
  ),

  group(
    "sprinkler_connections",
    "hydraulics",
    n("Regneranschlüsse"),
    "Swing Joint / SPX-FLEX / Anbohrschellen / Steigrohre",
    ["swing_pipe", "swing_elbow", "funny_pipe_fitting", "tapping_saddle", "riser"],
    [
      attr("material", n("Material"), { data_type: "string" }),
      attr("length_m", n("Länge"), {
        data_type: "number",
        unit: "m",
        calculation_role: "bill_of_materials",
      }),
      attr("angle_deg", n("Winkel"), {
        data_type: "number",
        unit: "deg",
        calculation_role: "geometry",
      }),
      attr("pressure_rating_bar", n("Nenndruck"), {
        data_type: "number",
        unit: "bar",
        calculation_role: "compatibility",
      }),
      attr("flexible", n("Flexibel"), {
        data_type: "boolean",
        calculation_role: "none",
      }),
    ],
    ["compatibility", "bill_of_materials"],
  ),

  group(
    "pe_compression_fittings",
    "hydraulics",
    n("PE-Klemmverschraubungen"),
    "Klemmverschraubungen für PE-Rohre",
    [
      "straight_coupling",
      "reducing_coupling",
      "elbow_90",
      "tee",
      "end_cap",
      "threaded_adapter",
      "tapping_saddle",
    ],
    [
      attr("shape", n("Form"), {
        data_type: "enum",
        allowed_values: [
          "straight",
          "elbow",
          "tee",
          "end_cap",
          "reducer",
          "cross",
          "adapter",
        ],
        calculation_role: "compatibility",
        required: true,
      }),
      attr("angle_deg", n("Winkel"), {
        data_type: "number",
        unit: "deg",
        calculation_role: "geometry",
      }),
      attr("pressure_rating_bar", n("Nenndruck"), {
        data_type: "number",
        unit: "bar",
        calculation_role: "compatibility",
        critical_for_calculation: true,
        required: true,
        example: 10,
      }),
      attr("body_material", n("Gehäusewerkstoff"), {
        data_type: "string",
        calculation_role: "none",
      }),
      attr("seal_material", n("Dichtungswerkstoff"), {
        data_type: "string",
      }),
      attr("uv_resistant", n("UV-beständig"), {
        data_type: "boolean",
      }),
      attr("potable_water_approved", n("Trinkwassergeeignet"), {
        data_type: "boolean",
      }),
      attr("manufacturing_standard", n("Norm"), {
        data_type: "string",
      }),
      attr("country_of_origin", n("Herkunftsland"), {
        data_type: "string",
      }),
    ],
    ["compatibility", "bill_of_materials"],
  ),

  group(
    "threaded_fittings_manifolds",
    "hydraulics",
    n("Gewindefittings und Verteiler"),
    "Nippel, Überwürfe, T-Stücke, Verteiler aus PVC/Messing",
    [
      "nipple",
      "threaded_coupling",
      "union",
      "elbow",
      "tee",
      "cross",
      "plug",
      "cap",
      "manifold",
      "adapter",
    ],
    [
      attr("shape", n("Form"), { data_type: "string", required: true }),
      attr("outlet_count", n("Anzahl Auslässe"), {
        data_type: "integer",
        calculation_role: "bill_of_materials",
      }),
      attr("union_present", n("Überwurf"), {
        data_type: "boolean",
      }),
      attr("pressure_rating_bar", n("Nenndruck"), {
        data_type: "number",
        unit: "bar",
        calculation_role: "compatibility",
      }),
      attr("body_material", n("Material"), {
        data_type: "string",
      }),
      attr("seal_material", n("Dichtung"), {
        data_type: "string",
      }),
      attr("seal_included", n("Dichtung inklusive"), {
        data_type: "boolean",
      }),
    ],
    ["compatibility", "bill_of_materials"],
  ),

  group(
    "valves",
    "hydraulics",
    n("Ventile"),
    "Magnetventile, Kugelhähne, Rückschlag- und Masterventile",
    [
      "solenoid_valve",
      "manual_ball_valve",
      "check_valve",
      "master_valve",
      "quick_coupling_valve",
    ],
    [
      attr("actuation_type", n("Betätigung"), {
        data_type: "enum",
        allowed_values: ["solenoid", "manual", "hydraulic"],
        calculation_role: "control_logic",
        critical_for_calculation: true,
      }),
      attr("normal_state", n("Ruhestellung"), {
        data_type: "enum",
        allowed_values: ["normally_closed", "normally_open"],
      }),
      attr("coil_voltage_v", n("Spulenspannung"), {
        data_type: "number",
        unit: "v",
        calculation_role: "electrical",
        critical_for_calculation: true,
      }),
      attr("coil_current_inrush_a", n("Einschaltstrom"), {
        data_type: "number",
        unit: "a",
        calculation_role: "electrical",
      }),
      attr("coil_current_holding_a", n("Haltestrom"), {
        data_type: "number",
        unit: "a",
        calculation_role: "electrical",
      }),
      attr("pressure_min_bar", n("Druck min."), {
        data_type: "number",
        unit: "bar",
        calculation_role: "hydraulic",
      }),
      attr("pressure_max_bar", n("Druck max."), {
        data_type: "number",
        unit: "bar",
        calculation_role: "hydraulic",
        critical_for_calculation: true,
      }),
      attr("flow_min_l_min", n("Durchfluss min."), {
        data_type: "number",
        unit: "l_min",
        calculation_role: "hydraulic",
      }),
      attr("flow_max_l_min", n("Durchfluss max."), {
        data_type: "number",
        unit: "l_min",
        calculation_role: "hydraulic",
      }),
      attr("flow_control_present", n("Durchflussregulierung"), {
        data_type: "boolean",
      }),
      attr("manual_opening", n("Manuelle Öffnung"), {
        data_type: "boolean",
      }),
      attr("body_material", n("Gehäusewerkstoff"), {
        data_type: "string",
      }),
      attr("pressure_loss_table", n("Druckverlusttabelle"), {
        data_type: "performance_table",
        calculation_role: "hydraulic",
        critical_for_calculation: true,
        description: "Druckverlust über Durchfluss (Globe/Angle), Basis: l/min und bar",
      }),
    ],
    ["hydraulic", "electrical", "compatibility", "bill_of_materials", "control_logic"],
  ),

  group(
    "filters_pressure_regulators",
    "hydraulics",
    n("Filter und Druckminderer"),
    "Filter, Druckminderer und Filter-/Druckminderer-Kombinationen",
    [
      "disc_filter",
      "screen_filter",
      "pressure_regulator",
      "filter_regulator",
      "valve_filter_regulator_assembly",
    ],
    [
      attr("filtration_micron", n("Filterfeinheit"), {
        data_type: "number",
        unit: "micron",
        calculation_role: "hydraulic",
      }),
      attr("filtration_mesh", n("Mesh"), {
        data_type: "number",
        calculation_role: "hydraulic",
      }),
      attr("filter_element_type", n("Filterelement"), {
        data_type: "string",
      }),
      attr("pressure_min_bar", n("Druck min."), {
        data_type: "number",
        unit: "bar",
        calculation_role: "hydraulic",
      }),
      attr("pressure_max_bar", n("Druck max."), {
        data_type: "number",
        unit: "bar",
        calculation_role: "hydraulic",
      }),
      attr("regulated_pressure_bar", n("Ausgangdruck"), {
        data_type: "number",
        unit: "bar",
        calculation_role: "hydraulic",
        critical_for_calculation: true,
      }),
      attr("flow_max_l_min", n("Durchfluss max."), {
        data_type: "number",
        unit: "l_min",
        calculation_role: "hydraulic",
      }),
    ],
    ["hydraulic", "compatibility", "bill_of_materials"],
  ),

  group(
    "pumps_water_supply",
    "hydraulics",
    n("Pumpen und Wasserversorgung"),
    "Pumpen, Relais, Rückfluss und Quelladapter",
    [
      "surface_pump",
      "submersible_pump",
      "booster_pump",
      "pump_start_relay",
      "water_source_adapter",
      "backflow_prevention_device",
      "pressure_tank",
    ],
    [
      attr("power_w", n("Leistung"), {
        data_type: "number",
        unit: "w",
        calculation_role: "electrical",
      }),
      attr("supply_voltage_v", n("Versorgungsspannung"), {
        data_type: "number",
        unit: "v",
        calculation_role: "electrical",
      }),
      attr("max_flow_l_min", n("Max. Durchfluss"), {
        data_type: "number",
        unit: "l_min",
        calculation_role: "hydraulic",
      }),
      attr("max_head_m", n("Max. Förderhöhe"), {
        data_type: "number",
        unit: "m",
        calculation_role: "hydraulic",
      }),
    ],
    ["hydraulic", "electrical", "compatibility", "bill_of_materials"],
  ),

  group(
    "controllers",
    "control",
    n("Steuergeräte"),
    "Bewässerungssteuerungen, Erweiterungsmodule und WLAN",
    [
      "irrigation_controller",
      "expansion_module",
      "wifi_module",
      "decoder_controller",
      "battery_controller",
    ],
    [
      attr("station_count", n("Stationen Basis"), {
        data_type: "integer",
        calculation_role: "control_logic",
        critical_for_calculation: true,
      }),
      attr("station_count_max", n("Stationen max."), {
        data_type: "integer",
        calculation_role: "control_logic",
        critical_for_calculation: true,
      }),
      attr("stations_added", n("Zusatzstationen"), {
        data_type: "integer",
        calculation_role: "control_logic",
      }),
      attr("supply_voltage_v", n("Versorgungsspannung"), {
        data_type: "number",
        unit: "v",
        calculation_role: "electrical",
        critical_for_calculation: true,
      }),
      attr("output_voltage_v", n("Ausgangsspannung"), {
        data_type: "number",
        unit: "v",
        calculation_role: "electrical",
        critical_for_calculation: true,
        example: 24,
      }),
      attr("indoor_outdoor", n("Innen/Außen"), {
        data_type: "enum",
        allowed_values: ["indoor", "outdoor", "both"],
      }),
      attr("wifi_integrated", n("WLAN integriert"), {
        data_type: "boolean",
        calculation_role: "control_logic",
      }),
      attr("wifi_module_supported", n("WLAN-Modul unterstützt"), {
        data_type: "boolean",
        calculation_role: "compatibility",
      }),
      attr("rain_sensor_supported", n("Regensensor"), {
        data_type: "boolean",
        calculation_role: "compatibility",
      }),
      attr("flow_sensor_supported", n("Durchflusssensor"), {
        data_type: "boolean",
      }),
      attr("master_valve_supported", n("Hauptventil"), {
        data_type: "boolean",
        calculation_role: "control_logic",
      }),
      attr("pump_start_supported", n("Pumpenstart"), {
        data_type: "boolean",
        calculation_role: "control_logic",
      }),
    ],
    ["control_logic", "electrical", "compatibility", "bill_of_materials"],
  ),

  group(
    "sensors",
    "control",
    n("Sensoren"),
    "Regen, Durchfluss, Feuchte, Frost, Wetter",
    [
      "rain_sensor",
      "flow_sensor",
      "soil_moisture_sensor",
      "freeze_sensor",
      "weather_sensor",
    ],
    [
      attr("measurement_type", n("Messgröße"), {
        data_type: "string",
        calculation_role: "control_logic",
        required: true,
      }),
      attr("wired", n("Kabelgebunden"), { data_type: "boolean" }),
      attr("wireless", n("Funk"), { data_type: "boolean" }),
      attr("supply_voltage_v", n("Versorgungsspannung"), {
        data_type: "number",
        unit: "v",
        calculation_role: "electrical",
      }),
      attr("cable_length_m", n("Kabellänge"), {
        data_type: "number",
        unit: "m",
      }),
      attr("ip_rating", n("IP-Schutzart"), { data_type: "string" }),
    ],
    ["control_logic", "electrical", "compatibility", "bill_of_materials"],
  ),

  group(
    "electrical_accessories",
    "control",
    n("Elektrisches Zubehör"),
    "Kabel, Gelverbinder, Schutzschläuche, Relais, Spulen",
    [
      "control_cable",
      "waterproof_connector",
      "conduit",
      "pump_start_relay",
      "solenoid_coil",
    ],
    [
      attr("conductor_count", n("Adernanzahl"), {
        data_type: "integer",
        calculation_role: "electrical",
        critical_for_calculation: true,
      }),
      attr("conductor_cross_section_mm2", n("Querschnitt"), {
        data_type: "number",
        unit: "mm2",
        calculation_role: "electrical",
      }),
      attr("length_m", n("Länge"), {
        data_type: "number",
        unit: "m",
        calculation_role: "bill_of_materials",
      }),
      attr("direct_burial_allowed", n("Erdverlegung"), {
        data_type: "boolean",
      }),
      attr("waterproof", n("Wasserdicht"), {
        data_type: "boolean",
      }),
      attr("voltage_rating_v", n("Nennspannung"), {
        data_type: "number",
        unit: "v",
        calculation_role: "electrical",
      }),
    ],
    ["electrical", "compatibility", "bill_of_materials"],
  ),

  group(
    "valve_boxes",
    "installation",
    n("Ventilkästen"),
    "Runde/rechteckige Ventilkästen und Aufsätze",
    ["round_valve_box", "rectangular_valve_box", "valve_box_extension"],
    [
      attr("outer_length_mm", n("Länge außen"), {
        data_type: "number",
        unit: "mm",
        calculation_role: "geometry",
      }),
      attr("outer_width_mm", n("Breite außen"), {
        data_type: "number",
        unit: "mm",
        calculation_role: "geometry",
      }),
      attr("outer_height_mm", n("Höhe außen"), {
        data_type: "number",
        unit: "mm",
        calculation_role: "geometry",
      }),
      attr("outer_diameter_mm", n("Durchmesser außen"), {
        data_type: "number",
        unit: "mm",
        calculation_role: "geometry",
      }),
      attr("max_valve_count", n("Max. Ventile"), {
        data_type: "integer",
        calculation_role: "bill_of_materials",
      }),
      attr("lid_load_class", n("Deckelklasse"), {
        data_type: "string",
      }),
      attr("body_material", n("Material"), { data_type: "string" }),
      attr("base_included", n("Boden inklusive"), {
        data_type: "boolean",
      }),
    ],
    ["geometry", "bill_of_materials"],
  ),

  group(
    "mounting_accessories",
    "installation",
    n("Montagezubehör"),
    "Erdspieße, Werkzeuge, Dichtungen, Manometer, Winterfestmachung",
    [
      "stake",
      "mounting_bracket",
      "installation_tool",
      "thread_seal",
      "winterization_adapter",
      "pressure_gauge",
    ],
    [
      attr("material", n("Material"), { data_type: "string" }),
      attr("compatible_diameter_mm", n("Für Durchmesser"), {
        data_type: "number",
        unit: "mm",
        calculation_role: "compatibility",
        multiple: true,
      }),
    ],
    ["compatibility", "bill_of_materials"],
  ),

  group(
    "preassembled_modules",
    "assemblies",
    n("Vormontierte Baugruppen"),
    "Ventilbaugruppen, Tropfzonen und Komplettsets — über BOM",
    [
      "sprinkler_installation_set",
      "valve_manifold_assembly",
      "drip_control_zone_kit",
      "water_source_connection_kit",
      "complete_irrigation_package",
    ],
    [
      attr("function", n("Funktion"), {
        data_type: "string",
        required: true,
      }),
      attr("zone_count", n("Zonenanzahl"), {
        data_type: "integer",
        calculation_role: "control_logic",
      }),
      attr("preassembled", n("Vormontiert"), {
        data_type: "boolean",
      }),
      attr("installation_ready", n("Einbaufertig"), {
        data_type: "boolean",
      }),
      attr("included_filter", n("Filter inklusive"), {
        data_type: "boolean",
      }),
      attr("included_pressure_regulator", n("Druckminderer inklusive"), {
        data_type: "boolean",
      }),
      attr("included_winterization", n("Druckluftanschluss inklusive"), {
        data_type: "boolean",
      }),
    ],
    ["bill_of_materials", "compatibility", "control_logic"],
  ),
];

const TAXONOMY = {
  schema_version: "1.0.0",
  generated_at: new Date().toISOString(),
  sections: [
    {
      section_id: "irrigation",
      name: n("Bewässerung"),
      description: "Beregnung und Tropfbewässerung",
    },
    {
      section_id: "hydraulics",
      name: n("Hydraulik"),
      description: "Rohre, Fittings, Ventile, Filter, Pumpen",
    },
    {
      section_id: "control",
      name: n("Steuerung"),
      description: "Steuergeräte, Sensoren, Elektrik",
    },
    {
      section_id: "installation",
      name: n("Installation"),
      description: "Kästen, Befestigungen, Montageelemente",
    },
    {
      section_id: "assemblies",
      name: n("Baugruppen"),
      description: "Fertige Sets und vormontierte Module",
    },
  ],
  groups: GROUPS.map((g) => ({
    group_id: g.group_id,
    section_id: g.section_id,
    name: g.name,
    subtypes: g.allowed_subtypes.map((id) => ({ subtype_id: id })),
  })),
};

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const taxonomyPath = path.join(OUT_DIR, "catalog_taxonomy.json");
  const schemasPath = path.join(OUT_DIR, "group_schemas.json");

  await fs.writeFile(taxonomyPath, JSON.stringify(TAXONOMY, null, 2), "utf8");
  await fs.writeFile(
    schemasPath,
    JSON.stringify(
      {
        schema_version: "1.0.0",
        generated_at: new Date().toISOString(),
        groups: GROUPS,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`Wrote ${taxonomyPath}`);
  console.log(`Wrote ${schemasPath} (${GROUPS.length} groups)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
