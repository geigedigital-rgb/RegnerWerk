# Plan: Mapbox-Konfigurator (Plot App)

> Стиль — [DESIGN.md](./DESIGN.md). Ниже — актуальный продуктовый план.

## Цель
Конфигуратор = **полноэкранное приложение**: бесплатно набросать план участка на карте (Mapbox), с **Sofort-Berechnung** (авторасстановка Regner/Leitungen + Materialliste) или переходом к Fachplanung.

## Этапы UX

### 0. Intro (fullscreen)
- Фон на весь экран (фото/gradient forest)
- Заголовок: «Kostenlos Ihren Bewässerungsplan erstellen»
- CTA: «Meinen Garten auf der Karte öffnen»
- Без цены, без sticky summary, без старых блоков

### 1. Adresse
- Форма: Straße · Hausnummer · PLZ · Ort
- Mapbox Geocoding API → список ближайших/похожих адресов
- Клиент выбирает адрес из списка

### 2. Karten-App — Flächen
- Карта центрируется на выбранном адресе (zoom/pan)
- Верхняя плашка зон (разные цвета):
  - Rasen · Hecke · Gebäude · Trockenfläche · Beet
- Выбор зоны → клики по карте ставят точки периметра
- Замыкание полигона (клик у первой точки / кнопка «Speichern»)
- **Магнит**: к вершинам любых сохранённых площадей + параллель к их рёбрам (все типы зон)
- **Несколько зон** сохраняются в списке (session) — можно рисовать дальше (дом, газон…)
- Переключатель **Satellit / Plan**: Plan = светлое чертёжное полотно с сеткой (карта остаётся под ним для геометрии), не смена стиля Mapbox
- **Weiter** → этапы техники (иконки поверх площадей)

### 3. Technik auf dem Plan (ein Schritt)
Nach den Flächen: **ein** Technik-Schritt. Links Quelle / Smart / Verteiler wählen → auf Plan tippen.
- Wasserquelle-Dialoge speichern Typ / Menge / m³/h / Pumpe in `sessionStorage` — Grundlage für Sofort-Berechnung
- Nochmal gleiche Leisten-Taste oder **Esc** = normaler Cursor
- Esc auf allen Etappen bricht unfertige Aktionen ab
- **Fertig** → PlanChoiceDialog: Sofort-Berechnung | Fachplanung

### 4. Sofort-Berechnung (Ergebnis)
- Engine: `lib/planner/` — layout (R-VAN / 3504 / Streifendüsen) → Zonen nach Durchfluss (kein Mix spray/rotor) → Leitungen → BOM aus `data/planner/planner-catalog.json`
- Katalog bauen: `npm run catalog:planner` (из `RegnerWerk_universal.json` + AI/variant-prices)
- Overlay: Abdeckung, Rohre, Regner ziehen/löschen → live Recompute
- Panel: Zonen, % Abdeckung, Materialliste, Warnungen (Druck via Hazen–Williams)
- Persistenz: `sessionStorage` `rw-plot-sofort:{placeId}` вместе с zones/fixtures
- Fachplanung: Formular stub (Flächen bleiben gespeichert)

## Техника
- `mapbox-gl` + Geocoding REST
- Token: `NEXT_PUBLIC_MAPBOX_TOKEN` в `.env.local` (public pk; позже protected token)
- Страница `/konfigurator` = только app shell (без Hero/Preis/Testimonials)
- Черновик зон + fixtures + SofortPlan: React overlay; persistence: `sessionStorage`
- Тесты планировщика: `npm run test:planner`

## Вне скоупа сейчас
- PDF/DXF-экспорт, сохранение аккаунта / backend API
- Полный compat-граф (BFS adapters) — BOM пока на фиксированных рецептах
- Финальная настройка scopes Mapbox Dashboard
- Fachplanung-Anfrageformular (UI stub)

## Статус
- [x] Intro fullscreen
- [x] Address + suggestions
- [x] Map + zone toolbar + polygon draw
- [x] Multi-zone save + list
- [x] Satellit / Plan (design canvas overlay, not map style switch)
- [x] Technik-Schritt: Quelle / Smart / Verteiler in einer Stufe + Esc-Cancel
- [x] Sofort-Berechnung v1 (layout, zones, pipes, BOM, edit, coverage %, strip, HW-check)
- [ ] Protected token / Mapbox dashboard scopes
- [ ] Fachplanung-Formular
- [ ] Аккаунт / экспорт PDF/DXF
