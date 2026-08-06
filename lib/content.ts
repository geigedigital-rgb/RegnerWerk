export const site = {
  name: "RegnerWerk",
  tagline: "Intelligente Bewässerung. Unsichtbar. Präzise.",
  phone: "+49 (0) 800 123 4567",
  email: "hallo@regnerwerk.de",
  address: "Deutschland",
};

export const nav = [
  { href: "/#leistungen", label: "Leistungen" },
  { href: "/#pakete", label: "Pakete" },
  { href: "/konfigurator", label: "Konfigurator" },
  { href: "/#projekte", label: "Projekte" },
  { href: "/#beratung", label: "Beratung" },
];

export const fertigAreas = [
  { id: "150", label: "bis 150 m²", price: 2490 },
  { id: "300", label: "150–300 m²", price: 3890 },
  { id: "500", label: "300–500 m²", price: 5490 },
  { id: "500plus", label: "500 m²+", price: 7290 },
] as const;

export const packages = {
  fertig: {
    id: "fertig",
    badge: "Sofort planbar",
    title: "Fertigpaket",
    description:
      "Komplettset inkl. Material und Steuerung – im Konfigurator Form und Maße wählen, Preis live sehen.",
    image:
      "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=900&q=80",
    imageAlt: "Bewässerungsset mit Düsen und Steuerung",
    advantages: [
      { icon: "package", label: "Komplettset" },
      { icon: "smartphone", label: "App-Steuerung" },
      { icon: "shield", label: "5 J. Garantie" },
      { icon: "zap", label: "Schnell startklar" },
    ],
    priceFrom: 2490,
    cta: "Jetzt konfigurieren",
    href: "/konfigurator",
  },
  individuell: {
    id: "individuell",
    badge: "Maßarbeit",
    title: "Individuelle Planung",
    description:
      "Wir bauen den optimalen Plan: minimaler Wasserverbrauch, maximale Flächenabdeckung – exakt für Ihren Garten.",
    image:
      "https://images.unsplash.com/photo-1592419044706-39796d40f98c?auto=format&fit=crop&w=900&q=80",
    imageAlt: "Individuelle Bewässerungsplanung im Garten",
    advantages: [
      {
        icon: "droplets",
        title: "Minimaler Wasserverbrauch",
        detail: "Zonen & Sensorik sparen gezielt",
      },
      {
        icon: "radar",
        title: "Maximale Abdeckung",
        detail: "Gleichmäßig bis in jede Ecke",
      },
      {
        icon: "map",
        title: "Vor-Ort-Analyse",
        detail: "Druck, Boden, Hanglage",
      },
      {
        icon: "leaf",
        title: "Nachhaltig geplant",
        detail: "Weniger Verschwendung, mehr Grün",
      },
    ],
    priceFrom: 2490,
    cta: "Planung anfragen",
    href: "#beratung",
  },
} as const;

