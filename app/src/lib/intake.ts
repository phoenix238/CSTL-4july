import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { appBaseUrl } from "@/lib/appUrl";

/** Ensure the client has a private intake token, creating one on first use. */
export async function getOrCreateIntakeToken(clientId: string): Promise<string> {
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
  if (client.intakeToken) return client.intakeToken;
  const token = randomUUID();
  await prisma.client.update({ where: { id: clientId }, data: { intakeToken: token } });
  return token;
}

/** The full URL a client visits to fill in their intake form. */
export function intakeUrl(settings: { appUrl?: string | null }, token: string): string {
  return `${appBaseUrl(settings)}/intake/${token}`;
}

/** One-tap marketing opt-in link (same private token). */
export function preferencesUrl(settings: { appUrl?: string | null }, token: string): string {
  return `${appBaseUrl(settings)}/preferences/${token}`;
}

/** Ensure this enquiry has a private offer token, creating one on first use. */
export async function getOrCreateOfferToken(enquiryId: string): Promise<string> {
  const enquiry = await prisma.enquiry.findUniqueOrThrow({ where: { id: enquiryId } });
  if (!enquiry.clientId) throw new Error("Link this enquiry to a client before sending an offer email.");
  if (enquiry.offerToken) return enquiry.offerToken;
  const token = randomUUID();
  await prisma.enquiry.update({ where: { id: enquiryId }, data: { offerToken: token } });
  return token;
}

/** The full URL a client visits to pick one of their offered times themselves. */
export function offerUrl(settings: { appUrl?: string | null }, token: string): string {
  return `${appBaseUrl(settings)}/offer/${token}`;
}
