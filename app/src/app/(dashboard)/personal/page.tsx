import { getSettings } from "@/lib/db";
import { PersonalView } from "@/components/PersonalView";

export default async function PersonalPage() {
  const settings = await getSettings();
  return <PersonalView reflectionsDocId={settings.reflectionsDocId || null} />;
}
