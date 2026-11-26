"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import confetti from "canvas-confetti";
import {
  Gift,
  Lock,
  Sparkles,
  CheckCircle2,
  Eye,
  EyeOff,
  ArrowLeft,
  Loader2,
  RefreshCw,
  Users,
  ExternalLink,
  Clock,
} from "lucide-react";

interface PublicFamily {
  id: string;
  name: string;
  color: string;
}

interface PublicParticipant {
  id: string;
  familyId: string;
  name: string;
  role: string;
  hasDrawn: boolean;
  hasPin: boolean;
  needsPinReset: boolean;
}

interface PublicEventData {
  event: {
    name: string;
    description: string;
    currentRound: "round1_gifts" | "round2_draw" | "completed";
    maxBudget: number | null;
    status: "draft" | "active" | "completed";
    totalParticipants: number;
    drawnCount: number;
  };
  families: PublicFamily[];
  participants: PublicParticipant[];
}

interface GiftItemDTO {
  id: string;
  title: string;
  url: string;
  price: number;
  optionGroup?: number;
  scraped: boolean;
}

interface RevealedFriend {
  id: string;
  name: string;
  role: string;
  giftHint: string;
  giftItems: GiftItemDTO[];
  giftsTotal: number;
  familyId: string;
  familyName: string;
  familyColor: string;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
}

