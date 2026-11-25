import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import { AppError, handleApiError, hashPin, verifyPin } from "@/lib/auth";
import {
  assertSafePublicUrl,
  roundCurrency,
  sumGiftItems,
} from "@/lib/price-scraper";
import { EventModel } from "@/models/Event";
import { ParticipantModel } from "@/models/Participant";

const authItemsSchema = z.object({
  participantId: z.string().min(1, "Selecione quem é você."),
  pin: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Informe um PIN numérico de exatamente 4 dígitos."),
});

const giftItemInputSchema = z.object({
  title: z.string().trim().min(1, "Informe o nome do produto.").max(160),
  url: z.string().trim().max(1000).optional().default(""),
  price: z.number().min(0, "O valor não pode ser negativo.").max(1_000_000),
  scraped: z.boolean().optional().default(false),
});

const saveItemsSchema = z.object({
  participantId: z.string().min(1),
  pin: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Informe seu PIN de 4 dígitos."),
  giftHint: z.string().trim().max(400).optional().default(""),
  giftItems: z.array(giftItemInputSchema).max(20),
});

async function authenticateRound1Participant(
  giftToken: string,
  participantId: string,
  pin: string
) {
  if (!mongoose.Types.ObjectId.isValid(participantId)) {
    throw new AppError("Participante inválido.", 400);
  }

  await connectDB();

  const event = await EventModel.findOne({ giftToken }).lean();
  if (!event) {
    throw new AppError("Link da rodada de presentes não encontrado.", 404);
  }

  if (event.currentRound && event.currentRound !== "round1_gifts") {
    throw new AppError(
      "A 1ª Rodada de presentes já foi encerrada pelo administrador.",
      403,
      "ROUND_CLOSED"
    );
  }

  const found = await ParticipantModel.findOne({
    _id: participantId,
    eventId: event._id,
  }).lean();

  if (!found) {
    throw new AppError("Participante não encontrado neste sorteio.", 404);
  }

  // Se ainda não tem PIN (1º acesso na Rodada 1 ou resetado pelo Admin), registra agora
  if (!found.pinHash) {
    const newHash = hashPin(pin);
    const updated = await ParticipantModel.findOneAndUpdate(
      { _id: found._id, pinHash: null },
      { $set: { pinHash: newHash } },
      { returnDocument: "after" }
    ).lean();

    if (!updated) {
      throw new AppError(
        "Conflito simultâneo ao registrar PIN. Tente novamente.",
        409
      );
    }
    return { event, participant: updated };
  }

  // Se já tem PIN, confere os 4 dígitos
  if (!verifyPin(pin, found.pinHash)) {
    throw new AppError(
      "PIN incorreto! Digite os 4 dígitos que você criou ou peça ao administrador para resetar.",
      401,
      "WRONG_PIN"
    );
  }

  return { event, participant: found };
}

export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/public/gifts/[giftToken]/items">
) {
  try {
    const { giftToken } = await ctx.params;
    const body = await req.json();
    const { participantId, pin } = authItemsSchema.parse(body);

    const { participant } = await authenticateRound1Participant(
      giftToken,
      participantId,
      pin
    );

    const rawItems = Array.isArray(participant.giftItems)
      ? participant.giftItems
      : [];

    return NextResponse.json({
      participantId: participant._id.toString(),
      name: participant.name,
      giftHint: participant.giftHint || "",
      giftItems: rawItems.map((item, idx) => ({
        id: item._id ? item._id.toString() : `item-${idx}`,
        title: item.title,
        url: item.url || "",
        price: Number(item.price) || 0,
        scraped: Boolean(item.scraped),
      })),
      giftsTotal: Number(participant.giftsTotal) || 0,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(
  req: NextRequest,
  ctx: RouteContext<"/api/public/gifts/[giftToken]/items">
) {
  try {
    const { giftToken } = await ctx.params;
    const body = await req.json();
    const data = saveItemsSchema.parse(body);

    const { participant } = await authenticateRound1Participant(
      giftToken,
      data.participantId,
      data.pin
    );

    const sanitizedItems = data.giftItems.map((item) => {
      let cleanUrl = item.url.trim();
      if (cleanUrl) {
        cleanUrl = assertSafePublicUrl(cleanUrl).toString();
      }
      return {
        title: item.title.trim(),
        url: cleanUrl,
        price: roundCurrency(Math.max(0, Number(item.price) || 0)),
        scraped: Boolean(item.scraped),
      };
    });

    const total = sumGiftItems(sanitizedItems);

    const updated = await ParticipantModel.findByIdAndUpdate(
      participant._id,
      {
        $set: {
          giftHint: data.giftHint.trim(),
          giftItems: sanitizedItems,
          giftsTotal: total,
        },
      },
      { returnDocument: "after" }
    ).lean();

    const savedItems = Array.isArray(updated?.giftItems)
      ? updated!.giftItems
      : [];

    return NextResponse.json({
      ok: true,
      giftHint: updated?.giftHint || "",
      giftItems: savedItems.map((item, idx) => ({
        id: item._id ? item._id.toString() : `item-${idx}`,
        title: item.title,
        url: item.url || "",
        price: Number(item.price) || 0,
        scraped: Boolean(item.scraped),
      })),
      giftsTotal: total,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
