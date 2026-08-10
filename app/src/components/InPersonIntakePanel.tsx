"use client";

import { useEffect, useState } from "react";
import { api, Card } from "./ui";
import { IntakeForm } from "./IntakeForm";
import type { IntakeQuestion } from "@/lib/intakeQuestions";
import type { ClientCopy } from "@/lib/clientCopy";

/** The intake form, filled in with the client sitting there rather than sent as a link. */
export function InPersonIntakePanel({
  clientId,
  clientName,
  clientPhone,
  clientEmail,
  questions,
  copy,
  onDone,
}: {
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  questions: IntakeQuestion[];
  copy: ClientCopy;
  onDone: () => void;
}) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ token: string }>(`/api/clients/${clientId}/intake-token`).then((r) => {
      if (!cancelled) setToken(r.token);
    });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (!token) {
    return (
      <Card className="px-5 py-6 text-center text-[13px] text-muted">Loading the intake form…</Card>
    );
  }

  return (
    <IntakeForm
      embedded
      token={token}
      clientName={clientName}
      clientPhone={clientPhone}
      clientEmail={clientEmail}
      alreadyDone={false}
      questions={questions}
      copy={copy}
      onDone={onDone}
    />
  );
}
