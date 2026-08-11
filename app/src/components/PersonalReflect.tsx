"use client";

import { useRouter } from "next/navigation";
import { Card, useToast } from "./ui";
import { ReflectionComposer } from "./ReflectionComposer";

/**
 * A reflection with no client or session attached — thoughts about the
 * practice as a whole, rather than any one person. Lands in the same shared
 * Doc as every client reflection, headed "Personal" instead of a name.
 */
export function PersonalReflect({ reflectionsDocId }: { reflectionsDocId: string | null }) {
  const router = useRouter();
  const toast = useToast();

  return (
    <div className="flex max-w-[640px] flex-col gap-4 p-5 pb-10 lg:px-[30px] lg:pt-[26px]">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-serif text-[26px] leading-[1.1] lg:text-[28px]">Reflect</h1>
        {reflectionsDocId && (
          <a
            href={`https://docs.google.com/document/d/${reflectionsDocId}/edit`}
            target="_blank"
            rel="noreferrer"
            className="text-[12px] font-semibold text-muted hover:text-clay-text"
          >
            Open reflections doc ›
          </a>
        )}
      </div>
      <p className="max-w-[60ch] text-[13.5px] leading-[1.65] text-muted">
        Not tied to any client — for whatever&apos;s on your mind between sessions. Saved into the same
        &quot;Phoenix session reflections&quot; Doc as your per-client notes, headed{" "}
        <span className="font-semibold text-ink-soft">&quot;Personal&quot;</span> so it&apos;s easy to tell apart.
      </p>

      <Card className="px-5 py-4">
        <ReflectionComposer
          endpoint="/api/reflection"
          placeholder="Whatever's on your mind — for you, not any client's Doc…"
          onSaved={() => {
            router.refresh();
            toast("Saved to your reflections doc ✓");
          }}
        />
      </Card>
    </div>
  );
}
