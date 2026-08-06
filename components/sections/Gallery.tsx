import Image from "next/image";
import { Container } from "@/components/ui/Container";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { projectTypes } from "@/lib/content";

function RegnerWerkMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <path
        d="M24 8c-6.5 8.5-10 14.2-10 20a10 10 0 0020 0c0-5.8-3.5-11.5-10-20z"
        fill="currentColor"
      />
      <path
        d="M24 18v16M20 26h8"
        stroke="#0B2414"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Gallery() {
  return (
    <section id="projekte" className="bg-white py-16 lg:py-20">
      <Container>
        <SectionHeader
          eyebrow="Projekte"
          title="Wo wir installieren"
          description="Von Privatgärten bis große Flächen – die Bereiche, für die wir Bewässerung planen und umsetzen."
        />

        <div className="relative mx-auto mt-10 max-w-3xl">
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            {projectTypes.map((item, i) => {
              const isRight = i % 2 === 1;
              return (
                <article
                  key={item.id}
                  className="group relative aspect-[4/3] overflow-hidden rounded-2xl sm:rounded-3xl"
                >
                  <Image
                    src={item.image}
                    alt={item.title}
                    fill
                    className="object-cover transition duration-500 group-hover:scale-[1.03]"
                    sizes="(max-width: 768px) 50vw, 400px"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-forest/75 via-forest/15 to-transparent" />
                  <div
                    className={`absolute inset-x-0 bottom-0 p-3 sm:p-4 ${
                      isRight ? "text-right" : "text-left"
                    }`}
                  >
                    <h3 className="text-sm font-bold tracking-tight text-white sm:text-base">
                      {item.title}
                    </h3>
                    <p className="mt-0.5 text-[11px] text-white/75 sm:text-xs">
                      {item.detail}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>

          {/* Center logo circle — overlaps 2×2 intersection */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex h-[4.5rem] w-[4.5rem] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[3px] border-white bg-forest sm:h-24 sm:w-24 sm:border-4"
            aria-hidden
          >
            <RegnerWerkMark className="h-8 w-8 text-lime sm:h-10 sm:w-10" />
          </div>
        </div>
      </Container>
    </section>
  );
}
