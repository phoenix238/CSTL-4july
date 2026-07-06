import { prisma, getSettings } from "@/lib/db";
import { IntakeForm } from "@/components/IntakeForm";
import { ToastProvider } from "@/components/ui";
import { resolveIntakeQuestions } from "@/lib/intakeQuestions";

export const dynamic = "force-dynamic";

export default async function IntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const client = token
    ? await prisma.client.findFirst({
        where: { intakeToken: token },
        select: { id: true, name: true, phone: true, intakeDone: true },
      })
    : null;

  if (!client) {
    return (
      <div className="mx-auto flex min-h-screen max-w-[560px] flex-col items-center justify-center gap-3 px-5 text-center">
        <div className="font-serif text-2xl font-medium">This link has expired</div>
        <p className="text-[14px] text-muted">
          Please ask Phoenix for a fresh intake link. Thank you!
        </p>
      </div>
    );
  }

  const settings = await getSettings();
  const questions = resolveIntakeQuestions(settings.intakeQuestions).filter((q) => q.enabled);

  return (
    <ToastProvider>
      <IntakeForm
        token={token}
        clientName={client.name}
        clientPhone={client.phone}
        alreadyDone={client.intakeDone}
        questions={questions}
      />
    </ToastProvider>
  );
}
