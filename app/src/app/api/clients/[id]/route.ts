import { NextResponse } from "next/server";
import { guarded } from "@/lib/api";
import { updateClientDetails } from "@/lib/clients";

export const PATCH = guarded(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const data = await req.json();
  const client = await updateClientDetails(id, data);
  return NextResponse.json(client);
});
