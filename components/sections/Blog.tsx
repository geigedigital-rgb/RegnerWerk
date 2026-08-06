import Image from "next/image";
import { Card } from "@/components/ui/Card";
import { Container } from "@/components/ui/Container";
import { FadeIn } from "@/components/ui/FadeIn";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { blogPosts } from "@/lib/content";

export function Blog() {
  return (
    <section className="bg-white py-20 lg:py-28">
      <Container>
        <FadeIn>
          <SectionHeader
            eyebrow="Wissen"
            title="Kurze Einblicke"
            description="Praktisches Wissen zu Planung, Wasserverbrauch und Saisonpflege."
          />
        </FadeIn>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {blogPosts.map((post, i) => (
            <FadeIn key={post.title} delay={i * 0.06}>
              <Card className="group h-full overflow-hidden">
                <div className="relative aspect-[16/10] overflow-hidden">
                  <Image
                    src={post.image}
                    alt={post.title}
                    fill
                    className="object-cover transition duration-500 group-hover:scale-105"
                    sizes="(max-width: 768px) 100vw, 33vw"
                  />
                </div>
                <div className="p-6">
                  <p className="text-xs font-medium text-gray-400">{post.date}</p>
                  <h3 className="mt-2 text-lg font-semibold tracking-tight text-forest">
                    {post.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">
                    {post.excerpt}
                  </p>
                  <a
                    href="#beratung"
                    className="mt-4 inline-block text-sm font-semibold text-forest hover:text-aqua-deep"
                  >
                    Weiterlesen →
                  </a>
                </div>
              </Card>
            </FadeIn>
          ))}
        </div>
      </Container>
    </section>
  );
}
