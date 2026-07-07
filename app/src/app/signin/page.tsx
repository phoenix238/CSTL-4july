import { redirect } from "next/navigation";
import { auth, signIn } from "@/lib/auth";
import { FlowerOfLife } from "@/components/FlowerOfLife";

export default async function SignInPage() {
  const session = await auth();
  if (session) redirect("/");

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-[20px] border border-line bg-card p-8 text-center shadow-card">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-clay">
          <FlowerOfLife size={36} />
        </div>
        <h1 className="mt-4 font-serif text-2xl font-medium">Phoenix Tanner</h1>
        <div className="mt-1 text-[10px] font-semibold tracking-[0.1em] text-muted">
          CSTL · CRANIOSACRAL
        </div>
        <p className="mt-4 text-[13px] leading-relaxed text-muted">
          Sign in with your Google account to connect Calendar, Drive and Gmail.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="mt-6 w-full cursor-pointer rounded-full bg-clay px-5 py-3 text-sm font-semibold text-cream hover:bg-clay-deep"
          >
            Sign in with Google
          </button>
        </form>
      </div>
    </div>
  );
}
