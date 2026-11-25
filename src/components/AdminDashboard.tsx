"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Gift,
  Plus,
  Trash2,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  CheckCircle2,
  Users,
  Ban,
  LogOut,
  Edit3,
  KeyRound,
  Sparkles,
  Loader2,
  Link2,
  ArrowRight,
} from "lucide-react";

interface EventSummary {
  id: string;
  name: string;
  description: string;
  giftToken: string;
  shareToken: string;
  currentRound: "round1_gifts" | "round2_draw" | "completed";
  maxBudget: number | null;
  status: "draft" | "active" | "completed";
  familyCount: number;
  participantCount: number;
  giftsSubmittedCount: number;
  drawnCount: number;
  ruleCount: number;
}

interface FamilyItem {
  id: string;
  name: string;
  color: string;
}

interface ParticipantItem {
  id: string;
  familyId: string;
  name: string;
  role: string;
  giftHint: string;
  giftItemsCount: number;
  giftsTotal: number;
  hasDrawn: boolean;
  hasPin: boolean;
  reRollCount: number;
  drawnAt: string | null;
}

interface RuleItem {
  id: string;
  scope:
    | "PARTICIPANT_TO_PARTICIPANT"
    | "PARTICIPANT_TO_FAMILY"
    | "FAMILY_TO_FAMILY"
    | "FAMILY_TO_PARTICIPANT";
  sourceParticipantId: string | null;
  sourceFamilyId: string | null;
  targetParticipantId: string | null;
  targetFamilyId: string | null;
  description: string;
}

interface EventDetails {
  event: {
    id: string;
    name: string;
    description: string;
    giftToken: string;
    shareToken: string;
    currentRound: "round1_gifts" | "round2_draw" | "completed";
    maxBudget: number | null;
    status: "draft" | "active" | "completed";
    drawSequence: number;
  };
  families: FamilyItem[];
  participants: ParticipantItem[];
  rules: RuleItem[];
  viability: {
    isValid: boolean;
    reason?: string;
    totalParticipants: number;
    drawnCount: number;
    remainingCount: number;
  };
}

const FAMILY_COLORS = [
  { label: "Azul", value: "#2563eb" },
  { label: "Rosa", value: "#e11d48" },
  { label: "Esmeralda", value: "#059669" },
  { label: "Roxo", value: "#7c3aed" },
  { label: "Âmbar", value: "#d97706" },
  { label: "Ciano", value: "#0891b2" },
];

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
}

