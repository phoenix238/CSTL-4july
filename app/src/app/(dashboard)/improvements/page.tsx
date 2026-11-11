import { ImprovementNotes } from "@/components/ImprovementNotes";
import { prisma } from "@/lib/db";

export default async function ImprovementsPage() {
  const notes = await prisma.improvementNote.findMany({
    orderBy: [{ doneAt: { sort: "asc", nulls: "first" } }, { createdAt: "desc" }],
  });
  return <ImprovementNotes notes={notes.map(({ id, text, doneAt }) => ({ id, text, done: Boolean(doneAt) }))} />;
}
