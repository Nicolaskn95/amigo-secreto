"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Gift, ArrowRight, Lock, Sparkles } from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const [inviteInput, setInviteInput] = useState("");

  function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    const raw = inviteInput.trim();
    if (!raw) return;
    const giftMatch = raw.match(/\/presentes\/([a-zA-Z0-9_-]+)/);
    if (giftMatch) {
      router.push(`/presentes/${giftMatch[1]}`);
      return;
    }
    const drawMatch = raw.match(/\/s\/([a-zA-Z0-9_-]+)/);
    const token = drawMatch ? drawMatch[1] : raw;
    router.push(`/s/${token}`);
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-rose-50/70 via-white to-slate-50">
      <header className="border-b border-slate-200/80 bg-white/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-rose-600 text-white flex items-center justify-center shadow-sm">
              <Gift className="w-5 h-5" />
            </div>
            <span className="font-bold text-lg tracking-tight text-slate-900">
              Amigo Secreto <span className="text-rose-600">Famílias</span>
            </span>
          </div>

          <Link
            href="/admin"
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition shadow-sm"
          >
            <Lock className="w-4 h-4" />
            Painel Admin
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col justify-center max-w-5xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
        <div className="text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-rose-100 text-rose-700 text-xs font-semibold mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            Sorteio simultâneo
          </div>

          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 leading-tight">
            Sorteie o Amigo Secreto entre famílias{" "}
            <span className="text-rose-600">sem papelzinho repetido</span>
          </h1>

          <p className="mt-4 text-base sm:text-lg text-slate-600 leading-relaxed">
            Cadastre as famílias e seus integrantes, defina regras específicas de
            quem não pode tirar quem e compartilhe um único link público para
            todos sortearem ao vivo pelo celular.
          </p>

          <div className="mt-8 bg-white p-4 sm:p-6 rounded-2xl shadow-md border border-slate-200 max-w-xl mx-auto">
            <form
              onSubmit={handleJoin}
              className="flex flex-col sm:flex-row gap-3"
            >
              <input
                type="text"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value)}
                placeholder="Cole o link ou código do sorteio (ex: k8x2m9p4)"
                className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 py-3 text-sm font-semibold text-white hover:bg-rose-700 transition cursor-pointer"
              >
                Participar
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
