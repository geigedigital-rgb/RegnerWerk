"use client";

import { useEffect, useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  loadAddressDraft,
  saveAddressDraft,
  type AddressDraft,
} from "@/lib/config-storage";
import {
  searchAddresses,
  type GeocodeFeature,
} from "@/lib/mapbox";

type Props = {
  onSelect: (feature: GeocodeFeature) => void;
  onBack: () => void;
};

export function AddressStep({ onSelect, onBack }: Props) {
  const [draft, setDraft] = useState<AddressDraft>(() => loadAddressDraft());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GeocodeFeature[]>([]);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    saveAddressDraft(draft);
  }, [draft]);

  function patch(field: keyof AddressDraft, value: string) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setSearched(true);
    saveAddressDraft(draft);
    try {
      const features = await searchAddresses(draft);
      setResults(features);
      if (features.length === 0) {
        setError("Keine Adressen gefunden. Bitte Angaben prüfen.");
      }
    } catch {
      setError("Suche fehlgeschlagen. Bitte später erneut versuchen.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-[100svh] w-full items-start justify-center bg-forest px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] sm:items-center sm:py-16">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(0,255,207,0.12),_transparent_55%)]" />

      <div className="relative z-10 w-full max-w-lg rounded-3xl border border-white/10 bg-white p-5 sm:p-8">
        <button
          type="button"
          onClick={onBack}
          className="text-xs font-semibold text-aqua-deep hover:underline"
        >
          ← Zurück
        </button>

        <h2 className="mt-4 text-2xl font-bold tracking-tight text-forest">
          Wo liegt Ihr Garten?
        </h2>
        <p className="mt-2 text-sm leading-snug text-gray-600">
          Straße, Hausnummer, PLZ und Ort – wir finden passende Adressen in der
          Nähe.
        </p>

        <form onSubmit={handleSearch} className="mt-6 space-y-3">
          <div className="grid grid-cols-[1fr_5.5rem] gap-2">
            <Field
              id="street"
              label="Straße"
              value={draft.street}
              onChange={(v) => patch("street", v)}
              required
              autoComplete="street-address"
            />
            <Field
              id="number"
              label="Nr."
              value={draft.number}
              onChange={(v) => patch("number", v)}
              required
            />
          </div>
          <div className="grid grid-cols-[7rem_1fr] gap-2">
            <Field
              id="plz"
              label="PLZ"
              value={draft.plz}
              onChange={(v) => patch("plz", v)}
              required
              inputMode="numeric"
              autoComplete="postal-code"
            />
            <Field
              id="city"
              label="Ort"
              value={draft.city}
              onChange={(v) => patch("city", v)}
              required
              autoComplete="address-level2"
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            className="w-full !shadow-none"
            disabled={loading}
          >
            {loading ? (
              <Loader2 size={18} className="animate-spin" aria-hidden />
            ) : (
              <Search size={18} aria-hidden />
            )}
            Adresse suchen
          </Button>
        </form>

        {error ? (
          <p className="mt-4 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {searched && results.length > 0 ? (
          <ul className="mt-5 max-h-[min(40svh,16rem)] space-y-2 overflow-y-auto sm:max-h-64">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Passende Adressen
            </p>
            {results.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onSelect(r)}
                  className="flex w-full items-start gap-3 rounded-2xl border border-gray-100 bg-mint/40 px-3 py-3 text-left transition hover:border-aqua-deep/40 hover:bg-mint"
                >
                  <MapPin
                    size={18}
                    className="mt-0.5 shrink-0 text-aqua-deep"
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-forest">
                      {r.placeName}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  required,
  inputMode,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        {label}
      </span>
      <input
        id={id}
        value={value}
        required={required}
        inputMode={inputMode}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-2xl border border-gray-100 bg-mint/40 px-3 py-3 text-sm text-forest outline-none transition focus:border-lime focus:ring-2 focus:ring-lime/30"
      />
    </label>
  );
}
