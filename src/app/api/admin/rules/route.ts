import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/mongodb";
import { AppError, handleApiError, requireAdmin } from "@/lib/auth";
import { FamilyModel } from "@/models/Family";
import { ParticipantModel } from "@/models/Participant";
import { RestrictionRuleModel, RULE_SCOPES } from "@/models/RestrictionRule";

const createRulesSchema = z.object({
  eventId: z.string().min(1),
  preset: z.enum(["BLOCK_ALL_SAME_FAMILY"]).optional(),
  scope: z.enum(RULE_SCOPES).optional(),
  sourceParticipantIds: z.array(z.string()).optional().default([]),
  sourceFamilyId: z.string().nullable().optional(),
  targetParticipantIds: z.array(z.string()).optional().default([]),
  targetFamilyId: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireAdmin(req);
    const body = await req.json();
    const data = createRulesSchema.parse(body);

    if (!mongoose.Types.ObjectId.isValid(data.eventId)) {
      throw new AppError("Evento inválido.", 400);
    }

    await connectDB();

    const anyDrawn = await ParticipantModel.exists({
      eventId: data.eventId,
      hasDrawn: true,
    });
    if (anyDrawn) {
      throw new AppError(
        "Já existem sorteios realizados. Reinicie os sorteios antes de alterar as regras.",
        409
      );
    }

    const [families, participants, existingRules] = await Promise.all([
      FamilyModel.find({ eventId: data.eventId }).lean(),
      ParticipantModel.find({ eventId: data.eventId }).lean(),
      RestrictionRuleModel.find({ eventId: data.eventId }).lean(),
    ]);

    const familyMap = new Map(families.map((f) => [f._id.toString(), f]));
    const participantMap = new Map(
      participants.map((p) => [p._id.toString(), p])
    );

    const toInsert: Array<{
      eventId: mongoose.Types.ObjectId;
      scope: (typeof RULE_SCOPES)[number];
      sourceParticipantId?: mongoose.Types.ObjectId | null;
      sourceFamilyId?: mongoose.Types.ObjectId | null;
      targetParticipantId?: mongoose.Types.ObjectId | null;
      targetFamilyId?: mongoose.Types.ObjectId | null;
      description: string;
    }> = [];

    const eventObjId = new mongoose.Types.ObjectId(data.eventId);

    // Atalho: bloquear sorteio dentro da própria família em todas as famílias
    if (data.preset === "BLOCK_ALL_SAME_FAMILY") {
      for (const fam of families) {
        const famId = fam._id.toString();
        const alreadyExists = existingRules.some(
          (r) =>
            r.scope === "FAMILY_TO_FAMILY" &&
            r.sourceFamilyId?.toString() === famId &&
            r.targetFamilyId?.toString() === famId
        );
        if (!alreadyExists) {
          toInsert.push({
            eventId: eventObjId,
            scope: "FAMILY_TO_FAMILY",
            sourceFamilyId: fam._id,
            targetFamilyId: fam._id,
            description: `Integrantes de ${fam.name} não podem tirar ninguém da própria ${fam.name}`,
          });
        }
      }
    } else if (data.scope === "PARTICIPANT_TO_PARTICIPANT") {
      if (
        data.sourceParticipantIds.length === 0 ||
        data.targetParticipantIds.length === 0
      ) {
        throw new AppError(
          "Selecione quem não pode tirar e quem não pode ser tirado.",
          400
        );
      }

      for (const srcId of data.sourceParticipantIds) {
        for (const tgtId of data.targetParticipantIds) {
          if (srcId === tgtId) continue;
          const src = participantMap.get(srcId);
          const tgt = participantMap.get(tgtId);
          if (!src || !tgt) continue;

          const duplicate = existingRules.some(
            (r) =>
              r.scope === "PARTICIPANT_TO_PARTICIPANT" &&
              r.sourceParticipantId?.toString() === srcId &&
              r.targetParticipantId?.toString() === tgtId
          );
          if (duplicate) continue;

          const srcFam = familyMap.get(src.familyId.toString())?.name || "Família";
          const tgtFam = familyMap.get(tgt.familyId.toString())?.name || "Família";

          toInsert.push({
            eventId: eventObjId,
            scope: "PARTICIPANT_TO_PARTICIPANT",
            sourceParticipantId: src._id,
            targetParticipantId: tgt._id,
            description: `${src.name} (${srcFam}) não pode tirar ${tgt.name} (${tgtFam})`,
          });
        }
      }
    } else if (data.scope === "FAMILY_TO_FAMILY") {
      const srcFam = data.sourceFamilyId
        ? familyMap.get(data.sourceFamilyId)
        : null;
      const tgtFam = data.targetFamilyId
        ? familyMap.get(data.targetFamilyId)
        : null;
      if (!srcFam || !tgtFam) {
        throw new AppError("Selecione a família de origem e a família bloqueada.", 400);
      }

      const duplicate = existingRules.some(
        (r) =>
          r.scope === "FAMILY_TO_FAMILY" &&
          r.sourceFamilyId?.toString() === data.sourceFamilyId &&
          r.targetFamilyId?.toString() === data.targetFamilyId
      );
      if (!duplicate) {
        const desc =
          data.sourceFamilyId === data.targetFamilyId
            ? `Integrantes de ${srcFam.name} não podem tirar ninguém da própria ${srcFam.name}`
            : `Integrantes de ${srcFam.name} não podem tirar ninguém de ${tgtFam.name}`;

        toInsert.push({
          eventId: eventObjId,
          scope: "FAMILY_TO_FAMILY",
          sourceFamilyId: srcFam._id,
          targetFamilyId: tgtFam._id,
          description: desc,
        });
      }
    } else if (data.scope === "PARTICIPANT_TO_FAMILY") {
      const tgtFam = data.targetFamilyId
        ? familyMap.get(data.targetFamilyId)
        : null;
      if (data.sourceParticipantIds.length === 0 || !tgtFam) {
        throw new AppError("Selecione os integrantes e a família bloqueada.", 400);
      }

      for (const srcId of data.sourceParticipantIds) {
        const src = participantMap.get(srcId);
        if (!src) continue;
        const duplicate = existingRules.some(
          (r) =>
            r.scope === "PARTICIPANT_TO_FAMILY" &&
            r.sourceParticipantId?.toString() === srcId &&
            r.targetFamilyId?.toString() === data.targetFamilyId
        );
        if (duplicate) continue;
        const srcFam = familyMap.get(src.familyId.toString())?.name || "Família";
        toInsert.push({
          eventId: eventObjId,
          scope: "PARTICIPANT_TO_FAMILY",
          sourceParticipantId: src._id,
          targetFamilyId: tgtFam._id,
          description: `${src.name} (${srcFam}) não pode tirar ninguém de ${tgtFam.name}`,
        });
      }
    } else if (data.scope === "FAMILY_TO_PARTICIPANT") {
      const srcFam = data.sourceFamilyId
        ? familyMap.get(data.sourceFamilyId)
        : null;
      if (!srcFam || data.targetParticipantIds.length === 0) {
        throw new AppError("Selecione a família de origem e os integrantes bloqueados.", 400);
      }

      for (const tgtId of data.targetParticipantIds) {
        const tgt = participantMap.get(tgtId);
        if (!tgt) continue;
        const duplicate = existingRules.some(
          (r) =>
            r.scope === "FAMILY_TO_PARTICIPANT" &&
            r.sourceFamilyId?.toString() === data.sourceFamilyId &&
            r.targetParticipantId?.toString() === tgtId
        );
        if (duplicate) continue;
        const tgtFam = familyMap.get(tgt.familyId.toString())?.name || "Família";
        toInsert.push({
          eventId: eventObjId,
          scope: "FAMILY_TO_PARTICIPANT",
          sourceFamilyId: srcFam._id,
          targetParticipantId: tgt._id,
          description: `Ninguém de ${srcFam.name} pode tirar ${tgt.name} (${tgtFam})`,
        });
      }
    } else {
      throw new AppError("Tipo de regra inválido.", 400);
    }

    if (toInsert.length === 0) {
      return NextResponse.json({
        createdCount: 0,
        message: "Essas regras já estavam cadastradas.",
      });
    }

    const created = await RestrictionRuleModel.insertMany(toInsert);
    return NextResponse.json(
      { createdCount: created.length },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
}
