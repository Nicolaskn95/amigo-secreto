import dotenv from "dotenv";
import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

dotenv.config({ path: ".env.local" });

import { connectDB } from "@/lib/mongodb";
import {
  ADMIN_COOKIE_NAME,
  createAdminSessionToken,
} from "@/lib/auth";
import { POST as createEvent, GET as listEvents } from "@/app/api/admin/events/route";
import {
  GET as getEventDetails,
  PATCH as patchEvent,
  DELETE as deleteEvent,
} from "@/app/api/admin/events/[eventId]/route";
import { POST as createFamily } from "@/app/api/admin/families/route";
import { PUT as updateFamily } from "@/app/api/admin/families/[familyId]/route";
import { POST as createParticipant } from "@/app/api/admin/participants/route";
import { POST as createRules } from "@/app/api/admin/rules/route";
import { GET as getGiftRound } from "@/app/api/public/gifts/[giftToken]/route";
import { PUT as saveGiftItems } from "@/app/api/public/gifts/[giftToken]/items/route";
import { GET as getPublicEvent } from "@/app/api/public/[token]/route";
import { POST as postPublicDraw } from "@/app/api/public/[token]/draw/route";
import { POST as postPublicReveal } from "@/app/api/public/[token]/reveal/route";

function adminReq(url: string, method: string, body?: unknown): NextRequest {
  const token = createAdminSessionToken();
  return new NextRequest(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Cookie: `${ADMIN_COOKIE_NAME}=${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("Fluxo Completo das 2 Rodadas (Presentes + Sorteio) e CRUD Admin", () => {
  let createdEventId = "";

  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    if (createdEventId) {
      await deleteEvent(
        adminReq(`http://localhost:3000/api/admin/events/${createdEventId}`, "DELETE"),
        { params: Promise.resolve({ eventId: createdEventId }) }
      );
    }
    await mongoose.disconnect();
  });

  it("executa 1ª Rodada (links + soma de preços), bloqueia sorteio antecipado, libera 2ª Rodada e entrega pessoa + presentes", async () => {
    // 1. Cria Sorteio (nasce na 1ª Rodada: round1_gifts)
    const evRes = await createEvent(
      adminReq("http://localhost:3000/api/admin/events", "POST", {
        name: "E2E Duas Rodadas Completo",
        maxBudget: 250,
        seedDemo: false,
        createDefaultFamilies: false,
      })
    );
    expect(evRes.status).toBe(201);
    createdEventId = (await evRes.json()).id;

    // 2. CRUD Famílias
    const fam1Res = await createFamily(
      adminReq("http://localhost:3000/api/admin/families", "POST", {
        eventId: createdEventId,
        name: "Familia Temp",
        color: "#2563eb",
      })
    );
    const fam1Id = (await fam1Res.json()).family.id;

    const fam1EditRes = await updateFamily(
      adminReq(`http://localhost:3000/api/admin/families/${fam1Id}`, "PUT", {
        name: "Família 1",
      }),
      { params: Promise.resolve({ familyId: fam1Id }) }
    );
    expect((await fam1EditRes.json()).family.name).toBe("Família 1");

    const fam2Res = await createFamily(
      adminReq("http://localhost:3000/api/admin/families", "POST", {
        eventId: createdEventId,
        name: "Família 2",
        color: "#e11d48",
      })
    );
    const fam2Id = (await fam2Res.json()).family.id;

    // 3. CRUD Integrantes
    const addMember = async (familyId: string, name: string) => {
      const r = await createParticipant(
        adminReq("http://localhost:3000/api/admin/participants", "POST", {
          eventId: createdEventId,
          familyId,
          name,
        })
      );
      expect(r.status).toBe(201);
      return (await r.json()).participant.id as string;
    };

    const pedroId = await addMember(fam1Id, "Tio Pedro");
    const claraId = await addMember(fam1Id, "Tia Clara");
    const paiId = await addMember(fam2Id, "Pai");
    const maeId = await addMember(fam2Id, "Mãe");
    const filhoId = await addMember(fam2Id, "Filho");

    // 4. CRUD Regras: Mãe e Filho não podem tirar o Pai
    const ruleRes = await createRules(
      adminReq("http://localhost:3000/api/admin/rules", "POST", {
        eventId: createdEventId,
        scope: "PARTICIPANT_TO_PARTICIPANT",
        sourceParticipantIds: [maeId, filhoId],
        targetParticipantIds: [paiId],
      })
    );
    expect(ruleRes.status).toBe(201);

    // 5. Obtém tokens das 2 rotas no Admin
    const listRes = await listEvents(
      adminReq("http://localhost:3000/api/admin/events", "GET")
    );
    expect(listRes.status).toBe(200);

    const detailsRes = await getEventDetails(
      adminReq(`http://localhost:3000/api/admin/events/${createdEventId}`, "GET"),
      { params: Promise.resolve({ eventId: createdEventId }) }
    );
    const details = await detailsRes.json();
    expect(details.viability.isValid).toBe(true);
    expect(details.event.currentRound).toBe("round1_gifts");

    const giftToken: string = details.event.giftToken;
    const shareToken: string = details.event.shareToken;
    expect(giftToken).not.toBe(shareToken);

    // 6. Verifica que tentar sortear na Rodada 2 enquanto está na Rodada 1 é bloqueado (403)
    const prematureDraw = await postPublicDraw(
      new NextRequest(`http://localhost:3000/api/public/${shareToken}/draw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: maeId, pin: "4321" }),
      }),
      { params: Promise.resolve({ token: shareToken }) }
    );
    expect(prematureDraw.status).toBe(403);

    // 7. 1ª Rodada: Participantes colocam seus links de presentes e o sistema soma os valores
    const giftRoundGet = await getGiftRound(
      new NextRequest(`http://localhost:3000/api/public/gifts/${giftToken}`),
      { params: Promise.resolve({ giftToken }) }
    );
    expect(giftRoundGet.status).toBe(200);

    for (const pId of [pedroId, claraId, paiId, maeId, filhoId]) {
      const saveRes = await saveGiftItems(
        new NextRequest(
          `http://localhost:3000/api/public/gifts/${giftToken}/items`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              participantId: pId,
              pin: "4321",
              giftHint: "Tamanho M",
              giftItems: [
                {
                  title: "Camiseta Básica",
                  url: "https://lojaexemplo.com.br/camiseta",
                  price: 79.9,
                  scraped: true,
                },
                {
                  title: "Livro de Bolso",
                  url: "https://lojaexemplo.com.br/livro",
                  price: 49.9,
                  scraped: true,
                },
              ],
            }),
          }
        ),
        { params: Promise.resolve({ giftToken }) }
      );
      expect(saveRes.status).toBe(200);
      const savedJson = await saveRes.json();
      expect(savedJson.giftsTotal).toBe(129.8);
      expect(savedJson.giftItems).toHaveLength(2);
    }

    // 8. Admin encerra a 1ª Rodada e libera a 2ª Rodada (Sorteio)
    const switchRes = await patchEvent(
      adminReq(`http://localhost:3000/api/admin/events/${createdEventId}`, "PATCH", {
        action: "set_round",
        currentRound: "round2_draw",
      }),
      { params: Promise.resolve({ eventId: createdEventId }) }
    );
    expect(switchRes.status).toBe(200);

    // 9. Consulta API pública da 2ª Rodada (sem vazar drawnParticipantId)
    const pubRes = await getPublicEvent(
      new NextRequest(`http://localhost:3000/api/public/${shareToken}`),
      { params: Promise.resolve({ token: shareToken }) }
    );
    const pubJson = await pubRes.json();
    expect(pubJson.event.currentRound).toBe("round2_draw");
    expect(pubJson.participants[0].drawnParticipantId).toBeUndefined();

    // 10. Mãe realiza o sorteio na 2ª Rodada usando seu mesmo PIN (4321) e recebe a pessoa + links e soma!
    const drawRes = await postPublicDraw(
      new NextRequest(`http://localhost:3000/api/public/${shareToken}/draw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: maeId, pin: "4321" }),
      }),
      { params: Promise.resolve({ token: shareToken }) }
    );
    expect(drawRes.status).toBe(200);
    const drawJson = await drawRes.json();
    expect(drawJson.chosen.id).not.toBe(paiId);
    expect(drawJson.chosen.id).not.toBe(maeId);
    expect(drawJson.chosen.giftItems).toHaveLength(2);
    expect(drawJson.chosen.giftsTotal).toBe(129.8);

    // 11. Mãe consulta novamente com PIN 4321 e vê os mesmos links dos presentes
    const revealRes = await postPublicReveal(
      new NextRequest(`http://localhost:3000/api/public/${shareToken}/reveal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId: maeId, pin: "4321" }),
      }),
      { params: Promise.resolve({ token: shareToken }) }
    );
    expect(revealRes.status).toBe(200);
    const revealJson = await revealRes.json();
    expect(revealJson.chosen.id).toBe(drawJson.chosen.id);
    expect(revealJson.chosen.giftItems).toHaveLength(2);
    expect(revealJson.chosen.giftsTotal).toBe(129.8);
  });
});
