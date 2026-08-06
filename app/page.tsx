import { Blog } from "@/components/sections/Blog";
import { Consultation } from "@/components/sections/Consultation";
import { FinalCTA } from "@/components/sections/FinalCTA";
import { Gallery } from "@/components/sections/Gallery";
import { Hero } from "@/components/sections/Hero";
import { Packages } from "@/components/sections/Packages";
import { Process } from "@/components/sections/Process";
import { Services } from "@/components/sections/Services";
import { Testimonials } from "@/components/sections/Testimonials";
import { Ticker } from "@/components/sections/Ticker";
import { Trust } from "@/components/sections/Trust";
import { Why } from "@/components/sections/Why";

export default function Home() {
  return (
    <>
      <Hero />
      <Ticker />
      <Trust />
      <Services />
      <Packages />
      <Why />
      <Process />
      <Gallery />
      <Testimonials />
      <Consultation />
      <Blog />
      <FinalCTA />
    </>
  );
}
