import { Container } from "@/components/ui/Container";
import { FadeIn } from "@/components/ui/FadeIn";
import { stats } from "@/lib/content";

export function Trust() {
  return (
    <section className="border-b border-gray-100 bg-white py-12 lg:py-16">
      <Container>
        <FadeIn>
          <div className="grid grid-cols-2 gap-8 lg:grid-cols-4 lg:gap-6">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center lg:text-left">
                <p className="text-3xl font-bold tracking-tight text-forest lg:text-4xl">
                  {stat.value}
                </p>
                <p className="mt-1 text-sm text-gray-600">{stat.label}</p>
              </div>
            ))}
          </div>
        </FadeIn>
      </Container>
    </section>
  );
}
