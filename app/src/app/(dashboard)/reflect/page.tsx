import { getSettings } from "@/lib/db";
import { PersonalReflect } from "@/components/PersonalReflect";

export default async function ReflectPage() {
  const settings = await getSettings();
  return <PersonalReflect reflectionsDocId={settings.reflectionsDocId || null} />;
}
