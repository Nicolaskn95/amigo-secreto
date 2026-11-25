import { AppError } from "./auth";
import type { RuleScope } from "@/models/RestrictionRule";

export interface EngineParticipant {
  id: string;
  familyId: string;
  name: string;
  hasDrawn: boolean;
  drawnParticipantId: string | null;
  drawnByParticipantId: string | null;
}

export interface EngineRule {
  scope: RuleScope;
  sourceParticipantId?: string | null;
  sourceFamilyId?: string | null;
  targetParticipantId?: string | null;
  targetFamilyId?: string | null;
}

export interface ViabilityReport {
  isValid: boolean;
  reason?: string;
  totalParticipants: number;
  drawnCount: number;
  remainingCount: number;
}

export interface DrawPickResult {
  chosen: EngineParticipant;
  reRollCount: number;
}

/**
 * Verifica se `drawer` pode tirar `candidate` de acordo com:
 * 1) Não tirar a si mesmo
 * 2) Todas as regras de restrição configuradas (pessoa->pessoa, pessoa->família, família->família, família->pessoa)
 */
export function isPairAllowed(
  drawer: Pick<EngineParticipant, "id" | "familyId">,
  candidate: Pick<EngineParticipant, "id" | "familyId">,
  rules: EngineRule[]
): boolean {
  if (drawer.id === candidate.id) {
    return false;
  }

  for (const rule of rules) {
    switch (rule.scope) {
      case "PARTICIPANT_TO_PARTICIPANT":
        if (
          rule.sourceParticipantId === drawer.id &&
          rule.targetParticipantId === candidate.id
        ) {
          return false;
        }
        break;

      case "PARTICIPANT_TO_FAMILY":
        if (
          rule.sourceParticipantId === drawer.id &&
          rule.targetFamilyId === candidate.familyId
        ) {
          return false;
        }
        break;

      case "FAMILY_TO_FAMILY":
        if (
          rule.sourceFamilyId === drawer.familyId &&
          rule.targetFamilyId === candidate.familyId
        ) {
          return false;
        }
        break;

      case "FAMILY_TO_PARTICIPANT":
        if (
          rule.sourceFamilyId === drawer.familyId &&
          rule.targetParticipantId === candidate.id
        ) {
          return false;
        }
        break;
    }
  }

  return true;
}

/**
 * Algoritmo de Kuhn (Emparelhamento Bipartido Perfeito) em O(V * E).
 * Garante que todos os participantes restantes conseguirão sortear alguém válido sem travar no fim.
 */
export function hasValidCompleteAssignment(
  drawers: Pick<EngineParticipant, "id" | "familyId">[],
  receivers: Pick<EngineParticipant, "id" | "familyId">[],
  rules: EngineRule[]
): boolean {
  const n = drawers.length;
  if (n !== receivers.length) return false;
  if (n === 0) return true;

  const adj: number[][] = Array.from({ length: n }, () => []);

  for (let u = 0; u < n; u++) {
    for (let v = 0; v < n; v++) {
      if (isPairAllowed(drawers[u], receivers[v], rules)) {
        adj[u].push(v);
      }
    }
    if (adj[u].length === 0) {
      return false;
    }
  }

  // Ordenar pelos mais restritos primeiro acelera ainda mais a convergência
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => adj[a].length - adj[b].length
  );

  const matchReceiverToDrawer = new Array<number>(n).fill(-1);

  function dfs(u: number, visited: boolean[]): boolean {
    for (const v of adj[u]) {
      if (visited[v]) continue;
      visited[v] = true;

      if (
        matchReceiverToDrawer[v] === -1 ||
        dfs(matchReceiverToDrawer[v], visited)
      ) {
        matchReceiverToDrawer[v] = u;
        return true;
      }
    }
    return false;
  }

  for (const u of order) {
    const visited = new Array<boolean>(n).fill(false);
    if (!dfs(u, visited)) {
      return false;
    }
  }

  return true;
}

/**
 * Diagnóstico completo de viabilidade do evento para exibição em tempo real no painel Admin.
 */