function formatEuro(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

export { formatEuro };

export const stats = [
  { value: "850+", label: "Installierte Anlagen" },
  { value: "40%", label: "Weniger Wasserverbrauch" },
  { value: "12 J.", label: "Erfahrung im Gartenbau" },
  { value: "4.9", label: "Kundenbewertung" },
];

export const services = [
  {
    title: "Planung & Analyse",
    description:
      "Wir vermessen Ihre Fläche, prüfen Druck und Boden – und entwerfen ein System, das sparsam und unsichtbar arbeitet.",
    image:
      "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=800&q=80",
  },
  {
    title: "Installation",
    description:
      "Professionelle Verlegung von Leitungen, Sprinklern und Tropfsystemen – sauber, termintreu und mit Garantie.",
    image:
      "https://images.unsplash.com/photo-1592419044706-39796d40f98c?auto=format&fit=crop&w=800&q=80",
  },
  {
    title: "Smart Steuerung",
    description:
      "App-Steuerung, Bodensensoren und Wetterdaten – Ihr Garten bewässert sich selbst, genau dann, wenn es nötig ist.",
    image:
      "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=800&q=80",
  },
  {
    title: "Wartung & Service",
    description:
      "Saisonstart, Winterfestmachen und Feinjustierung – damit Ihre Anlage Jahr für Jahr zuverlässig läuft.",
    image:
      "https://images.unsplash.com/photo-1466692476866-aef1dfb1e735?auto=format&fit=crop&w=800&q=80",
  },
];

export const usps = [
  {
    title: "Wasser sparen",
    description:
      "Sensorik und Zonensteuerung reduzieren Verbrauch – ohne Abstriche bei der Rasenqualität.",
  },
  {
    title: "Unsichtbar im Alltag",
    description:
      "Versenkbare Düsen und unterirdische Leitungen: Technik, die man nicht sieht – nur das Ergebnis.",
  },
  {
    title: "Steuerung per App",
    description:
      "Zeitpläne, Ferienmodus und Live-Status – so einfach wie Smart Home.",
  },
  {
    title: "Klarer Ablauf",
    description:
      "Von der Anfrage bis zum Smart Start: transparente Schritte, feste Ansprechpartner.",
  },
];

export const processSteps = [
  {
    number: "01",
    title: "Anfrage",
    description: "Kurz schildern, was Sie brauchen – wir melden uns rasch.",
  },
  {
    number: "02",
    title: "Analyse vor Ort",
    description: "Messung, Druck, Konzept – Sie wissen vorher, was kommt.",
  },
  {
    number: "03",
    title: "Installation",
    description: "Saubere Verlegung und Einweisung – mit wenig Eingriff.",
  },
  {
    number: "04",
    title: "Smart Start",
    description: "App verbinden, Zonen fein – die Anlage läuft für Sie.",
  },
];

export const projectTypes = [
  {
    id: "garten",
    title: "Privatgärten",
    detail: "Rasen, Beete & Smart-Steuerung",
    image:
      "https://images.unsplash.com/photo-1558904541-efa843a96f01?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "haus",
    title: "Haus & Grundstück",
    detail: "Hof, Einfahrt, Vorgarten",
    image:
      "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "parks",
    title: "Golf & Parks",
    detail: "Große Flächen, hohe Volumen",
    image:
      "https://images.unsplash.com/photo-1535131749006-b7f58c99034b?auto=format&fit=crop&w=900&q=80",
  },
  {
    id: "gewaechs",
    title: "Gärten & Gewächshäuser",
    detail: "Gemüse, Tropf, Präzisionszonen",
    image:
      "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=900&q=80",
  },
] as const;

export const testimonials = [
  {
    quote:
      "Von der Planung bis zur App-Einrichtung alles klar und ruhig. Unser Rasen war noch nie so gleichmäßig – und wir verbrauchen spürbar weniger Wasser.",
    name: "Anna M.",
    role: "Hausbesitzerin, Stuttgart",
    rating: 5,
  },
  {
    quote:
      "RegnerWerk denkt wie ein Produktteam: strukturiert, nachvollziehbar, ohne Überraschungen. Genau so wollten wir die Installation.",
    name: "Thomas K.",
    role: "Architekt, Hamburg",
    rating: 5,
  },
  {
    quote:
      "Endlich Bewässerung, die man nicht sieht. Die Zonensteuerung und der Winterservice nehmen uns jede Saisonarbeit ab.",
    name: "Laura S.",
    role: "Gartenbesitzerin, München",
    rating: 5,
  },
];

export const blogPosts = [
  {
    date: "12. März 2026",
    title: "Wie viel Wasser spart eine smarte Anlage wirklich?",
    excerpt:
      "Zahlen, Zonen und typische Fehler bei der Planung von Rasensystemen.",
    image:
      "https://images.unsplash.com/photo-1466692476866-aef1dfb1e735?auto=format&fit=crop&w=700&q=80",
  },
  {
    date: "28. Feb. 2026",
    title: "Tropf oder Sprenger? Die richtige Wahl für Beete",
    excerpt:
      "Wann Tropfleitungen besser sind – und wann Versenkdüsen sinnvoll bleiben.",
    image:
      "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=700&q=80",
  },
  {
    date: "08. Feb. 2026",
    title: "Winterfest: Checkliste für Ihre Bewässerung",
    excerpt:
      "Druckentleerung, Controller und Sensoren – so starten Sie sicher in die Saison.",
    image:
      "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=700&q=80",
  },
];

export const tickerItems = [
  "Wasser sparen",
  "Unsichtbare Technik",
  "Smart Home Bewässerung",
  "Klarer Ablauf",
  "Made for Germany",
];
