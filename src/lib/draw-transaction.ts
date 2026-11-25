import mongoose from "mongoose";
import { connectDB } from "./mongodb";
import { AppError, hashPin, verifyPin } from "./auth";
import {
  pickWithReRoll,
  type EngineParticipant,
  type EngineRule,
} from "./draw-engine";
import { EventModel } from "@/models/Event";
import { FamilyModel } from "@/models/Family";
import { ParticipantModel, type ParticipantDoc } from "@/models/Participant";
import { RestrictionRuleModel } from "@/models/RestrictionRule";

export interface GiftItemDTO {
  id: string;
  title: string;
  url: string;
  price: number;
  scraped: boolean;
}

export interface RevealedFriend {
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

export interface DrawTransactionResult {
  drawerId: string;
  drawerName: string;
  chosen: RevealedFriend;
  reRollCount: number;
  drawSequence: number;
}

function mapRevealedFriend(
  chosenDoc: ParticipantDoc,
  family?: { name?: string; color?: string } | null
): RevealedFriend {
  const rawItems = Array.isArray(chosenDoc.giftItems) ? chosenDoc.giftItems : [];
  return {
    id: chosenDoc._id.toString(),
    name: chosenDoc.name,
    role: chosenDoc.role || "",
    giftHint: chosenDoc.giftHint || "",
    giftItems: rawItems.map((item, idx) => ({
      id: item._id ? item._id.toString() : `item-${idx}`,
      title: item.title,
      url: item.url || "",
      price: Number(item.price) || 0,
      scraped: Boolean(item.scraped),
    })),
    giftsTotal: Number(chosenDoc.giftsTotal) || 0,
    familyId: chosenDoc.familyId.toString(),
    familyName: family?.name || "Família",
    familyColor: family?.color || "#e11d48",
  };
}

export async function executeParticipantDraw(params: {
  shareToken: string;
  participantId: string;
  pin: string;
}): Promise<DrawTransactionResult> {
  const { shareToken, participantId, pin } = params;

  if (!/^\d{4}$/.test(pin.trim())) {
    throw new AppError("O PIN deve conter exatamente 4 dígitos numéricos.", 400, "INVALID_PIN_FORMAT");
  }

  if (!mongoose.Types.ObjectId.isValid(participantId)) {
    throw new AppError("Identificador de participante inválido.", 400, "INVALID_ID");
  }

  const computedPinHash = hashPin(pin);

  await connectDB();

  const session = await mongoose.startSession();
  try {
    let txResult: DrawTransactionResult | null = null;

    await session.withTransaction(
      async () => {
        // 1. Lock transacional no documento Event para serializar sorteios simultâneos
        const event = await EventModel.findOneAndUpdate(
          { shareToken },
          { $inc: { drawSequence: 1 } },
          { returnDocument: "after", session }
        );

        if (!event) {
          throw new AppError("Link de sorteio inválido ou expirado.", 404, "EVENT_NOT_FOUND");
        }

        if (event.status === "draft") {
          throw new AppError(
            "Este sorteio ainda está pausado pelo administrador.",
            403,
            "EVENT_DRAFT"
          );
        }

        if (event.currentRound === "round1_gifts") {
          throw new AppError(
            "A 2ª Rodada (Sorteio) ainda não foi liberada pelo administrador! No momento apenas a 1ª Rodada (lista de presentes) está aberta.",
            403,
            "ROUND_1_ACTIVE"
          );
        }

        // 2. Carrega famílias, participantes e regras dentro do mesmo snapshot transacional
        const [families, participants, rules] = await Promise.all([
          FamilyModel.find({ eventId: event._id }).session(session).lean(),
          ParticipantModel.find({ eventId: event._id }).session(session).lean(),
          RestrictionRuleModel.find({ eventId: event._id }).session(session).lean(),
        ]);

        const drawerDoc = participants.find(
          (p) => p._id.toString() === participantId
        );
        if (!drawerDoc) {
          throw new AppError(
            "Participante não pertence a este sorteio.",
            404,
            "PARTICIPANT_NOT_FOUND"
          );
        }

        if (drawerDoc.hasDrawn) {
          throw new AppError(
            "Você já realizou seu sorteio! Digite seu PIN para consultar quem tirou e os links dos presentes.",
            409,
            "ALREADY_DRAWN"
          );
        }

        // Compatibilidade de PIN entre Rodada 1 e Rodada 2:
        // Se cadastrou PIN na Rodada 1, exige o mesmo PIN; se pulou a Rodada 1, grava o PIN criado agora.
        let finalPinHash = computedPinHash;
        if (drawerDoc.pinHash) {
          if (!verifyPin(pin, drawerDoc.pinHash)) {
            throw new AppError(
              "PIN incorreto! Informe o mesmo PIN de 4 dígitos que você cadastrou na 1ª Rodada (ou peça ao Admin para resetar).",
              401,
              "WRONG_PIN"
            );
          }
          finalPinHash = drawerDoc.pinHash;
        }

        // 3. Converte para tipos do motor e executa sorteio + re-roll automático + anti-deadlock
        const engineParticipants: EngineParticipant[] = participants.map((p) => ({
          id: p._id.toString(),
          familyId: p.familyId.toString(),
          name: p.name,
          hasDrawn: Boolean(p.hasDrawn),
          drawnParticipantId: p.drawnParticipantId
            ? p.drawnParticipantId.toString()
            : null,
          drawnByParticipantId: p.drawnByParticipantId
            ? p.drawnByParticipantId.toString()
            : null,
        }));

        const engineRules: EngineRule[] = rules.map((r) => ({
          scope: r.scope,
          sourceParticipantId: r.sourceParticipantId
            ? r.sourceParticipantId.toString()
            : null,
          sourceFamilyId: r.sourceFamilyId ? r.sourceFamilyId.toString() : null,
          targetParticipantId: r.targetParticipantId
            ? r.targetParticipantId.toString()
            : null,
          targetFamilyId: r.targetFamilyId ? r.targetFamilyId.toString() : null,
        }));

        const { chosen, reRollCount } = pickWithReRoll(
          participantId,
          engineParticipants,
          engineRules
        );

        const chosenDoc = participants.find(
          (p) => p._id.toString() === chosen.id
        )!;
        const chosenFamily = families.find(
          (f) => f._id.toString() === chosen.familyId
        );

        // 4. Atualiza quem sorteou (com guarda condicional hasDrawn: false)
        const updatedDrawer = await ParticipantModel.findOneAndUpdate(
          {
            _id: drawerDoc._id,
            eventId: event._id,
            hasDrawn: false,
          },
          {
            $set: {
              hasDrawn: true,
              drawnParticipantId: chosenDoc._id,
              pinHash: finalPinHash,
              reRollCount,
              drawnAt: new Date(),
            },
          },
          { returnDocument: "after", session }
        );

        if (!updatedDrawer) {
          throw new AppError(
            "Este participante acabou de realizar o sorteio em outra aba/dispositivo.",
            409,
            "ALREADY_DRAWN"
          );
        }

        // 5. Atualiza quem foi sorteado (com guarda condicional drawnByParticipantId: null)
        const updatedReceiver = await ParticipantModel.findOneAndUpdate(
          {
            _id: chosenDoc._id,
            eventId: event._id,
            drawnByParticipantId: null,
          },
          {
            $set: {
              drawnByParticipantId: drawerDoc._id,
            },
          },
          { returnDocument: "after", session }
        );

        if (!updatedReceiver) {
          throw new AppError(
            "Conflito concorrente detectado ao reservar o participante sorteado.",
            409,
            "CONCURRENT_CONFLICT"
          );
        }

        // 6. Se todos já sortearam, marca o evento como concluído
        const remainingUndrawn = participants.filter(
          (p) => !p.hasDrawn && p._id.toString() !== drawerDoc._id.toString()
        );
        if (remainingUndrawn.length === 0 && event.status !== "completed") {
          await EventModel.updateOne(
            { _id: event._id },
            { $set: { status: "completed", currentRound: "completed" } },
            { session }
          );
        }

        txResult = {
          drawerId: drawerDoc._id.toString(),
          drawerName: drawerDoc.name,
          reRollCount,
          drawSequence: event.drawSequence,
          chosen: mapRevealedFriend(chosenDoc as ParticipantDoc, chosenFamily),
        };
      },
      {
        readPreference: "primary",
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      }
    );

    if (!txResult) {
      throw new AppError("A transação de sorteio não retornou resultado.", 500);
    }

    return txResult;
  } finally {
    await session.endSession();
  }
}

export async function revealParticipantDraw(params: {
  shareToken: string;
  participantId: string;
  pin: string;
}): Promise<{ drawerName: string; chosen: RevealedFriend }> {
  const { shareToken, participantId, pin } = params;

  if (!/^\d{4}$/.test(pin.trim())) {
    throw new AppError("Informe o PIN de 4 dígitos.", 400, "INVALID_PIN_FORMAT");
  }

  if (!mongoose.Types.ObjectId.isValid(participantId)) {
    throw new AppError("Participante inválido.", 400, "INVALID_ID");
  }

  await connectDB();

  const event = await EventModel.findOne({ shareToken }).lean();
  if (!event) {
    throw new AppError("Link de sorteio não encontrado.", 404, "EVENT_NOT_FOUND");
  }

  const drawer = await ParticipantModel.findOne({
    _id: participantId,
    eventId: event._id,
  }).lean();

  if (!drawer) {
    throw new AppError("Participante não encontrado.", 404, "PARTICIPANT_NOT_FOUND");
  }

  if (!drawer.hasDrawn || !drawer.drawnParticipantId) {
    throw new AppError(
      "Você ainda não realizou o sorteio! Use a opção de sortear agora.",
      400,
      "NOT_DRAWN_YET"
    );
  }

  if (!drawer.pinHash) {
    throw new AppError(
      "Seu PIN foi resetado pelo administrador. Cadastre um novo PIN abaixo.",
      403,
      "PIN_RESET_REQUIRED"
    );
  }

  const isPinValid = verifyPin(pin, drawer.pinHash);
  if (!isPinValid) {
    throw new AppError(
      "PIN incorreto! Verifique os 4 dígitos ou peça ajuda ao administrador.",
      401,
      "WRONG_PIN"
    );
  }

  const chosenDoc = await ParticipantModel.findOne({
    _id: drawer.drawnParticipantId,
    eventId: event._id,
  }).lean();

  if (!chosenDoc) {
    throw new AppError("Participante sorteado não encontrado.", 404);
  }

  const chosenFamily = await FamilyModel.findById(chosenDoc.familyId).lean();

  return {
    drawerName: drawer.name,
    chosen: mapRevealedFriend(chosenDoc as ParticipantDoc, chosenFamily),
  };
}

export async function resetPinAndRevealDraw(params: {
  shareToken: string;
  participantId: string;
  newPin: string;
}): Promise<{ drawerName: string; chosen: RevealedFriend }> {
  const { shareToken, participantId, newPin } = params;

  if (!/^\d{4}$/.test(newPin.trim())) {
    throw new AppError("O novo PIN deve conter 4 dígitos numéricos.", 400);
  }

  await connectDB();

  const event = await EventModel.findOne({ shareToken }).lean();
  if (!event) throw new AppError("Sorteio não encontrado.", 404);

  const newHash = hashPin(newPin);
  const updated = await ParticipantModel.findOneAndUpdate(
    {
      _id: participantId,
      eventId: event._id,
      hasDrawn: true,
      pinHash: null,
    },
    { $set: { pinHash: newHash } },
    { returnDocument: "after" }
  ).lean();

  if (!updated || !updated.drawnParticipantId) {
    throw new AppError(
      "Não é possível redefinir o PIN sem autorização do administrador.",
      403
    );
  }

  const chosenDoc = await ParticipantModel.findById(updated.drawnParticipantId).lean();
  if (!chosenDoc) throw new AppError("Participante sorteado não encontrado.", 404);
  const chosenFamily = await FamilyModel.findById(chosenDoc.familyId).lean();

  return {
    drawerName: updated.name,
    chosen: mapRevealedFriend(chosenDoc as ParticipantDoc, chosenFamily),
  };
}

export async function resetAllEventDraws(eventId: string): Promise<void> {
  if (!mongoose.Types.ObjectId.isValid(eventId)) {
    throw new AppError("Evento inválido.", 400);
  }

  await connectDB();
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(
      async () => {
        const event = await EventModel.findOneAndUpdate(
          { _id: eventId },
          {
            $set: { status: "active", currentRound: "round2_draw" },
            $inc: { drawSequence: 1 },
          },
          { returnDocument: "after", session }
        );
        if (!event) throw new AppError("Evento não encontrado.", 404);

        // Reinicia apenas o sorteio da Rodada 2, preservando os links/presentes cadastrados na Rodada 1!
        await ParticipantModel.updateMany(
          { eventId: event._id },
          {
            $set: {
              hasDrawn: false,
              drawnParticipantId: null,
              drawnByParticipantId: null,
              reRollCount: 0,
              drawnAt: null,
            },
          },
          { session }
        );
      },
      {
        readPreference: "primary",
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      }
    );
  } finally {
    await session.endSession();
  }
}
