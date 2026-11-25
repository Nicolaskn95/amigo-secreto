import { describe, expect, it } from "vitest";
import {
  pickWithReRoll,
  validateEventViability,
  type EngineParticipant,
  type EngineRule,
} from "@/lib/draw-engine";

function createBaseScenario(): {
  participants: EngineParticipant[];
  rules: EngineRule[];
} {
  const participants: EngineParticipant[] = [
    {
      id: "f1_carlos",
      familyId: "fam1",
      name: "Carlos",
      hasDrawn: false,
      drawnParticipantId: null,
      drawnByParticipantId: null,
    },
    {
      id: "f1_ana",
      familyId: "fam1",
      name: "Ana",
      hasDrawn: false,
      drawnParticipantId: null,
      drawnByParticipantId: null,
    },
    {
      id: "f2_pai",
      familyId: "fam2",
      name: "Pai",
      hasDrawn: false,
      drawnParticipantId: null,
      drawnByParticipantId: null,
    },
    {
      id: "f2_mae",
      familyId: "fam2",
      name: "Mãe",
      hasDrawn: false,
      drawnParticipantId: null,
      drawnByParticipantId: null,
    },
    {
      id: "f2_filho",
      familyId: "fam2",
      name: "Filho",
      hasDrawn: false,
      drawnParticipantId: null,
      drawnByParticipantId: null,
    },
  ];

  // Regra de negócio do enunciado: na Família 2, Mãe e Filho não podem tirar o Pai
  const rules: EngineRule[] = [
    {
      scope: "PARTICIPANT_TO_PARTICIPANT",
      sourceParticipantId: "f2_mae",
      targetParticipantId: "f2_pai",
    },
    {
      scope: "PARTICIPANT_TO_PARTICIPANT",
      sourceParticipantId: "f2_filho",
      targetParticipantId: "f2_pai",
    },
  ];

  return { participants, rules };
}

describe("Motor de Sorteio, Re-roll e Anti-Deadlock", () => {
  it("realiza re-roll automático quando Mãe cai inicialmente no Pai", () => {
    const { participants, rules } = createBaseScenario();

    // Com rng fixo em 0.999, Fisher-Yates mantém a ordem original onde f2_pai aparece antes de f2_filho
    // Vamos forçar ordem controlada colocando f2_pai como primeiro testado
    const ordered: EngineParticipant[] = [
      participants.find((p) => p.id === "f2_pai")!,
      participants.find((p) => p.id === "f1_carlos")!,
      participants.find((p) => p.id === "f1_ana")!,
      participants.find((p) => p.id === "f2_mae")!,
      participants.find((p) => p.id === "f2_filho")!,
    ];

    const result = pickWithReRoll("f2_mae", ordered, rules, () => 0.9999);
    expect(result.chosen.id).not.toBe("f2_pai");
    expect(result.chosen.id).not.toBe("f2_mae");
    expect(result.reRollCount).toBeGreaterThanOrEqual(1);
  });

  it("evita beco sem saída (anti-deadlock) mesmo quando Família 1 sorteia antes da Família 2", () => {
    const { participants, rules } = createBaseScenario();

    // Simula 300 jogos completos em ordens totalmente aleatórias
    for (let run = 0; run < 300; run++) {
      const state = participants.map((p) => ({ ...p }));
      const drawOrder = [...state].sort(() => Math.random() - 0.5);

      for (const person of drawOrder) {
        const { chosen } = pickWithReRoll(person.id, state, rules);

        const drawerState = state.find((p) => p.id === person.id)!;
        const receiverState = state.find((p) => p.id === chosen.id)!;

        expect(receiverState.drawnByParticipantId).toBeNull();
        drawerState.hasDrawn = true;
        drawerState.drawnParticipantId = chosen.id;
        receiverState.drawnByParticipantId = person.id;
      }

      // Verifica invariantes ao final de cada jogo completo
      const mae = state.find((p) => p.id === "f2_mae")!;
      const filho = state.find((p) => p.id === "f2_filho")!;

      expect(mae.drawnParticipantId).not.toBe("f2_pai");
      expect(filho.drawnParticipantId).not.toBe("f2_pai");

      const uniqueChosen = new Set(state.map((p) => p.drawnParticipantId));
      expect(uniqueChosen.size).toBe(state.length);
      for (const p of state) {
        expect(p.drawnParticipantId).not.toBe(p.id);
      }
    }
  });

  it("detecta corretamente configurações matematicamente impossíveis no validador", () => {
    const { participants } = createBaseScenario();

    // Se Família 1 tem 2 pessoas e Família 2 tem 3 pessoas, e ninguém pode tirar da própria família:
    // As 3 pessoas da Família 2 precisariam tirar 3 pessoas diferentes da Família 1 (que só tem 2!) -> impossível!
    const impossibleRules: EngineRule[] = [
      {
        scope: "FAMILY_TO_FAMILY",
        sourceFamilyId: "fam1",
        targetFamilyId: "fam1",
      },
      {
        scope: "FAMILY_TO_FAMILY",
        sourceFamilyId: "fam2",
        targetFamilyId: "fam2",
      },
    ];

    const report = validateEventViability(participants, impossibleRules);
    expect(report.isValid).toBe(false);
    expect(report.reason).toBeTruthy();
  });
});
