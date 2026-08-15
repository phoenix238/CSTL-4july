import { redirect } from "next/navigation";

// Today and This week are now one home dashboard at "/". This redirect keeps
// any old bookmarks or in-app links to /week working.
export default function WeekPage() {
  redirect("/");
}
