import type { SupabaseClient } from "@supabase/supabase-js";
import { createProject, isSlugTaken, type Project } from "@/lib/projects/store";
import { pickUniqueSlug, toSlug } from "@/lib/projects/slug";

/** 첫 실제 대화에서 문서와 연결할 빈 프로젝트를 만든다. */
export async function createDraftProject(
  client: SupabaseClient,
  { ownerId, name }: { ownerId: string; name: string },
): Promise<Project> {
  const slug = await pickUniqueSlug(toSlug(name), (candidate) => isSlugTaken(client, candidate));
  return createProject(client, { ownerId, name, slug });
}
