import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import CreateCharacter from "@/components/CreateCharacter";
import { PLAYER_COOKIE } from "@/lib/api";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const id = (await cookies()).get(PLAYER_COOKIE)?.value;
  if (id && /^[0-9a-f-]{36}$/.test(id) && (await getStore().getPlayer(id))) redirect("/play");
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8 text-center">
        <h1 className="title text-4xl text-gold sm:text-5xl">Uncharted Builds</h1>
        <p className="mt-3 text-muted">
          No classes. No skill trees. The world watches how you play, and rewards your habits with power nobody else has.
        </p>
      </header>
      <CreateCharacter />
    </main>
  );
}
