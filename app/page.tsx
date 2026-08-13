import { redirect } from "next/navigation";

/** Marketing site lives on the primary domain (RegnerWerk-WebSite). */
export default function Home() {
  redirect("/konfigurator");
}
