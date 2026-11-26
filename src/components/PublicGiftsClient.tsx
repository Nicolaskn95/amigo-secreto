"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Gift,
  Plus,
  Trash2,
  ExternalLink,
  ArrowLeft,
  Loader2,
  RefreshCw,
  Users,
  CheckCircle2,
  AlertTriangle,
  Link2,
  Sparkles,
  Lock,
} from "lucide-react";

interface PublicFamily {
  id: string;
  name: string;
  color: string;
}

interface GiftRoundParticipant {
  id: string;
  familyId: string;
  name: string;
  role: string;
  hasPin: boolean;
  hasGifts: boolean;
  giftItemsCount: number;
}

interface GiftRoundData {
  event: {
    name: string;
    description: string;
    currentRound: "round1_gifts" | "round2_draw" | "completed";
    maxBudget: number | null;
    status: "draft" | "active" | "completed";
    totalParticipants: number;
    withGiftsCount: number;
  };
  families: PublicFamily[];
  participants: GiftRoundParticipant[];
}

interface EditableGiftItem {
  localId: string;
  title: string;
  url: string;
  priceStr: string;
  optionGroup: number;
  scraped: boolean;
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
}

function parseInputPrice(str: string): number {
  const cleaned = str.replace(/[R$\s]/g, "").trim();
  if (!cleaned) return 0;
  if (cleaned.includes(",")) {
    const normalized = cleaned.replace(/\./g, "").replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
}

function normalizeGroups(list: EditableGiftItem[]): EditableGiftItem[] {
  const remap = new Map<number, number>();
  let next = 1;
  return list.map((item) => {
    const g = item.optionGroup >= 1 ? item.optionGroup : 1;
    if (!remap.has(g)) {
      remap.set(g, next++);
    }
    return { ...item, optionGroup: remap.get(g)! };
  });
}

export default function PublicGiftsClient({
  giftToken,
}: {
  giftToken: string;
}) {
  const [data, setData] = useState<GiftRoundData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [selectedFamilyId, setSelectedFamilyId] = useState<string>("ALL");
  const [selectedPerson, setSelectedPerson] =
    useState<GiftRoundParticipant | null>(null);

  const [pin, setPin] = useState("");
  const [unlockedPin, setUnlockedPin] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  // Editor de presentes do participante logado
  const [giftHint, setGiftHint] = useState("");
  const [items, setItems] = useState<EditableGiftItem[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [addMode, setAddMode] = useState<"new_option" | "sum">("new_option");
  const [targetSumGroup, setTargetSumGroup] = useState<number>(1);
  const [scraping, setScraping] = useState(false);
  const [scrapeNotice, setScrapeNotice] = useState<{
    type: "success" | "warning" | "error";
    text: string;
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  const refreshData = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`/api/public/gifts/${giftToken}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) {
        setLoadError(json.error || "Link de presentes não encontrado.");
        return;
      }
      setData(json);
    } catch {
      setLoadError("Erro de conexão ao carregar a 1ª Rodada.");
    } finally {
      setLoading(false);
    }
  }, [giftToken]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/public/gifts/${giftToken}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!active) return;
        if (!res.ok) {
          setLoadError(json.error || "Link de presentes não encontrado.");
          return;
        }
        setData(json);
      } catch {
        if (active) setLoadError("Erro de conexão ao carregar a 1ª Rodada.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [giftToken]);

  const familyMap = useMemo(() => {
    const map = new Map<string, PublicFamily>();
    data?.families.forEach((f) => map.set(f.id, f));
    return map;
  }, [data]);

  const filteredParticipants = useMemo(() => {
    if (!data) return [];
    if (selectedFamilyId === "ALL") return data.participants;
    return data.participants.filter((p) => p.familyId === selectedFamilyId);
  }, [data, selectedFamilyId]);

  const optionSummaries = useMemo(() => {
    const map = new Map<number, EditableGiftItem[]>();
    for (const item of items) {
      const g = item.optionGroup || 1;
      const arr = map.get(g) || [];
      arr.push(item);
      map.set(g, arr);
    }

    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([optionGroup, groupItems]) => {
        const subtotal = Math.round(
          groupItems.reduce(
            (acc, it) => acc + parseInputPrice(it.priceStr),
            0
          ) * 100
        ) / 100;
        return {
          optionGroup,
          items: groupItems,
          subtotal,
        };
      });
  }, [items]);

  const maxOptionValue = useMemo(() => {
    if (optionSummaries.length === 0) return 0;
    return Math.max(...optionSummaries.map((g) => g.subtotal));
  }, [optionSummaries]);

  function getNextTargetOptionGroup(): number {
    if (items.length === 0) return 1;
    if (addMode === "sum") {
      const exists = optionSummaries.some(
        (g) => g.optionGroup === targetSumGroup
      );
      return exists ? targetSumGroup : optionSummaries[0].optionGroup;
    }
    return Math.max(...items.map((it) => it.optionGroup || 1)) + 1;
  }

  async function handleUnlockWithPin(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPerson) return;

    if (!/^\d{4}$/.test(pin.trim())) {
      setAuthError("Informe exatamente 4 dígitos numéricos.");
      return;
    }

    setAuthError("");
    setAuthLoading(true);
    try {
      const res = await fetch(`/api/public/gifts/${giftToken}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: selectedPerson.id,
          pin: pin.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setAuthError(json.error || "Não foi possível entrar.");
        return;
      }

      setUnlockedPin(pin.trim());
      setGiftHint(json.giftHint || "");
      const loadedItems: EditableGiftItem[] = (json.giftItems || []).map(
        (
          it: {
            id?: string;
            title: string;
            url: string;
            price: number;
            optionGroup?: number;
            scraped: boolean;
          },
          idx: number
        ) => ({
          localId: it.id || `item-${Date.now()}-${idx}`,
          title: it.title,
          url: it.url || "",
          priceStr: Number(it.price || 0).toFixed(2).replace(".", ","),
          optionGroup:
            typeof it.optionGroup === "number" && it.optionGroup >= 1
              ? it.optionGroup
              : 1,
          scraped: Boolean(it.scraped),
        })
      );
      setItems(normalizeGroups(loadedItems));
      setScrapeNotice(null);
      setSavedSuccess(false);
    } catch {
      setAuthError("Falha de conexão. Tente novamente.");
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleScrapeUrl(e: React.FormEvent) {
    e.preventDefault();
    const rawUrl = urlInput.trim();
    if (!rawUrl) return;

    setScraping(true);
    setScrapeNotice(null);
    setSavedSuccess(false);

    try {
      const res = await fetch(`/api/public/gifts/${giftToken}/scrape`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: rawUrl }),
      });
      const json = await res.json();
      if (!res.ok) {
        setScrapeNotice({
          type: "error",
          text: json.error || "Link inválido.",
        });
        return;
      }

      const detectedPrice =
        typeof json.price === "number" && json.price > 0 ? json.price : 0;

      const assignedGroup = getNextTargetOptionGroup();

      setItems((prev) =>
        normalizeGroups([
          ...prev,
          {
            localId: `item-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            title: json.title || "Produto com link",
            url: json.url || rawUrl,
            priceStr:
              detectedPrice > 0
                ? detectedPrice.toFixed(2).replace(".", ",")
                : "",
            optionGroup: assignedGroup,
            scraped: Boolean(json.scrapedSuccessfully),
          },
        ])
      );
      setUrlInput("");

      if (json.scrapedSuccessfully && detectedPrice > 0) {
        setScrapeNotice({
          type: "success",
          text:
            items.length > 0 && addMode === "new_option"
              ? `Adicionado como Opção ${assignedGroup} (${formatBRL(detectedPrice)}) sem somar com as anteriores!`
              : `Valor capturado automaticamente: ${formatBRL(detectedPrice)}!`,
        });
      } else {
        setScrapeNotice({
          type: "warning",
          text:
            json.warning ||
            "Link adicionado! Digite o valor em R$ manualmente no campo abaixo.",
        });
      }
    } catch {
      setScrapeNotice({
        type: "error",
        text: "Erro de rede ao tentar ler o link.",
      });
    } finally {
      setScraping(false);
    }
  }

  function handleAddManualItem() {
    setSavedSuccess(false);
    const assignedGroup = getNextTargetOptionGroup();
    setItems((prev) =>
      normalizeGroups([
        ...prev,
        {
          localId: `manual-${Date.now()}`,
          title: "",
          url: "",
          priceStr: "",
          optionGroup: assignedGroup,
          scraped: false,
        },
      ])
    );
  }

  function updateItem(
    localId: string,
    field: "title" | "url" | "priceStr",
    value: string
  ) {
    setSavedSuccess(false);
    setItems((prev) =>
      prev.map((it) => (it.localId === localId ? { ...it, [field]: value } : it))
    );
  }

  function changeItemOptionGroup(localId: string, rawTarget: string) {
    setSavedSuccess(false);
    setItems((prev) => {
      const nextGroupNumber =
        rawTarget === "NEW"
          ? Math.max(0, ...prev.map((i) => i.optionGroup)) + 1
          : Number(rawTarget) || 1;

      const updated = prev.map((it) =>
        it.localId === localId ? { ...it, optionGroup: nextGroupNumber } : it
      );
      return normalizeGroups(updated);
    });
  }

  function removeItem(localId: string) {
    setSavedSuccess(false);
    setItems((prev) =>
      normalizeGroups(prev.filter((it) => it.localId !== localId))
    );
  }

  async function handleSaveGifts(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPerson || !unlockedPin) return;

    const payloadItems = items
      .filter((it) => it.title.trim() || it.url.trim())
      .map((it) => ({
        title: it.title.trim() || "Sugestão de presente",
        url: it.url.trim(),
        price: parseInputPrice(it.priceStr),
        optionGroup: it.optionGroup || 1,
        scraped: it.scraped,
      }));

    setSaving(true);
    setScrapeNotice(null);
    setSavedSuccess(false);

    try {
      const res = await fetch(`/api/public/gifts/${giftToken}/items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId: selectedPerson.id,
          pin: unlockedPin,
          giftHint: giftHint.trim(),
          giftItems: payloadItems,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setScrapeNotice({
          type: "error",
          text: json.error || "Erro ao salvar lista de presentes.",
        });
        return;
      }

      setSavedSuccess(true);
      await refreshData();
    } catch {
      setScrapeNotice({
        type: "error",
        text: "Erro de conexão ao salvar seus presentes.",
      });
    } finally {
      setSaving(false);
    }
  }

  function resetToHome() {
    setSelectedPerson(null);
    setPin("");
    setUnlockedPin(null);
    setAuthError("");
    setScrapeNotice(null);
    setSavedSuccess(false);
  }

  if (loading && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="flex items-center gap-2.5 text-slate-600 text-sm font-medium">
          <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
          Carregando 1ª Rodada (Presentes)...
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
          (data.event.withGiftsCount / data.event.totalParticipants) * 100
        )
      : 0;

  const isOverBudget =
    data.event.maxBudget !== null &&
    data.event.maxBudget > 0 &&
    maxOptionValue > data.event.maxBudget;

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50/70 via-white to-slate-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Cabeçalho da 1ª Rodada */}
        <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs text-center relative">
          <button
            type="button"
            onClick={refreshData}
            title="Atualizar"
            className="absolute right-4 top-4 p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
          </button>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100 text-blue-800 text-xs font-bold mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            1ª Rodada — O que você quer ganhar? (Opcional)
          </div>

          <h1 className="text-2xl font-extrabold text-slate-900">
            {data.event.name}
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">
            Adicione links dos produtos que gostaria de ganhar — você pode
            cadastrar <strong>opções alternativas</strong> (sem somar) ou{" "}
            <strong>somar itens em combo</strong>!
          </p>

          {data.event.maxBudget !== null && data.event.maxBudget > 0 && (
            <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
              Valor sugerido por opção: até{" "}
              <strong>{formatBRL(data.event.maxBudget)}</strong>
            </div>
          )}

          <div className="mt-5 max-w-md mx-auto">
            <div className="flex items-center justify-between text-xs font-medium text-slate-600 mb-1.5">
              <span>Integrantes que já preencheram presentes</span>
              <span className="font-bold text-blue-600">
                {data.event.withGiftsCount} de {data.event.totalParticipants} (
                {progressPct}%)
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 rounded-full transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Caso a 1ª Rodada já tenha sido encerrada pelo Admin */}
        {data.event.currentRound !== "round1_gifts" ? (
          <div className="bg-white rounded-3xl border border-amber-200 p-8 text-center space-y-3 shadow-xs">
            <Lock className="w-10 h-10 text-amber-500 mx-auto" />
            <h2 className="text-lg font-bold text-slate-900">
              1ª Rodada encerrada!
            </h2>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              O organizador já encerrou o envio de listas de presentes e abriu a{" "}
              <strong>2ª Rodada (Sorteio do Amigo Secreto)</strong>. Peça o link
              do sorteio no grupo da família!
            </p>
          </div>
        ) : selectedPerson && unlockedPin ? (
          /* Etapa 3: Editor de Links (Opções Alternativas vs Somar Combo) */
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={resetToHome}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                Voltar à lista de nomes
              </button>

              <span
                className="text-xs font-bold px-2.5 py-0.5 rounded-full text-white"
                style={{
                  backgroundColor:
                    familyMap.get(selectedPerson.familyId)?.color || "#2563eb",
                }}
              >
                {familyMap.get(selectedPerson.familyId)?.name}
              </span>
            </div>

            <div>
              <h2 className="text-xl font-extrabold text-slate-900">
                Presentes de {selectedPerson.name}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Escolha abaixo se o próximo link é uma{" "}
                <strong>outra opção de presente (não soma)</strong> ou se deve{" "}
                <strong>somar junto</strong> em um combo.
              </p>
            </div>

            {/* Adicionar Link com Web Scraping + Escolha "Outra Opção" vs "Somar" */}
            <form
              onSubmit={handleScrapeUrl}
              className="rounded-2xl bg-blue-50/70 border border-blue-200 p-4 space-y-3"
            >
              {items.length > 0 && (
                <div className="space-y-2 pb-2 border-b border-blue-200/70">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-blue-900">
                    Como adicionar o próximo produto?
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setAddMode("new_option")}
                      className={`rounded-xl border px-3 py-2 text-left text-xs transition cursor-pointer ${
                        addMode === "new_option"
                          ? "bg-blue-600 text-white border-blue-600 font-bold shadow-xs"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <span className="block">
                        Outra opção de presente (OU)
                      </span>
                      <span
                        className={`block text-[10px] mt-0.5 ${
                          addMode === "new_option"
                            ? "text-blue-100"
                            : "text-slate-500"
                        }`}
                      >
                        Não soma — quem te tirar escolhe 1 opção
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setAddMode("sum");
                        if (optionSummaries[0]) {
                          setTargetSumGroup(optionSummaries[0].optionGroup);
                        }
                      }}
                      className={`rounded-xl border px-3 py-2 text-left text-xs transition cursor-pointer ${
                        addMode === "sum"
                          ? "bg-slate-900 text-white border-slate-900 font-bold shadow-xs"
                          : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <span className="block">Somar junto (+ Combo)</span>
                      <span
                        className={`block text-[10px] mt-0.5 ${
                          addMode === "sum" ? "text-slate-300" : "text-slate-500"
                        }`}
                      >
                        Soma o valor junto na mesma opção
                      </span>
                    </button>
                  </div>

                  {addMode === "sum" && optionSummaries.length > 1 && (
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-xs font-medium text-slate-700">
                        Somar dentro da:
                      </span>
                      <select
                        value={targetSumGroup}
                        onChange={(e) =>
                          setTargetSumGroup(Number(e.target.value))
                        }
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold"
                      >
                        {optionSummaries.map((g) => (
                          <option key={g.optionGroup} value={g.optionGroup}>
                            Opção {g.optionGroup} (atual:{" "}
                            {formatBRL(g.subtotal)})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <label className="block text-xs font-bold text-blue-900">
                Link do produto (captura automática do valor em R$):
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Link2 className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="Cole o link do produto (https://...)"
                    className="w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <button
                  type="submit"
                  disabled={scraping || !urlInput.trim()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 px-4 py-2.5 text-xs font-bold text-white transition cursor-pointer shrink-0"
                >
                  {scraping ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Lendo preço...
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      Adicionar Link
                    </>
                  )}
                </button>
              </div>
            </form>

            {scrapeNotice && (
              <div
                className={`rounded-xl border px-3.5 py-2.5 text-xs font-medium flex items-center gap-2 ${
                  scrapeNotice.type === "success"
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                    : scrapeNotice.type === "warning"
                      ? "bg-amber-50 border-amber-200 text-amber-800"
                      : "bg-rose-50 border-rose-200 text-rose-700"
                }`}
              >
                {scrapeNotice.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                )}
                <span>{scrapeNotice.text}</span>
              </div>
            )}

            {/* Lista Agrupada por Opção 1, Opção 2... */}
            <form onSubmit={handleSaveGifts} className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Suas Opções de Presente ({optionSummaries.length} opção/ões)
                  </span>
                  <button
                    type="button"
                    onClick={handleAddManualItem}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-800 cursor-pointer"
                  >
                    + Adicionar item sem link
                  </button>
                </div>

                {optionSummaries.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 py-6 px-4 text-center text-xs text-slate-400">
                    Nenhum presente adicionado ainda. Cole o link de um produto
                    acima ou clique em &ldquo;+ Adicionar item sem link&rdquo;.
                  </div>
                ) : (
                  optionSummaries.map((group, groupIdx) => (
                    <div key={group.optionGroup} className="space-y-3">
                      {groupIdx > 0 && (
                        <div className="flex items-center gap-3 py-1">
                          <div className="h-px bg-slate-200 flex-1" />
                          <span className="px-3 py-0.5 rounded-full bg-blue-100 text-blue-800 text-[11px] font-extrabold">
                            OU OUTRA OPÇÃO
                          </span>
                          <div className="h-px bg-slate-200 flex-1" />
                        </div>
                      )}

                      <div className="rounded-2xl border-2 border-slate-200 bg-slate-50/60 p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate-900">
                            Opção {group.optionGroup}
                            {group.items.length > 1 && (
                              <span className="text-[11px] font-semibold text-slate-500">
                                ({group.items.length} itens somados em combo)
                              </span>
                            )}
                          </span>

                          <span className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-bold">
                            {group.items.length > 1 ? "Soma: " : "Valor: "}
                            {formatBRL(group.subtotal)}
                          </span>
                        </div>

                        {group.items.map((item) => (
                          <div
                            key={item.localId}
                            className="rounded-xl border border-slate-200 bg-white p-3 space-y-2.5"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <label className="text-[11px] font-semibold text-slate-500">
                                  Modo:
                                </label>
                                <select
                                  value={String(item.optionGroup)}
                                  onChange={(e) =>
                                    changeItemOptionGroup(
                                      item.localId,
                                      e.target.value
                                    )
                                  }
                                  className="rounded-lg border border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-800"
                                >
                                  {optionSummaries.map((opt) => (
                                    <option
                                      key={opt.optionGroup}
                                      value={String(opt.optionGroup)}
                                    >
                                      {opt.optionGroup === item.optionGroup
                                        ? `Na Opção ${opt.optionGroup}`
                                        : `Somar junto na Opção ${opt.optionGroup}`}
                                    </option>
                                  ))}
                                  {(group.items.length > 1 ||
                                    optionSummaries.length >= 1) &&
                                    group.items.length > 1 && (
                                      <option value="NEW">
                                        Separar como Outra Opção (não somar)
                                      </option>
                                    )}
                                </select>

                                {item.scraped && (
                                  <span className="text-[10px] text-emerald-600 font-semibold">
                                    • Preço lido do site
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                {item.url && (
                                  <a
                                    href={item.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:underline"
                                  >
                                    Testar link
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                )}
                                <button
                                  type="button"
                                  onClick={() => removeItem(item.localId)}
                                  className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                                  title="Remover item"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                              <div className="sm:col-span-8">
                                <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                  Nome do produto
                                </label>
                                <input
                                  type="text"
                                  required
                                  value={item.title}
                                  onChange={(e) =>
                                    updateItem(
                                      item.localId,
                                      "title",
                                      e.target.value
                                    )
                                  }
                                  placeholder="Ex: Fone Bluetooth JBL"
                                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                                />
                              </div>

                              <div className="sm:col-span-4">
                                <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                  Valor (R$)
                                </label>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  value={item.priceStr}
                                  onChange={(e) =>
                                    updateItem(
                                      item.localId,
                                      "priceStr",
                                      e.target.value
                                    )
                                  }
                                  placeholder="0,00"
                                  className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                Link do produto (opcional)
                              </label>
                              <input
                                type="text"
                                value={item.url}
                                onChange={(e) =>
                                  updateItem(
                                    item.localId,
                                    "url",
                                    e.target.value
                                  )
                                }
                                placeholder="https://..."
                                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Card de Resumo Inteligente (Opções Separadas vs Soma) */}
              {optionSummaries.length > 0 && (
                <div
                  className={`rounded-2xl p-4 border space-y-2 ${
                    isOverBudget
                      ? "bg-amber-50 border-amber-300 text-amber-900"
                      : "bg-slate-900 border-slate-900 text-white"
                  }`}
                >
                  {optionSummaries.length === 1 ? (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium opacity-80">
                          Valor total da Opção 1:
                        </p>
                        {isOverBudget && data.event.maxBudget && (
                          <p className="text-[11px] font-semibold text-amber-700 mt-0.5">
                            Acima do valor sugerido de{" "}
                            {formatBRL(data.event.maxBudget)}
                          </p>
                        )}
                      </div>
                      <span className="text-2xl font-extrabold">
                        {formatBRL(optionSummaries[0].subtotal)}
                      </span>
                    </div>
                  ) : (
                    <>
                      <p className="text-xs font-semibold opacity-90">
                        Você cadastrou {optionSummaries.length} opções separadas
                        (quem tirar você escolherá 1 delas):
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {optionSummaries.map((g, idx) => (
                          <div
                            key={g.optionGroup}
                            className="inline-flex items-center gap-2"
                          >
                            {idx > 0 && (
                              <span className="text-[11px] font-bold opacity-70">
                                OU
                              </span>
                            )}
                            <span
                              className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                                isOverBudget
                                  ? "bg-white border border-amber-300 text-amber-900"
                                  : "bg-white/15 text-white"
                              }`}
                            >
                              Opção {g.optionGroup}: {formatBRL(g.subtotal)}
                            </span>
                          </div>
                        ))}
                      </div>
                      {isOverBudget && data.event.maxBudget && (
                        <p className="text-[11px] font-semibold text-amber-700 pt-1">
                          Uma das opções ultrapassa o valor sugerido de{" "}
                          {formatBRL(data.event.maxBudget)}.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* Observação Livre */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Observações adicionais (tamanho de roupa/calçado, cor, etc. —
                  opcional):
                </label>
                <textarea
                  rows={2}
                  value={giftHint}
                  onChange={(e) => {
                    setSavedSuccess(false);
                    setGiftHint(e.target.value);
                  }}
                  placeholder="Ex: Uso camiseta tamanho G, calçado nº 41..."
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {savedSuccess && (
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-xs font-semibold text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  Opções de presente salvas com sucesso! Na 2ª Rodada, quem
                  tirar você verá cada opção certinha.
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 py-3.5 text-sm font-bold text-white shadow-sm transition cursor-pointer"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Salvando presentes...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Salvar Meus Presentes
                  </>
                )}
              </button>
            </form>
          </div>
        ) : selectedPerson ? (
          /* Etapa 2: Criar ou Digitar PIN de 4 dígitos */
          <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-sm space-y-5">
            <button
              type="button"
              onClick={resetToHome}
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
                    familyMap.get(selectedPerson.familyId)?.color || "#2563eb",
                }}
              >
                {familyMap.get(selectedPerson.familyId)?.name}
              </span>
              <h2 className="text-2xl font-extrabold text-slate-900">
                Olá, {selectedPerson.name}!
              </h2>
              <p className="text-sm text-slate-600 mt-1">
                {selectedPerson.hasPin
                  ? "Digite seu PIN de 4 dígitos para visualizar ou editar seus links de presente."
                  : "Crie um PIN numérico de 4 dígitos. Guarde-o bem: você usará esse mesmo PIN na 2ª Rodada para sortear seu Amigo Secreto!"}
              </p>
            </div>

            <form onSubmit={handleUnlockWithPin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-2">
                  {selectedPerson.hasPin
                    ? "Seu PIN (4 dígitos)"
                    : "Crie seu PIN (4 dígitos)"}
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
                  className="w-full text-center tracking-[0.6em] text-2xl font-bold rounded-2xl border border-slate-300 py-3.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {authError && (
                <div className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-3 text-xs font-semibold text-rose-700">
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={authLoading || pin.length !== 4}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 py-3.5 text-sm font-bold text-white transition cursor-pointer"
              >
                {authLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Verificando...
                  </>
                ) : (
                  "Continuar para Meus Presentes"
                )}
              </button>
            </form>
          </div>
        ) : (
          /* Etapa 1: Escolher Família e Nome */
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-xs space-y-5">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" />
              <h2 className="text-lg font-bold text-slate-900">
                Selecione sua família e seu nome para indicar seus presentes:
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredParticipants.map((person) => {
                const fam = familyMap.get(person.familyId);
                return (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => {
                      setSelectedPerson(person);
                      setPin("");
                      setAuthError("");
                    }}
                    className="text-left rounded-2xl border border-slate-200 hover:border-blue-400 hover:shadow-xs p-4 transition bg-white flex items-center justify-between gap-3 cursor-pointer group"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: fam?.color || "#2563eb" }}
                        />
                        <span className="text-[11px] font-semibold text-slate-500">
                          {fam?.name}
                        </span>
                      </div>
                      <p className="font-bold text-slate-900 text-base mt-0.5 group-hover:text-blue-600 transition">
                        {person.name}
                      </p>
                    </div>

                    <span
                      className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                        person.hasGifts
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-blue-50 text-blue-700 border border-blue-200"
                      }`}
                    >
                      {person.giftItemsCount > 0
                        ? `${person.giftItemsCount} link(s)`
                        : person.hasGifts
                          ? "Preenchido"
                          : "Adicionar"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
