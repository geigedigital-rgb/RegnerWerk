import type { GeocodeFeature } from "@/lib/mapbox";

const ADDRESS_KEY = "rw-config-address";
const PLACE_KEY = "rw-config-place";

export type AddressDraft = {
  street: string;
  number: string;
  plz: string;
  city: string;
};

const emptyDraft: AddressDraft = {
  street: "",
  number: "",
  plz: "",
  city: "",
};

export function loadAddressDraft(): AddressDraft {
  if (typeof window === "undefined") return emptyDraft;
  try {
    const raw = localStorage.getItem(ADDRESS_KEY);
    if (!raw) return emptyDraft;
    const parsed = JSON.parse(raw) as Partial<AddressDraft>;
    return {
      street: typeof parsed.street === "string" ? parsed.street : "",
      number: typeof parsed.number === "string" ? parsed.number : "",
      plz: typeof parsed.plz === "string" ? parsed.plz : "",
      city: typeof parsed.city === "string" ? parsed.city : "",
    };
  } catch {
    return emptyDraft;
  }
}

export function saveAddressDraft(draft: AddressDraft) {
  try {
    localStorage.setItem(ADDRESS_KEY, JSON.stringify(draft));
  } catch {
    /* ignore quota */
  }
}

export function loadLastPlace(): GeocodeFeature | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PLACE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GeocodeFeature;
    if (
      !parsed ||
      typeof parsed.id !== "string" ||
      !Array.isArray(parsed.center) ||
      parsed.center.length < 2
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveLastPlace(place: GeocodeFeature) {
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify(place));
  } catch {
    /* ignore quota */
  }
}
