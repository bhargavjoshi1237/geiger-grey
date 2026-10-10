import { createServerClient } from "@supabase/ssr";
import { evaluate } from "@geiger/rbac";
import rbacConfig from "@/geiger-rbac.config";
import { adminClient } from "@/lib/supabase/admin";
import { ApiError } from "./errors.js";

function bearerToken(request) {
  const header = request?.headers?.get?.("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

// Session via cookies (@supabase/ssr) or an Authorization: Bearer token.
async function resolveUser(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new ApiError("service_unavailable", 503, "Authentication is unavailable.");

  const token = bearerToken(request);
  if (!token && !request?.headers?.get?.("cookie")) {
    throw new ApiError("unauthenticated", 401, "Sign in to continue.");
  }

  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  const authClient = createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        for (const { name, value, options } of items) cookieStore.set(name, value, options);
      },
    },
  });

  const { data, error } = token
    ? await authClient.auth.getUser(token)
    : await authClient.auth.getUser();
  if (error || !data?.user?.id) throw new ApiError("unauthenticated", 401, "Sign in to continue.");
  return data.user;
}

const camel = (k) => k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
const toCamelRow = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v]));

function requireData(result) {
  if (result.error) throw new ApiError("service_unavailable", 503, "The service is unavailable.");
  return result.data;
}

// Resolves the session, confirms project membership and evaluates the permission key.
export async function requirePermission(request, projectId, key) {
  const user = await resolveUser(request);
  const admin = adminClient();
  if (!admin) throw new ApiError("service_unavailable", 503, "The service is unavailable.");

  const project = requireData(await admin.schema("public").from("projects")
    .select("id,created_by,organization_id").eq("id", projectId).maybeSingle());

  const isMember = project && (!project.organization_id
    ? project.created_by === user.id
    : requireData(await admin.schema("public").from("organization_users")
        .select("user").eq("organization", project.organization_id).eq("user", user.id).maybeSingle())?.user === user.id);
  if (!isMember) throw new ApiError("forbidden", 403, "You are not a member of this project.");

  const [roleRows, grantRows] = await Promise.all([
    requireData(await admin.schema("public").from("roles")
      .select("id,project_id,key,name,permissions").eq("project_id", projectId).is("deleted_at", null)),
    requireData(await admin.from("role_grants")
      .select("id,project_id,user_id,role_id,scope,status,deleted_at")
      .eq("project_id", projectId).eq("user_id", user.id).is("deleted_at", null)),
  ]);
  const roles = (roleRows ?? []).map(toCamelRow);
  const grants = (grantRows ?? []).map(toCamelRow);

  const decision = evaluate(key, { config: rbacConfig, roles, grants, actorId: user.id });
  if (!decision.allowed) throw new ApiError("forbidden", 403, "You cannot perform this action.");

  return { user, admin };
}
