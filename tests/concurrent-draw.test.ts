import dotenv from "dotenv";
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

dotenv.config({ path: ".env.local" });

import { connectDB } from "@/lib/mongodb";
import {
  executeParticipantDraw,
  revealParticipantDraw,
} from "@/lib/draw-transaction";
import { EventModel } from "@/models/Event";
import { FamilyModel } from "@/models/Family";
import { ParticipantModel } from "@/models/Participant";
import { RestrictionRuleModel } from "@/models/RestrictionRule";

describe("Concorrência Transacional no MongoDB Atlas (Sorteios Simultâneos)", () => {
  let testEventId: mongoose.Types.ObjectId | null = null;
  const shareToken = `test-tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    if (testEventId) {
      await Promise.all([
        RestrictionRuleModel.deleteMany({ eventId: testEventId }),
        ParticipantModel.deleteMany({ eventId: testEventId }),
        FamilyModel.deleteMany({ eventId: testEventId }),
        EventModel.deleteOne({ _id: testEventId }),
      ]);
    }
    await mongoose.disconnect();
  });

  it("serializa 6 sorteios disparados exatamente ao mesmo tempo respeitando regras e sem duplicatas", async () => {
    const event = await EventModel.create({
      name: "Teste Automatizado Transacional",
      shareToken,
      currentRound: "round2_draw",
      status: "active",
    });
    testEventId = event._id;

    const [fam1, fam2] = await FamilyModel.create([
      { eventId: event._id, name: "Família 1", color: "#2563eb" },
      { eventId: event._id, name: "Família 2", color: "#e11d48" },
    ]);

    const createdParticipants = await ParticipantModel.create([
      { eventId: event._id, familyId: fam1._id, name: "Tio João" },
      { eventId: event._id, familyId: fam1._id, name: "Tia Maria" },
      { eventId: event._id, familyId: fam1._id, name: "Prima Bia" },
      { eventId: event._id, familyId: fam2._id, name: "Pai" },
      { eventId: event._id, familyId: fam2._id, name: "Mãe" },
      { eventId: event._id, familyId: fam2._id, name: "Filho" },
    ]);

    const pai = createdParticipants.find((p) => p.name === "Pai")!;
    const mae = createdParticipants.find((p) => p.name === "Mãe")!;
    const filho = createdParticipants.find((p) => p.name === "Filho")!;

    await RestrictionRuleModel.create([
      {
        eventId: event._id,
        scope: "PARTICIPANT_TO_PARTICIPANT",
        sourceParticipantId: mae._id,
        targetParticipantId: pai._id,
        description: "Mãe não pode tirar Pai",
      },
      {
        eventId: event._id,
        scope: "PARTICIPANT_TO_PARTICIPANT",
        sourceParticipantId: filho._id,
        targetParticipantId: pai._id,
        description: "Filho não pode tirar Pai",
      },
    ]);

    // Dispara TODOS os 6 participantes sorteando simultaneamente!
    const concurrentResults = await Promise.all(
      createdParticipants.map((p, idx) =>
        executeParticipantDraw({
          shareToken,
          participantId: p._id.toString(),
          pin: `100${idx}`,
        })
      )
    );

    expect(concurrentResults).toHaveLength(6);

    // Garante que nenhuma pessoa foi tirada duas vezes
    const chosenIds = concurrentResults.map((r) => r.chosen.id);
    expect(new Set(chosenIds).size).toBe(6);

    // Garante que Mãe e Filho não tiraram o Pai
    const maeResult = concurrentResults.find(
      (r) => r.drawerId === mae._id.toString()
    )!;
    const filhoResult = concurrentResults.find(
      (r) => r.drawerId === filho._id.toString()
    )!;
    expect(maeResult.chosen.id).not.toBe(pai._id.toString());
    expect(filhoResult.chosen.id).not.toBe(pai._id.toString());

    // Garante que o evento finalizou com status "completed" e drawSequence >= 6
    const updatedEvent = await EventModel.findById(event._id).lean();
    expect(updatedEvent?.status).toBe("completed");
    expect(updatedEvent?.drawSequence).toBe(6);

    // Verifica revelação com PIN correto vs PIN incorreto
    const revealedOk = await revealParticipantDraw({
      shareToken,
      participantId: createdParticipants[0]._id.toString(),
      pin: "1000",
    });
    expect(revealedOk.chosen.id).toBe(concurrentResults[0].chosen.id);

    await expect(
      revealParticipantDraw({
        shareToken,
        participantId: createdParticipants[0]._id.toString(),
        pin: "9999",
      })
    ).rejects.toThrow(/PIN incorreto/i);
  });
});