export function validateEventViability(
  participants: EngineParticipant[],
  rules: EngineRule[]
): ViabilityReport {
  const totalParticipants = participants.length;
  const remainingDrawers = participants.filter((p) => !p.hasDrawn);
  const remainingReceivers = participants.filter((p) => !p.drawnByParticipantId);
  const drawnCount = totalParticipants - remainingDrawers.length;

  if (totalParticipants < 2) {
    return {
      isValid: false,
      reason: "Cadastre pelo menos 2 participantes para habilitar o sorteio.",
      totalParticipants,
      drawnCount,
      remainingCount: remainingDrawers.length,
    };
  }

  if (remainingDrawers.length !== remainingReceivers.length) {
    return {
      isValid: false,
      reason: "Estado inconsistente entre participantes que sortearam e sorteados.",
      totalParticipants,
      drawnCount,
      remainingCount: remainingDrawers.length,
    };
  }

  if (remainingDrawers.length === 0) {
    return {
      isValid: true,
      totalParticipants,
      drawnCount,
      remainingCount: 0,
    };
  }

  for (const drawer of remainingDrawers) {
    const canPickSomeone = remainingReceivers.some((r) =>
      isPairAllowed(drawer, r, rules)
    );
    if (!canPickSomeone) {
      return {
        isValid: false,
        reason: `"${drawer.name}" não possui nenhuma pessoa permitida para tirar com as regras atuais.`,
        totalParticipants,
        drawnCount,
        remainingCount: remainingDrawers.length,
      };
    }
  }

  for (const receiver of remainingReceivers) {
    const canBePicked = remainingDrawers.some((d) =>
      isPairAllowed(d, receiver, rules)
    );
    if (!canBePicked) {
      return {
        isValid: false,
        reason: `"${receiver.name}" ficou bloqueado(a) de ser tirado(a) por todos os participantes restantes.`,
        totalParticipants,
        drawnCount,
        remainingCount: remainingDrawers.length,
      };
    }
  }

  const solvable = hasValidCompleteAssignment(
    remainingDrawers,
    remainingReceivers,
    rules
  );

  if (!solvable) {
    return {
      isValid: false,
      reason:
        "As regras atuais formam um gargalo matemático (não há combinação onde todos consigam tirar alguém permitido ao mesmo tempo).",
      totalParticipants,
      drawnCount,
      remainingCount: remainingDrawers.length,
    };
  }

  return {
    isValid: true,
    totalParticipants,
    drawnCount,
    remainingCount: remainingDrawers.length,
  };
}

/**
 * Embaralhamento Fisher-Yates imparcial
 */
function shufflePool<T>(items: T[], randomFn: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Sorteia um participante disponível aplicando re-roll automático caso:
 * - Caia em regra bloqueada (ex: Mãe ou Filho tirando o Pai na Família 2); OU
 * - A escolha deixe os participantes restantes em beco sem saída no fim do jogo.
 */
export function pickWithReRoll(
  drawerId: string,
  allParticipants: EngineParticipant[],
  rules: EngineRule[],
  randomFn: () => number = Math.random
): DrawPickResult {
  const drawer = allParticipants.find((p) => p.id === drawerId);
  if (!drawer) {
    throw new AppError("Participante não encontrado neste sorteio.", 404, "NOT_FOUND");
  }

  if (drawer.hasDrawn) {
    throw new AppError(
      "Este participante já realizou o sorteio.",
      409,
      "ALREADY_DRAWN"
    );
  }

  const availablePool = allParticipants.filter(
    (p) => !p.drawnByParticipantId && p.id !== drawer.id
  );

  if (availablePool.length === 0) {
    throw new AppError(
      "Não há mais participantes disponíveis para sortear.",
      422,
      "EMPTY_POOL"
    );
  }

  const otherRemainingDrawers = allParticipants.filter(
    (p) => !p.hasDrawn && p.id !== drawer.id
  );

  const shuffledCandidates = shufflePool(availablePool, randomFn);
  let reRollCount = 0;

  for (const candidate of shuffledCandidates) {
    // 1. Regra direta (ex: Mãe -> Pai bloqueado => re-roll!)
    if (!isPairAllowed(drawer, candidate, rules)) {
      reRollCount++;
      continue;
    }

    // 2. Garantia anti-deadlock para quem vai sortear depois
    const otherRemainingReceivers = allParticipants.filter(
      (p) => !p.drawnByParticipantId && p.id !== candidate.id
    );

    if (
      !hasValidCompleteAssignment(
        otherRemainingDrawers,
        otherRemainingReceivers,
        rules
      )
    ) {
      reRollCount++;
      continue;
    }

    return {
      chosen: candidate,
      reRollCount,
    };
  }

  throw new AppError(
    "Não foi possível encontrar um sorteio válido com as regras configuradas. Peça ao administrador para revisar as restrições.",
    422,
    "NO_VALID_DRAW"
  );
}
