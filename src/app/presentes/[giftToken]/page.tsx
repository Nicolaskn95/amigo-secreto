import { Suspense } from "react";
import PublicGiftsClient from "@/components/PublicGiftsClient";

async function GiftTokenResolver({
  params,
}: {
  params: Promise<{ giftToken: string }>;
}) {
  const { giftToken } = await params;
  return <PublicGiftsClient giftToken={giftToken} />;
}

export default function PublicGiftsPage(
  props: PageProps<"/presentes/[giftToken]">
) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 text-sm">
          Abrindo 1ª Rodada (Lista de Presentes)...
        </div>
      }
    >
      <GiftTokenResolver params={props.params} />
    </Suspense>
  );
}
