import { Suspense } from "react";
import PublicDrawClient from "@/components/PublicDrawClient";

async function PublicTokenResolver({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicDrawClient token={token} />;
}

export default function PublicDrawPage(props: PageProps<"/s/[token]">) {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 text-sm">
          Abrindo sala do Amigo Secreto...
        </div>
      }
    >
      <PublicTokenResolver params={props.params} />
    </Suspense>
  );
}
