import { Suspense } from "react";
import { redirect } from "next/navigation";
import { isAdminAuthenticated } from "@/lib/auth";
import AdminDashboard from "@/components/AdminDashboard";

async function AdminGuard() {
  const authed = await isAdminAuthenticated();
  if (!authed) {
    redirect("/admin/login");
  }
  return <AdminDashboard />;
}

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 text-sm">
          Carregando painel administrativo...
        </div>
      }
    >
      <AdminGuard />
    </Suspense>
  );
}
