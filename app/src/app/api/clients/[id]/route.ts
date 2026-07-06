import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { guarded } from "@/lib/api";
import { deleteClient, updateClientDetails } from "@/lib/clients";

export const PATCH = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const data = await req.json();
  const client = await updateClientDetails(id, data);
  revalidatePath("/clients");
  return NextResponse.json(client);
});

/** Delete a client: cancels any upcoming bookings' Google events, then removes the record. */
export const DELETE = guarded(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await deleteClient(id);
  revalidatePath("/clients");
  return NextResponse.json({ ok: true });
});
