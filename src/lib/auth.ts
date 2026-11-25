import crypto from "node:crypto";
import { cookies } from "next/headers";
import { connection, NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

export const ADMIN_COOKIE_NAME = "amigo_secreto_admin";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 dias

export class AppError extends Error {
  statusCode: number;
  code?: string;

  constructor(message: string, statusCode = 400, code?: string) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function getSecret(): string {
  return process.env.AUTH_SECRET || "amigo-secreto-default-secret-key";
}

export function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || "admin123";
}

export function hashPin(pin: string): string {
  const normalized = pin.trim();
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(normalized, salt, 32).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPin(pin: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.includes(":")) return false;
  const [salt, keyHex] = storedHash.split(":");
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(pin.trim(), salt, 32);
  const keyBuf = Buffer.from(keyHex, "hex");
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function createAdminSessionToken(): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `admin:${expiresAt}`;
  const sig = crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("hex");
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function verifyAdminSessionToken(token?: string | null): boolean {
  if (!token) return false;
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const parts = decoded.split(":");
    if (parts.length !== 3) return false;
    const [role, expiresStr, sig] = parts;
    if (role !== "admin") return false;
    const expiresAt = Number(expiresStr);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

    const expectedSig = crypto
      .createHmac("sha256", getSecret())
      .update(`${role}:${expiresStr}`)
      .digest("hex");

    const sigBuf = Buffer.from(sig, "hex");
    const expectedBuf = Buffer.from(expectedSig, "hex");
    if (sigBuf.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expectedBuf);
  } catch {
    return false;
  }
}

export async function isAdminAuthenticated(req?: NextRequest): Promise<boolean> {
  if (req) {
    const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    return verifyAdminSessionToken(token);
  }
  await connection();
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  return verifyAdminSessionToken(token);
}

export async function requireAdmin(req?: NextRequest): Promise<void> {
  const ok = await isAdminAuthenticated(req);
  if (!ok) {
    throw new AppError("Não autorizado. Faça login como administrador.", 401, "UNAUTHORIZED");
  }
}

export function generateShareToken(): string {
  return crypto.randomBytes(6).toString("base64url").toLowerCase();
}

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.statusCode }
    );
  }

  if (error instanceof ZodError) {
    const firstIssue = error.issues[0]?.message || "Dados inválidos.";
    return NextResponse.json(
      { error: firstIssue, issues: error.issues },
      { status: 400 }
    );
  }

  console.error("[API Error]:", error);
  const message =
    error instanceof Error ? error.message : "Erro interno no servidor.";
  return NextResponse.json({ error: message }, { status: 500 });
}