export default function PublicDrawClient({ token }: { token: string }) {
  const [data, setData] = useState<PublicEventData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [selectedFamilyId, setSelectedFamilyId] = useState<string>("ALL");
  const [selectedPerson, setSelectedPerson] =
    useState<PublicParticipant | null>(null);

  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [rouletteName, setRouletteName] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const [revealed, setRevealed] = useState<{
    drawerName: string;
    chosen: RevealedFriend;
  } | null>(null);
  const [hideCard, setHideCard] = useState(false);

  const fetchPublicEvent = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/public/${token}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setLoadError(json.error || "Link de sorteio não encontrado.");
        return;
      }
      setData(json);
    } catch {
      setLoadError("Erro de conexão ao carregar o sorteio.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/public/${token}`, { cache: "no-store" });
        const json = await res.json();
        if (!active) return;
        if (!res.ok) {
          setLoadError(json.error || "Link de sorteio não encontrado.");
          return;
        }
        setData(json);
      } catch {
        if (active) setLoadError("Erro de conexão ao carregar o sorteio.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  const filteredParticipants = useMemo(() => {
    if (!data) return [];
    if (selectedFamilyId === "ALL") return data.participants;
    return data.participants.filter((p) => p.familyId === selectedFamilyId);
  }, [data, selectedFamilyId]);

  const familyMap = useMemo(() => {
    const map = new Map<string, PublicFamily>();
    data?.families.forEach((f) => map.set(f.id, f));
    return map;
  }, [data]);

  const revealedOptionGroups = useMemo(() => {
    const raw = revealed?.chosen.giftItems || [];
    const grouped = new Map<number, GiftItemDTO[]>();
    for (const item of raw) {
      const g = item.optionGroup && item.optionGroup >= 1 ? item.optionGroup : 1;
      const list = grouped.get(g) || [];
      list.push(item);
      grouped.set(g, list);
    }
    return Array.from(grouped.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([optionGroup, groupItems]) => ({
        optionGroup,
        items: groupItems,
        subtotal:
          Math.round(
            groupItems.reduce((acc, it) => acc + (Number(it.price) || 0), 0) *
              100
          ) / 100,
      }));
  }, [revealed]);

  function fireConfetti() {
    try {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
      });
    } catch {
      // ignora em ambientes sem canvas
    }
  }

  async function handleDrawOrReveal(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPerson || !data) return;

    if (!/^\d{4}$/.test(pin.trim())) {
      setActionError("Digite exatamente 4 números para o seu PIN.");
      return;
    }

    setActionError("");
    setSubmitting(true);

    const isNewDraw = !selectedPerson.hasDrawn;

    let intervalId: ReturnType<typeof setInterval> | null = null;
    if (isNewDraw && data.participants.length > 1) {
      const names = data.participants
        .filter((p) => p.id !== selectedPerson.id)
        .map((p) => p.name);
      let idx = 0;
      setRouletteName(names[0] || "Sorteando...");
      intervalId = setInterval(() => {
        idx = (idx + 1) % names.length;
        setRouletteName(names[idx]);
      }, 110);
    }

    try {
      const endpoint = isNewDraw
        ? `/api/public/${token}/draw`
        : `/api/public/${token}/reveal`;

      const [res] = await Promise.all([
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantId: selectedPerson.id,
            pin: pin.trim(),
            isResetPin: selectedPerson.needsPinReset,
          }),
        }),
        isNewDraw
          ? new Promise((resolve) => setTimeout(resolve, 1100))
          : Promise.resolve(),
      ]);

      const result = await res.json();
      if (!res.ok) {
        setActionError(result.error || "Não foi possível concluir.");
        await fetchPublicEvent();
        return;
      }

      setRevealed(result);
      setHideCard(false);
      setPin("");
      fireConfetti();
      await fetchPublicEvent();
    } catch {
      setActionError("Erro de rede. Tente novamente em instantes.");
    } finally {
      if (intervalId) clearInterval(intervalId);
      setRouletteName(null);
      setSubmitting(false);
    }
  }

  function resetSelection() {
    setSelectedPerson(null);
    setRevealed(null);
    setPin("");
    setActionError("");
    setHideCard(false);
  }

  if (loading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-rose-50 to-slate-50 px-4">
        <div className="flex items-center gap-2.5 text-slate-600 text-sm font-medium">
          <Loader2 className="w-5 h-5 animate-spin text-rose-600" />
          Carregando sorteio...
        </div>
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 max-w-md w-full text-center shadow-xs">
          <Gift className="w-12 h-12 text-rose-500 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-slate-900">
            Link indisponível
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            {loadError || "Sorteio não encontrado."}
          </p>
        </div>
      </div>
    );
  }

  const progressPct =
    data.event.totalParticipants > 0
      ? Math.round(
          (data.event.drawnCount / data.event.totalParticipants) * 100
        )
      : 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-rose-50/80 via-white to-slate-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Cabeçalho do Evento */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs text-center relative">
          <button
            type="button"
            onClick={fetchPublicEvent}
            title="Atualizar lista"
            className="absolute right-4 top-4 p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100 text-rose-700 text-xs font-bold mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            2ª Rodada — Sorteio do Amigo Secreto
          </div>

          <h1 className="text-2xl font-extrabold text-slate-900">
            {data.event.name}
          </h1>
          {data.event.description && (
            <p className="text-sm text-slate-600 mt-1">
              {data.event.description}
            </p>
          )}

          <div className="mt-5 max-w-md mx-auto">
            <div className="flex items-center justify-between text-xs font-medium text-slate-600 mb-1.5">
              <span>Participantes que já sortearam</span>
              <span className="font-bold text-rose-600">
                {data.event.drawnCount} de {data.event.totalParticipants} (
                {progressPct}%)
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-rose-600 rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Caso ainda esteja na 1ª Rodada (bloqueado até o Admin virar a chave) */}
        {data.event.currentRound === "round1_gifts" ? (
          <div className="bg-white rounded-3xl border border-amber-200 p-8 text-center space-y-4 shadow-xs">
            <Clock className="w-11 h-11 text-amber-500 mx-auto" />
            <h2 className="text-xl font-bold text-slate-900">
              Aguardando liberação da 2ª Rodada!
            </h2>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              No momento está aberta a{" "}
              <strong>1ª Rodada (colocar links dos presentes)</strong>. Assim
              que todos terminarem e o organizador liberar o sorteio, clique no
              botão abaixo!
            </p>
            <button
              type="button"
              onClick={fetchPublicEvent}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white hover:bg-slate-800 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              Verificar se já liberou
            </button>
          </div>
        ) : revealed ? (
          /* Tela 3: Cartão Revelado + Links e Valores dos Presentes */
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-md space-y-6">
            <div className="text-center">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Sorteio confirmado para {revealed.drawerName}
              </div>
            </div>

            {hideCard ? (
              <div className="py-10 px-4 rounded-2xl bg-slate-100 border border-dashed border-slate-300 text-center">
                <Lock className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-semibold text-slate-700">
                  Resultado ocultado para ninguém espiar sua tela
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="py-8 px-6 rounded-2xl bg-gradient-to-br from-rose-600 to-rose-700 text-white shadow-inner text-center">
                  <p className="text-xs uppercase tracking-widest text-rose-200 font-semibold">
                    Seu Amigo Secreto é
                  </p>
                  <h2 className="text-3xl sm:text-4xl font-extrabold mt-2 tracking-tight">
                    {revealed.chosen.name}
                  </h2>
                  <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/15 text-xs font-semibold">
                    <span
                      className="w-2.5 h-2.5 rounded-full bg-white"
                      style={{ backgroundColor: revealed.chosen.familyColor }}
                    />
                    {revealed.chosen.familyName}
                    {revealed.chosen.role ? ` • ${revealed.chosen.role}` : ""}
                  </div>
                </div>

                {/* Lista de Opções de Presentes da Pessoa Sorteada */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                        <Gift className="w-4 h-4 text-rose-600" />
                        Presentes que {revealed.chosen.name} quer ganhar
                      </h3>
                      {revealedOptionGroups.length > 1 && (
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Foram indicadas {revealedOptionGroups.length} opções
                          separadas — escolha uma delas:
                        </p>
                      )}
                    </div>
                    {revealedOptionGroups.length === 1 && (
                      <span className="text-xs font-extrabold px-2.5 py-1 rounded-lg bg-slate-900 text-white">
                        {revealedOptionGroups[0].items.length > 1
                          ? `Soma: ${formatBRL(revealedOptionGroups[0].subtotal)}`
                          : `Valor: ${formatBRL(revealedOptionGroups[0].subtotal)}`}
                      </span>
                    )}
                  </div>

                  {revealedOptionGroups.length > 0 ? (
                    <div className="space-y-3">
                      {revealedOptionGroups.map((group, gIdx) => (
                        <div key={group.optionGroup} className="space-y-2">
                          {gIdx > 0 && (
                            <div className="flex items-center gap-3 py-0.5">
                              <div className="h-px bg-slate-200 flex-1" />
                              <span className="px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[10px] font-extrabold">
                                OU
                              </span>
                              <div className="h-px bg-slate-200 flex-1" />
                            </div>
                          )}

                          <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5">
                            {revealedOptionGroups.length > 1 && (
                              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                <span className="text-xs font-extrabold text-slate-800">
                                  Opção {group.optionGroup}
                                  {group.items.length > 1
                                    ? " (Combo somado)"
                                    : ""}
                                </span>
                                {group.subtotal > 0 && (
                                  <span className="text-xs font-extrabold text-emerald-700">
                                    {group.items.length > 1 ? "Soma: " : ""}
                                    {formatBRL(group.subtotal)}
                                  </span>
                                )}
                              </div>
                            )}

                            {group.items.map((item) => (
                              <div
                                key={item.id}
                                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                              >
                                <div className="min-w-0">
                                  <p className="font-semibold text-sm text-slate-900">
                                    {item.title}
                                  </p>
                                  {item.price > 0 && (
                                    <p className="text-xs font-bold text-emerald-700 mt-0.5">
                                      {formatBRL(item.price)}
                                    </p>
                                  )}
                                </div>

                                {item.url && (
                                  <a
                                    href={item.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 px-3.5 py-2 text-xs font-bold text-rose-700 shrink-0 transition"
                                  >
                                    Abrir Link do Produto
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </a>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic">
                      {revealed.chosen.name} não adicionou links específicos na
                      1ª Rodada (escolha livre!).
                    </p>
                  )}

                  {revealed.chosen.giftHint && (
                    <div className="rounded-xl bg-white border border-slate-200 p-3 text-xs text-slate-700">
                      <span className="font-bold text-slate-900">
                        Observações / Dica:
                      </span>{" "}
                      {revealed.chosen.giftHint}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-1">
              <button
                type="button"
                onClick={() => setHideCard((h) => !h)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                {hideCard ? (
                  <>
                    <Eye className="w-4 h-4" />
                    Mostrar novamente
                  </>
                ) : (
                  <>
                    <EyeOff className="w-4 h-4" />
                    Esconder da tela
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={resetSelection}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 cursor-pointer"
              >
                Concluir e sair
              </button>
            </div>
          </div>
        ) : selectedPerson ? (
          /* Tela 2: Confirmar identidade + PIN e Sortear */
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-5">
            <button
              type="button"
              onClick={resetSelection}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              Escolher outro nome
            </button>

            <div>
              <span
                className="inline-block text-xs font-bold px-2.5 py-0.5 rounded-full text-white mb-2"
                style={{
                  backgroundColor:
                    familyMap.get(selectedPerson.familyId)?.color || "#e11d48",
                }}
              >
                {familyMap.get(selectedPerson.familyId)?.name || "Família"}
              </span>
              <h2 className="text-2xl font-extrabold text-slate-900">
                Olá, {selectedPerson.name}!
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                {!selectedPerson.hasDrawn
                  ? selectedPerson.hasPin
                    ? "Digite o mesmo PIN de 4 números que você criou na 1ª Rodada (presentes) para sortear!"
                    : "Crie um PIN de 4 números (ex: 1234) para proteger seu resultado e clique em sortear."
                  : selectedPerson.needsPinReset
                    ? "O organizador liberou a troca do seu PIN! Escolha um novo PIN de 4 números para ver quem você tirou."
                    : "Você já realizou seu sorteio! Digite seu PIN de 4 números para consultar quem você tirou e os presentes."}
              </p>
            </div>

            {rouletteName ? (
              <div className="py-10 rounded-2xl bg-rose-50 border border-rose-200 text-center space-y-2">
                <Sparkles className="w-7 h-7 text-rose-600 mx-auto animate-bounce" />
                <p className="text-xs font-semibold uppercase tracking-wider text-rose-500">
                  Sorteando e validando regras...
                </p>
                <p className="text-2xl font-extrabold text-slate-900">
                  {rouletteName}
                </p>
              </div>
            ) : (
              <form onSubmit={handleDrawOrReveal} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                    {(!selectedPerson.hasDrawn && !selectedPerson.hasPin) ||
                    selectedPerson.needsPinReset
                      ? "Crie seu PIN secreto (4 dígitos)"
                      : "Seu PIN secreto (4 dígitos)"}
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    pattern="\d{4}"
                    required
                    value={pin}
                    onChange={(e) =>
                      setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
                    }
                    placeholder="••••"
                    className="w-full text-center tracking-[0.6em] text-2xl font-bold rounded-2xl border border-slate-300 py-3.5 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                {actionError && (
                  <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-xs font-semibold text-rose-700">
                    {actionError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || pin.length !== 4}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 py-4 text-base font-bold text-white shadow-sm transition cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Processando...
                    </>
                  ) : !selectedPerson.hasDrawn ? (
                    <>
                      <Sparkles className="w-5 h-5" />
                      Sortear Meu Amigo Secreto!
                    </>
                  ) : (
                    <>
                      <Eye className="w-5 h-5" />
                      Revelar Pessoa e Links de Presentes
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        ) : (
          /* Tela 1: Selecionar Família e Nome */
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-5">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-rose-600" />
              <h2 className="text-lg font-bold text-slate-900">
                Quem é você? Selecione sua família e seu nome:
              </h2>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedFamilyId("ALL")}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
                  selectedFamilyId === "ALL"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Todas as Famílias
              </button>
              {data.families.map((fam) => {
                const active = selectedFamilyId === fam.id;
                return (
                  <button
                    key={fam.id}
                    type="button"
                    onClick={() => setSelectedFamilyId(fam.id)}
                    className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer border ${
                      active
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: fam.color }}
                    />
                    {fam.name}
                  </button>
                );
              })}
            </div>

            {filteredParticipants.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">
                Nenhum participante cadastrado ainda neste sorteio.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {filteredParticipants.map((person) => {
                  const fam = familyMap.get(person.familyId);
                  return (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => {
                        setSelectedPerson(person);
                        setActionError("");
                        setPin("");
                      }}
                      className="text-left rounded-2xl border border-slate-200 hover:border-rose-400 hover:shadow-xs p-4 transition bg-white flex items-center justify-between gap-3 cursor-pointer group"
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: fam?.color || "#e11d48" }}
                          />
                          <span className="text-[11px] font-semibold text-slate-500">
                            {fam?.name}
                          </span>
                        </div>
                        <p className="font-bold text-slate-900 text-base mt-0.5 group-hover:text-rose-600 transition">
                          {person.name}
                        </p>
                      </div>

                      <span
                        className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                          person.hasDrawn
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-rose-50 text-rose-700 border border-rose-200"
                        }`}
                      >
                        {person.hasDrawn ? "Ver com PIN" : "Sortear"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