export default function AdminDashboard() {
  const router = useRouter();

  const [events, setEvents] = useState<EventSummary[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [details, setDetails] = useState<EventDetails | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [copiedGift, setCopiedGift] = useState(false);
  const [copiedDraw, setCopiedDraw] = useState(false);

  // Teto opcional
  const [budgetInput, setBudgetInput] = useState("");

  // Criar Sorteio
  const [newEventName, setNewEventName] = useState("");
  const [creatingEvent, setCreatingEvent] = useState(false);

  // Criar / Editar Família
  const [newFamilyName, setNewFamilyName] = useState("");
  const [newFamilyColor, setNewFamilyColor] = useState(FAMILY_COLORS[0].value);
  const [editingFamilyId, setEditingFamilyId] = useState<string | null>(null);
  const [editFamilyName, setEditFamilyName] = useState("");
  const [editFamilyColor, setEditFamilyColor] = useState("");

  // Criar / Editar Integrante por família
  const [memberDrafts, setMemberDrafts] = useState<
    Record<string, { name: string; role: string; giftHint: string }>
  >({});
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editMemberForm, setEditMemberForm] = useState({
    name: "",
    role: "",
    giftHint: "",
  });

  // Construtor de Regras
  const [ruleScope, setRuleScope] = useState<RuleItem["scope"]>(
    "PARTICIPANT_TO_PARTICIPANT"
  );
  const [selectedSourceParticipants, setSelectedSourceParticipants] = useState<
    string[]
  >([]);
  const [selectedTargetParticipants, setSelectedTargetParticipants] = useState<
    string[]
  >([]);
  const [selectedSourceFamily, setSelectedSourceFamily] = useState<string>("");
  const [selectedTargetFamily, setSelectedTargetFamily] = useState<string>("");

  const notify = useCallback((type: "success" | "error", text: string) => {
    setFeedback({ type, text });
    setTimeout(() => {
      setFeedback((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  }, []);

  const loadEvents = useCallback(
    async (preferId?: string) => {
      setLoadingList(true);
      try {
        const res = await fetch("/api/admin/events");
        if (res.status === 401) {
          router.push("/admin/login");
          return;
        }
        const data = await res.json();
        const list: EventSummary[] = data.events || [];
        setEvents(list);

        const nextId =
          preferId ||
          (list.some((e) => e.id === selectedEventId)
            ? selectedEventId
            : list[0]?.id || "");

        setSelectedEventId(nextId);
      } catch {
        notify("error", "Erro ao carregar lista de sorteios.");
      } finally {
        setLoadingList(false);
      }
    },
    [notify, router, selectedEventId]
  );

  const loadEventDetails = useCallback(
    async (eventId: string) => {
      if (!eventId) {
        setDetails(null);
        return;
      }
      setLoadingDetails(true);
      try {
        const res = await fetch(`/api/admin/events/${eventId}`);
        const data = await res.json();
        if (!res.ok) {
          notify("error", data.error || "Erro ao abrir sorteio.");
          return;
        }
        setDetails(data);
        setBudgetInput(
          data.event.maxBudget !== null && data.event.maxBudget !== undefined
            ? String(data.event.maxBudget)
            : ""
        );
        if (data.families?.length > 0) {
          setSelectedSourceFamily((prev) => prev || data.families[0].id);
          setSelectedTargetFamily(
            (prev) => prev || data.families[data.families.length - 1].id
          );
        }
      } catch {
        notify("error", "Falha ao carregar detalhes do sorteio.");
      } finally {
        setLoadingDetails(false);
      }
    },
    [notify]
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/events");
        if (res.status === 401) {
          router.push("/admin/login");
          return;
        }
        const data = await res.json();
        if (!active) return;
        const list: EventSummary[] = data.events || [];
        setEvents(list);
        if (list[0]?.id) {
          setSelectedEventId(list[0].id);
        }
      } catch {
        if (active) notify("error", "Erro ao carregar lista de sorteios.");
      } finally {
        if (active) setLoadingList(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [notify, router]);

  useEffect(() => {
    if (!selectedEventId) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/admin/events/${selectedEventId}`);
        const data = await res.json();
        if (!active) return;
        if (!res.ok) {
          notify("error", data.error || "Erro ao abrir sorteio.");
          return;
        }
        setDetails(data);
        setBudgetInput(
          data.event.maxBudget !== null && data.event.maxBudget !== undefined
            ? String(data.event.maxBudget)
            : ""
        );
        if (data.families?.length > 0) {
          setSelectedSourceFamily((prev) => prev || data.families[0].id);
          setSelectedTargetFamily(
            (prev) => prev || data.families[data.families.length - 1].id
          );
        }
      } catch {
        if (active) notify("error", "Falha ao carregar detalhes do sorteio.");
      } finally {
        if (active) setLoadingDetails(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedEventId, notify]);

  const giftUrl = details?.event.giftToken
    ? typeof window === "undefined"
      ? `/presentes/${details.event.giftToken}`
      : `${window.location.origin}/presentes/${details.event.giftToken}`
    : "";

  const shareUrl = details?.event.shareToken
    ? typeof window === "undefined"
      ? `/s/${details.event.shareToken}`
      : `${window.location.origin}/s/${details.event.shareToken}`
    : "";

  const withGiftsCount = useMemo(() => {
    if (!details) return 0;
    return details.participants.filter(
      (p) => p.giftItemsCount > 0 || Boolean(p.giftHint)
    ).length;
  }, [details]);

  async function handleLogout() {
    await fetch("/api/admin/auth", { method: "DELETE" });
    router.push("/admin/login");
  }

  async function handleCreateEvent(seedDemo: boolean) {
    const title =
      newEventName.trim() ||
      (seedDemo
        ? "Amigo Secreto — Família 1 & Família 2"
        : "Novo Sorteio entre Famílias");

    setCreatingEvent(true);
    try {
      const res = await fetch("/api/admin/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: title,
          seedDemo,
          createDefaultFamilies: !seedDemo,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify("error", data.error || "Erro ao criar sorteio.");
        return;
      }
      setNewEventName("");
      notify(
        "success",
        seedDemo
          ? "Sorteio exemplo criado na 1ª Rodada (presentes)!"
          : "Novo sorteio criado na 1ª Rodada!"
      );
      await loadEvents(data.id);
    } finally {
      setCreatingEvent(false);
    }
  }

  async function handleDeleteEvent(eventId: string) {
    if (
      !window.confirm(
        "Tem certeza que deseja excluir este sorteio, todas as famílias, integrantes e regras?"
      )
    ) {
      return;
    }
    const res = await fetch(`/api/admin/events/${eventId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      notify("success", "Sorteio removido.");
      setSelectedEventId("");
      setDetails(null);
      await loadEvents();
    } else {
      const data = await res.json();
      notify("error", data.error || "Não foi possível excluir.");
    }
  }

  async function handleSetRound(
    targetRound: "round1_gifts" | "round2_draw"
  ) {
    if (!details) return;
    const res = await fetch(`/api/admin/events/${details.event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "set_round",
        currentRound: targetRound,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify("error", data.error || "Erro ao alterar rodada.");
      return;
    }
    notify(
      "success",
      targetRound === "round1_gifts"
        ? "1ª Rodada (Lista de Presentes) aberta!"
        : "2ª Rodada (Sorteio) liberada! Compartilhe o link do sorteio."
    );
    await Promise.all([
      loadEventDetails(details.event.id),
      loadEvents(details.event.id),
    ]);
  }

  async function handleSaveBudget(e: React.FormEvent) {
    e.preventDefault();
    if (!details) return;
    const trimmed = budgetInput.replace(",", ".").trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 0)) {
      notify("error", "Informe um valor válido em reais ou deixe em branco.");
      return;
    }

    const res = await fetch(`/api/admin/events/${details.event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        maxBudget: parsed,
      }),
    });
    if (res.ok) {
      notify(
        "success",
        parsed
          ? `Valor sugerido definido em ${formatBRL(parsed)}!`
          : "Limite de valor removido."
      );
      await loadEventDetails(details.event.id);
    }
  }

  async function handleEventAction(
    action: "regenerate_gift_link" | "regenerate_link" | "reset_draws"
  ) {
    if (!details) return;
    if (
      action === "reset_draws" &&
      !window.confirm(
        "Isso reiniciará os sorteios feitos na 2ª Rodada, preservando os presentes cadastrados na 1ª Rodada. Confirmar?"
      )
    ) {
      return;
    }

    const res = await fetch(`/api/admin/events/${details.event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify("error", data.error || "Falha ao atualizar sorteio.");
      return;
    }
    notify(
      "success",
      action === "reset_draws"
        ? "Sorteios reiniciados (presentes preservados)!"
        : "Novo link gerado com sucesso!"
    );
    await Promise.all([
      loadEventDetails(details.event.id),
      loadEvents(details.event.id),
    ]);
  }

  async function handleCreateFamily(e: React.FormEvent) {
    e.preventDefault();
    if (!details || !newFamilyName.trim()) return;

    const res = await fetch("/api/admin/families", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: details.event.id,
        name: newFamilyName.trim(),
        color: newFamilyColor,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify("error", data.error || "Erro ao criar família.");
      return;
    }
    setNewFamilyName("");
    notify("success", `Família "${data.family.name}" criada!`);
    await Promise.all([
      loadEventDetails(details.event.id),
      loadEvents(details.event.id),
    ]);
  }

  async function handleSaveFamily(familyId: string) {
    if (!details || !editFamilyName.trim()) return;
    const res = await fetch(`/api/admin/families/${familyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editFamilyName.trim(),
        color: editFamilyColor,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify("error", data.error || "Erro ao atualizar família.");
      return;
    }
    setEditingFamilyId(null);
    notify("success", "Família atualizada!");
    await loadEventDetails(details.event.id);
  }

  async function handleDeleteFamily(familyId: string, familyName: string) {
    if (!details) return;
    if (
      !window.confirm(
        `Excluir "${familyName}" também removerá seus integrantes e regras associadas. Confirmar?`
      )
    ) {
      return;
    }
    const res = await fetch(`/api/admin/families/${familyId}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) {
      notify("error", data.error || "Erro ao excluir família.");
      return;
    }
    notify("success", `Família "${familyName}" excluída.`);
    await Promise.all([
      loadEventDetails(details.event.id),
      loadEvents(details.event.id),
    ]);
  }

  async function handleAddParticipant(familyId: string, e: React.FormEvent) {
    e.preventDefault();
    if (!details) return;
    const draft = memberDrafts[familyId] || { name: "", role: "", giftHint: "" };
    if (!draft.name.trim()) return;

    const res = await fetch("/api/admin/participants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: details.event.id,
        familyId,
        name: draft.name.trim(),
        role: draft.role.trim(),
        giftHint: draft.giftHint.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify("error", data.error || "Erro ao adicionar integrante.");
      return;
    }

    setMemberDrafts((prev) => ({
      ...prev,
      [familyId]: { name: "", role: "", giftHint: "" },
    }));
    notify("success", `${data.participant.name} adicionado(a)!`);
    await Promise.all([
      loadEventDetails(details.event.id),
      loadEvents(details.event.id),
    ]);
  }

  async function handleSaveParticipant(participantId: string) {
    if (!details || !editMemberForm.name.trim()) return;
    const res = await fetch(`/api/admin/participants/${participantId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        name: editMemberForm.name.trim(),
        role: editMemberForm.role.trim(),
        giftHint: editMemberForm.giftHint.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify("error", data.error || "Erro ao editar integrante.");
      return;
    }
    setEditingMemberId(null);
    notify("success", "Integrante atualizado!");
    await loadEventDetails(details.event.id);
  }

  async function handleResetParticipantPin(participant: ParticipantItem) {
    if (!details) return;
    if (
      !window.confirm(
        `Limpar o PIN de "${participant.name}"? Ele(a) poderá cadastrar um novo PIN de 4 dígitos ao acessar o link.`
      )
    ) {
      return;
    }
    const res = await fetch(`/api/admin/participants/${participant.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset_pin" }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify("error", data.error || "Erro ao limpar PIN.");
      return;
    }
    notify("success", data.message || "PIN resetado!");
    await loadEventDetails(details.event.id);
  }

  async function handleDeleteParticipant(participant: ParticipantItem) {
    if (!details) return;
    const res = await fetch(`/api/admin/participants/${participant.id}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) {
      notify("error", data.error || "Erro ao remover integrante.");
      return;
    }
    notify("success", `"${participant.name}" removido(a).`);
    await Promise.all([
      loadEventDetails(details.event.id),
      loadEvents(details.event.id),
    ]);
  }

  async function handleCreateRule(e: React.FormEvent) {
    e.preventDefault();
    if (!details) return;

    const res = await fetch("/api/admin/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: details.event.id,
        scope: ruleScope,
        sourceParticipantIds: selectedSourceParticipants,
        targetParticipantIds: selectedTargetParticipants,
        sourceFamilyId: selectedSourceFamily || null,
        targetFamilyId: selectedTargetFamily || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify("error", data.error || "Erro ao criar regra.");
      return;
    }
    setSelectedSourceParticipants([]);
    setSelectedTargetParticipants([]);
    notify(
      "success",
      data.createdCount > 0
        ? `${data.createdCount} regra(s) adicionada(s)!`
        : data.message || "Regra já cadastrada."
    );
    await Promise.all([
      loadEventDetails(details.event.id),
      loadEvents(details.event.id),
    ]);
  }

  async function handlePresetBlockSameFamily() {
    if (!details) return;
    const res = await fetch("/api/admin/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventId: details.event.id,
        preset: "BLOCK_ALL_SAME_FAMILY",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify("error", data.error || "Erro ao aplicar bloqueio entre famílias.");
      return;
    }
    notify(
      "success",
      data.createdCount > 0
        ? "Regra aplicada: ninguém tira integrantes da própria família!"
        : "Todas as famílias já estavam com bloqueio interno ativo."
    );
    await Promise.all([
      loadEventDetails(details.event.id),
      loadEvents(details.event.id),
    ]);
  }

  async function handleDeleteRule(ruleId: string) {
    if (!details) return;
    const res = await fetch(`/api/admin/rules/${ruleId}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      notify("error", data.error || "Erro ao excluir regra.");
      return;
    }
    notify("success", "Regra removida.");
    await Promise.all([
      loadEventDetails(details.event.id),
      loadEvents(details.event.id),
    ]);
  }

  function toggleSelection(
    id: string,
    list: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>
  ) {
    setter(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  }

  async function copyLink(url: string, type: "gift" | "draw") {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    if (type === "gift") {
      setCopiedGift(true);
      setTimeout(() => setCopiedGift(false), 2000);
    } else {
      setCopiedDraw(true);
      setTimeout(() => setCopiedDraw(false), 2000);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="w-9 h-9 rounded-xl bg-rose-600 text-white flex items-center justify-center shadow-xs"
            >
              <Gift className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="font-bold text-slate-900 leading-none">
                Painel Admin — Amigo Secreto
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Controle das 2 Rodadas (Presentes + Sorteio), Famílias e Regras
              </p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sair
          </button>
        </div>
      </header>

      {/* Toast Feedback */}
      {feedback && (
        <div className="fixed bottom-5 right-5 z-50 max-w-sm">
          <div
            className={`rounded-xl px-4 py-3 shadow-lg border text-sm font-medium flex items-center gap-2.5 ${
              feedback.type === "success"
                ? "bg-emerald-600 text-white border-emerald-700"
                : "bg-rose-600 text-white border-rose-700"
            }`}
          >
            {feedback.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <ShieldAlert className="w-4 h-4 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
        </div>
      )}

      <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        {/* Coluna Lateral: Lista e Criação de Sorteios */}
        <aside className="lg:col-span-3 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
            <h2 className="text-sm font-bold text-slate-900 mb-3">
              Novo Sorteio / Sala
            </h2>
            <input
              type="text"
              value={newEventName}
              onChange={(e) => setNewEventName(e.target.value)}
              placeholder="Nome (ex: Natal da Família 2026)"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm mb-2.5 focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={creatingEvent}
                onClick={() => handleCreateEvent(false)}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Criar em Branco (2 Famílias)
              </button>
              <button
                type="button"
                disabled={creatingEvent}
                onClick={() => handleCreateEvent(true)}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Criar Exemplo (Pai, Mãe e Filho)
              </button>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-slate-900">
                Meus Sorteios ({events.length})
              </h2>
              <button
                onClick={() => loadEvents(selectedEventId)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
                title="Atualizar"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {loadingList ? (
              <p className="text-xs text-slate-400 py-4 text-center">
                Carregando...
              </p>
            ) : events.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                Nenhum sorteio criado ainda. Use os botões acima para começar!
              </p>
            ) : (
              <div className="space-y-2">
                {events.map((ev) => {
                  const active = ev.id === selectedEventId;
                  return (
                    <div
                      key={ev.id}
                      onClick={() => setSelectedEventId(ev.id)}
                      className={`rounded-xl border p-3 transition cursor-pointer ${
                        active
                          ? "border-rose-500 bg-rose-50/60"
                          : "border-slate-200 hover:border-slate-300 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-sm text-slate-900 leading-snug">
                          {ev.name}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteEvent(ev.id);
                          }}
                          className="text-slate-400 hover:text-rose-600 p-0.5 cursor-pointer"
                          title="Excluir sorteio"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-slate-500">
                        <span
                          className={`px-2 py-0.5 rounded-md font-semibold ${
                            ev.currentRound === "round1_gifts"
                              ? "bg-blue-100 text-blue-700"
                              : ev.currentRound === "completed"
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-rose-100 text-rose-700"
                          }`}
                        >
                          {ev.currentRound === "round1_gifts"
                            ? "1ª Rodada (Presentes)"
                            : ev.currentRound === "completed"
                              ? "Concluído"
                              : "2ª Rodada (Sorteio)"}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-slate-100">
                          {ev.drawnCount}/{ev.participantCount} sortearam
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* Área Principal do Sorteio Selecionado */}
        <section className="lg:col-span-9 space-y-6">
          {loadingDetails ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 flex items-center justify-center gap-2 text-slate-500 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Carregando dados do sorteio...
            </div>
          ) : !details ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
              <Gift className="w-10 h-10 text-rose-500 mx-auto mb-3" />
              <h3 className="text-lg font-bold text-slate-900">
                Crie ou selecione um Sorteio ao lado
              </h3>
              <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
                Cadastre as famílias, libere a 1ª Rodada para os links dos
                presentes e depois abra a 2ª Rodada para o sorteio!
              </p>
            </div>
          ) : (
            <>
              {/* Card 1: Controle das 2 Rodadas + Links Públicos */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">
                      {details.event.name}
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      Presentes preenchidos:{" "}
                      <strong>
                        {withGiftsCount}/{details.viability.totalParticipants}
                      </strong>{" "}
                      • Sorteios realizados:{" "}
                      <strong>
                        {details.viability.drawnCount}/
                        {details.viability.totalParticipants}
                      </strong>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => loadEventDetails(details.event.id)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Atualizar Status
                    </button>

                    {details.viability.drawnCount > 0 && (
                      <button
                        type="button"
                        onClick={() => handleEventAction("reset_draws")}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 cursor-pointer"
                      >
                        Reiniciar Sorteios (2ª Rodada)
                      </button>
                    )}
                  </div>
                </div>

                {/* Grid das 2 Rodadas */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Bloco Rodada 1: Presentes */}
                  <div
                    className={`rounded-2xl border-2 p-4 space-y-3 transition ${
                      details.event.currentRound === "round1_gifts"
                        ? "border-blue-600 bg-blue-50/40"
                        : "border-slate-200 bg-slate-50/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-[11px] font-extrabold uppercase tracking-wider text-blue-700">
                          1ª Rodada (Opcional)
                        </span>
                        <h3 className="font-bold text-slate-900 text-sm">
                          Colocar Links dos Presentes
                        </h3>
                      </div>

                      {details.event.currentRound === "round1_gifts" ? (
                        <span className="px-2.5 py-1 rounded-full bg-blue-600 text-white text-[11px] font-bold">
                          Aberta Agora
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSetRound("round1_gifts")}
                          className="px-3 py-1 rounded-xl border border-blue-300 bg-white text-blue-700 hover:bg-blue-50 text-xs font-semibold cursor-pointer"
                        >
                          Reabrir 1ª Rodada
                        </button>
                      )}
                    </div>

                    <div className="rounded-xl bg-slate-900 text-white p-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <Link2 className="w-3.5 h-3.5 text-blue-400" />
                        Rota dos Presentes:
                      </div>
                      <p className="font-mono text-xs truncate text-blue-200">
                        {giftUrl}
                      </p>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => copyLink(giftUrl, "gift")}
                          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                        >
                          {copiedGift ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              Copiado!
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              Copiar Link
                            </>
                          )}
                        </button>
                        <Link
                          href={`/presentes/${details.event.giftToken}`}
                          target="_blank"
                          className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-semibold text-white"
                        >
                          Abrir
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Link>
                        <button
                          type="button"
                          onClick={() =>
                            handleEventAction("regenerate_gift_link")
                          }
                          title="Trocar código do link de presentes"
                          className="rounded-lg bg-white/10 hover:bg-white/20 p-1.5 text-slate-300 hover:text-white cursor-pointer ml-auto"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Teto opcional de orçamento */}
                    <form
                      onSubmit={handleSaveBudget}
                      className="flex items-center gap-2 pt-1"
                    >
                      <input
                        type="text"
                        inputMode="decimal"
                        value={budgetInput}
                        onChange={(e) => setBudgetInput(e.target.value)}
                        placeholder="Valor sugerido R$ (ex: 150)"
                        className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
                      />
                      <button
                        type="submit"
                        className="rounded-xl bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 text-xs font-semibold cursor-pointer"
                      >
                        Salvar Valor
                      </button>
                    </form>
                  </div>

                  {/* Bloco Rodada 2: Sorteio */}
                  <div
                    className={`rounded-2xl border-2 p-4 space-y-3 transition ${
                      details.event.currentRound === "round2_draw" ||
                      details.event.currentRound === "completed"
                        ? "border-rose-600 bg-rose-50/40"
                        : "border-slate-200 bg-slate-50/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-[11px] font-extrabold uppercase tracking-wider text-rose-700">
                          2ª Rodada (Final)
                        </span>
                        <h3 className="font-bold text-slate-900 text-sm">
                          Sorteio + Revelar Presentes
                        </h3>
                      </div>

                      {details.event.currentRound === "round2_draw" ||
                      details.event.currentRound === "completed" ? (
                        <span className="px-2.5 py-1 rounded-full bg-rose-600 text-white text-[11px] font-bold">
                          {details.event.currentRound === "completed"
                            ? "Todos Sortearam"
                            : "Aberta Agora"}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSetRound("round2_draw")}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-xs cursor-pointer"
                        >
                          Liberar 2ª Rodada
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="rounded-xl bg-slate-900 text-white p-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <Link2 className="w-3.5 h-3.5 text-rose-400" />
                        Rota do Sorteio:
                      </div>
                      <p className="font-mono text-xs truncate text-rose-200">
                        {shareUrl}
                      </p>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => copyLink(shareUrl, "draw")}
                          className="inline-flex items-center gap-1 rounded-lg bg-rose-600 hover:bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                        >
                          {copiedDraw ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              Copiado!
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              Copiar Link
                            </>
                          )}
                        </button>
                        <Link
                          href={`/s/${details.event.shareToken}`}
                          target="_blank"
                          className="inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-semibold text-white"
                        >
                          Abrir
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleEventAction("regenerate_link")}
                          title="Trocar código do link de sorteio"
                          className="rounded-lg bg-white/10 hover:bg-white/20 p-1.5 text-slate-300 hover:text-white cursor-pointer ml-auto"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-500">
                      {details.event.currentRound === "round1_gifts"
                        ? "Enquanto estiver na 1ª Rodada, o link do sorteio aguarda sua liberação."
                        : "Sorteio liberado! Ao sortear, cada pessoa vê quem tirou e os links dos presentes."}
                    </p>
                  </div>
                </div>

                {/* Validador Matemático em Tempo Real */}
                <div
                  className={`rounded-xl border px-4 py-3 flex items-start gap-3 text-sm ${
                    details.viability.isValid
                      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                      : "bg-amber-50 border-amber-300 text-amber-900"
                  }`}
                >
                  {details.viability.isValid ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="font-semibold">
                      {details.viability.isValid
                        ? "Sorteio viável e garantido sem beco sem saída!"
                        : "Atenção: ajuste necessário antes de sortear"}
                    </p>
                    <p className="text-xs opacity-90 mt-0.5">
                      {details.viability.isValid
                        ? `Existe emparelhamento válido para todos os ${details.viability.totalParticipants} integrantes respeitando as ${details.rules.length} regra(s) ativas.`
                        : details.viability.reason}
                    </p>
                  </div>
                </div>
              </div>

              {/* Card 2: CRUD de Famílias e Integrantes */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                      <Users className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900">
                        1. Famílias e Integrantes
                      </h3>
                      <p className="text-xs text-slate-500">
                        Crie, renomeie ou remova famílias e acompanhe quem já
                        cadastrou presentes ou sorteou
                      </p>
                    </div>
                  </div>

                  <form
                    onSubmit={handleCreateFamily}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <input
                      type="text"
                      value={newFamilyName}
                      onChange={(e) => setNewFamilyName(e.target.value)}
                      placeholder="Nova família (ex: Família 3)"
                      className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <select
                      value={newFamilyColor}
                      onChange={(e) => setNewFamilyColor(e.target.value)}
                      className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs bg-white"
                    >
                      {FAMILY_COLORS.map((c) => (
                        <option key={c.value} value={c.value}>
                          Cor: {c.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Adicionar Família
                    </button>
                  </form>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {details.families.map((fam) => {
                    const members = details.participants.filter(
                      (p) => p.familyId === fam.id
                    );
                    const draft = memberDrafts[fam.id] || {
                      name: "",
                      role: "",
                      giftHint: "",
                    };

                    return (
                      <div
                        key={fam.id}
                        className="rounded-2xl border border-slate-200 bg-slate-50/50 p-4 flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-3">
                            {editingFamilyId === fam.id ? (
                              <div className="flex items-center gap-1.5 flex-1">
                                <input
                                  type="text"
                                  value={editFamilyName}
                                  onChange={(e) =>
                                    setEditFamilyName(e.target.value)
                                  }
                                  className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs bg-white"
                                />
                                <select
                                  value={editFamilyColor}
                                  onChange={(e) =>
                                    setEditFamilyColor(e.target.value)
                                  }
                                  className="rounded-lg border border-slate-300 px-2 py-1 text-xs bg-white"
                                >
                                  {FAMILY_COLORS.map((c) => (
                                    <option key={c.value} value={c.value}>
                                      {c.label}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => handleSaveFamily(fam.id)}
                                  className="rounded-lg bg-slate-900 text-white px-2.5 py-1 text-xs font-medium cursor-pointer"
                                >
                                  Salvar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingFamilyId(null)}
                                  className="text-xs text-slate-500 px-1 cursor-pointer"
                                >
                                  Cancelar
                                </button>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-2">
                                  <span
                                    className="w-3.5 h-3.5 rounded-full shrink-0"
                                    style={{ backgroundColor: fam.color }}
                                  />
                                  <h4 className="font-bold text-slate-900">
                                    {fam.name}
                                  </h4>
                                  <span className="text-xs text-slate-500">
                                    ({members.length})
                                  </span>
                                </div>

                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingFamilyId(fam.id);
                                      setEditFamilyName(fam.name);
                                      setEditFamilyColor(fam.color);
                                    }}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white cursor-pointer"
                                    title="Editar família"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleDeleteFamily(fam.id, fam.name)
                                    }
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-white cursor-pointer"
                                    title="Excluir família"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </>
                            )}
                          </div>

                          <div className="space-y-2 mb-4">
                            {members.length === 0 ? (
                              <p className="text-xs text-slate-400 italic py-3 text-center bg-white rounded-xl border border-dashed border-slate-200">
                                Nenhum integrante cadastrado nesta família.
                              </p>
                            ) : (
                              members.map((m) => (
                                <div
                                  key={m.id}
                                  className="bg-white rounded-xl border border-slate-200 px-3 py-2.5 text-xs"
                                >
                                  {editingMemberId === m.id ? (
                                    <div className="space-y-2">
                                      <div className="grid grid-cols-2 gap-2">
                                        <input
                                          type="text"
                                          value={editMemberForm.name}
                                          onChange={(e) =>
                                            setEditMemberForm((f) => ({
                                              ...f,
                                              name: e.target.value,
                                            }))
                                          }
                                          placeholder="Nome"
                                          className="rounded-lg border border-slate-300 px-2 py-1"
                                        />
                                        <input
                                          type="text"
                                          value={editMemberForm.role}
                                          onChange={(e) =>
                                            setEditMemberForm((f) => ({
                                              ...f,
                                              role: e.target.value,
                                            }))
                                          }
                                          placeholder="Papel (ex: Pai, Mãe)"
                                          className="rounded-lg border border-slate-300 px-2 py-1"
                                        />
                                      </div>
                                      <input
                                        type="text"
                                        value={editMemberForm.giftHint}
                                        onChange={(e) =>
                                          setEditMemberForm((f) => ({
                                            ...f,
                                            giftHint: e.target.value,
                                          }))
                                        }
                                        placeholder="Observação de presente"
                                        className="w-full rounded-lg border border-slate-300 px-2 py-1"
                                      />
                                      <div className="flex justify-end gap-2">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setEditingMemberId(null)
                                          }
                                          className="text-slate-500 px-2 py-1 cursor-pointer"
                                        >
                                          Cancelar
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleSaveParticipant(m.id)
                                          }
                                          className="rounded-lg bg-slate-900 text-white px-2.5 py-1 font-medium cursor-pointer"
                                        >
                                          Salvar
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="min-w-0">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="font-semibold text-slate-900 text-sm">
                                            {m.name}
                                          </span>
                                          {m.role && (
                                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px]">
                                              {m.role}
                                            </span>
                                          )}
                                          {m.giftItemsCount > 0 && (
                                            <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-semibold">
                                              {m.giftItemsCount} link(s) •{" "}
                                              {formatBRL(m.giftsTotal)}
                                            </span>
                                          )}
                                          <span
                                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                              m.hasDrawn
                                                ? "bg-emerald-100 text-emerald-700"
                                                : "bg-slate-100 text-slate-500"
                                            }`}
                                          >
                                            {m.hasDrawn
                                              ? "Já sorteou"
                                              : "Não sorteou"}
                                          </span>
                                          {m.reRollCount > 0 && (
                                            <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 text-[10px] font-medium">
                                              {m.reRollCount} re-roll(s)
                                            </span>
                                          )}
                                        </div>
                                        {m.giftHint && (
                                          <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                            Obs: {m.giftHint}
                                          </p>
                                        )}
                                      </div>

                                      <div className="flex items-center gap-1 shrink-0">
                                        {m.hasPin && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleResetParticipantPin(m)
                                            }
                                            title="Resetar PIN de 4 dígitos (caso tenha esquecido)"
                                            className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50 cursor-pointer"
                                          >
                                            <KeyRound className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setEditingMemberId(m.id);
                                            setEditMemberForm({
                                              name: m.name,
                                              role: m.role,
                                              giftHint: m.giftHint,
                                            });
                                          }}
                                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
                                          title="Editar integrante"
                                        >
                                          <Edit3 className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleDeleteParticipant(m)
                                          }
                                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                                          title="Remover integrante"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <form
                          onSubmit={(e) => handleAddParticipant(fam.id, e)}
                          className="pt-3 border-t border-slate-200/80 space-y-2"
                        >
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="text"
                              value={draft.name}
                              onChange={(e) =>
                                setMemberDrafts((prev) => ({
                                  ...prev,
                                  [fam.id]: {
                                    ...draft,
                                    name: e.target.value,
                                  },
                                }))
                              }
                              placeholder="Nome (ex: Pai, Mãe, João)"
                              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
                            />
                            <input
                              type="text"
                              value={draft.giftHint}
                              onChange={(e) =>
                                setMemberDrafts((prev) => ({
                                  ...prev,
                                  [fam.id]: {
                                    ...draft,
                                    giftHint: e.target.value,
                                  },
                                }))
                              }
                              placeholder="Observação inicial (opcional)"
                              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-slate-900"
                            />
                          </div>
                          <button
                            type="submit"
                            className="w-full inline-flex items-center justify-center gap-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white py-1.5 text-xs font-semibold cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Adicionar em {fam.name}
                          </button>
                        </form>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Card 3: Construtor de Regras de Negócio (Re-roll) */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
                      <Ban className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900">
                        2. Regras de Restrição e Re-roll Automático
                      </h3>
                      <p className="text-xs text-slate-500">
                        Se alguém cair em uma restrição ao sortear, o servidor
                        faz re-roll automaticamente dentro da transação
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handlePresetBlockSameFamily}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-rose-50 border border-rose-200 px-3.5 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 cursor-pointer"
                  >
                    <Ban className="w-3.5 h-3.5" />
                    Atalho: Proibir tirar da própria família
                  </button>
                </div>

                <form
                  onSubmit={handleCreateRule}
                  className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-4"
                >
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                      Tipo de Regra
                    </label>
                    <select
                      value={ruleScope}
                      onChange={(e) =>
                        setRuleScope(e.target.value as RuleItem["scope"])
                      }
                      className="w-full sm:w-auto rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium"
                    >
                      <option value="PARTICIPANT_TO_PARTICIPANT">
                        Pessoa(s) específica(s) NÃO PODE(M) tirar Pessoa(s)
                        específica(s) (ex: Mãe e Filho → Pai)
                      </option>
                      <option value="FAMILY_TO_FAMILY">
                        Família inteira NÃO PODE tirar Família inteira
                      </option>
                      <option value="PARTICIPANT_TO_FAMILY">
                        Pessoa(s) específica(s) NÃO PODE(M) tirar ninguém de uma
                        Família
                      </option>
                      <option value="FAMILY_TO_PARTICIPANT">
                        Família inteira NÃO PODE tirar Pessoa(s) específica(s)
                      </option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white rounded-xl border border-slate-200 p-3">
                      <p className="text-xs font-bold text-slate-800 mb-2">
                        Quem está sorteando (Origem):
                      </p>
                      {ruleScope === "PARTICIPANT_TO_PARTICIPANT" ||
                      ruleScope === "PARTICIPANT_TO_FAMILY" ? (
                        <div className="max-h-44 overflow-y-auto space-y-1.5">
                          {details.families.map((fam) => (
                            <div key={fam.id}>
                              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-1">
                                {fam.name}
                              </p>
                              {details.participants
                                .filter((p) => p.familyId === fam.id)
                                .map((p) => (
                                  <label
                                    key={p.id}
                                    className="flex items-center gap-2 py-1 px-1.5 rounded hover:bg-slate-50 text-xs cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selectedSourceParticipants.includes(
                                        p.id
                                      )}
                                      onChange={() =>
                                        toggleSelection(
                                          p.id,
                                          selectedSourceParticipants,
                                          setSelectedSourceParticipants
                                        )
                                      }
                                      className="rounded text-rose-600"
                                    />
                                    <span>{p.name}</span>
                                  </label>
                                ))}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <select
                          value={selectedSourceFamily}
                          onChange={(e) =>
                            setSelectedSourceFamily(e.target.value)
                          }
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                        >
                          {details.families.map((fam) => (
                            <option key={fam.id} value={fam.id}>
                              {fam.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    <div className="bg-white rounded-xl border border-slate-200 p-3">
                      <p className="text-xs font-bold text-rose-700 mb-2">
                        NÃO PODE TIRAR (Alvo bloqueado → Re-roll):
                      </p>
                      {ruleScope === "PARTICIPANT_TO_PARTICIPANT" ||
                      ruleScope === "FAMILY_TO_PARTICIPANT" ? (
                        <div className="max-h-44 overflow-y-auto space-y-1.5">
                          {details.families.map((fam) => (
                            <div key={fam.id}>
                              <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mt-1">
                                {fam.name}
                              </p>
                              {details.participants
                                .filter((p) => p.familyId === fam.id)
                                .map((p) => (
                                  <label
                                    key={p.id}
                                    className="flex items-center gap-2 py-1 px-1.5 rounded hover:bg-slate-50 text-xs cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={selectedTargetParticipants.includes(
                                        p.id
                                      )}
                                      onChange={() =>
                                        toggleSelection(
                                          p.id,
                                          selectedTargetParticipants,
                                          setSelectedTargetParticipants
                                        )
                                      }
                                      className="rounded text-rose-600"
                                    />
                                    <span>{p.name}</span>
                                  </label>
                                ))}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <select
                          value={selectedTargetFamily}
                          onChange={(e) =>
                            setSelectedTargetFamily(e.target.value)
                          }
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                        >
                          {details.families.map((fam) => (
                            <option key={fam.id} value={fam.id}>
                              {fam.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Salvar Regra de Restrição
                    </button>
                  </div>
                </form>

                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Regras Ativas ({details.rules.length})
                  </h4>
                  {details.rules.length === 0 ? (
                    <p className="text-xs text-slate-400 italic py-3">
                      Nenhuma restrição extra cadastrada (apenas a regra padrão
                      de ninguém tirar a si mesmo).
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {details.rules.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center justify-between gap-2 rounded-xl border border-rose-100 bg-rose-50/50 px-3.5 py-2.5 text-xs text-slate-800"
                        >
                          <span className="font-medium">{r.description}</span>
                          <button
                            type="button"
                            onClick={() => handleDeleteRule(r.id)}
                            className="text-slate-400 hover:text-rose-600 p-1 shrink-0 cursor-pointer"
                            title="Remover regra"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
