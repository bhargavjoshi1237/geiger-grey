import { createServerClient } from "@supabase/ssr";
import { evaluate } from "@geiger/rbac";
import rbacConfig from "@/geiger-rbac.config";
import { adminClient } from "@/lib/supabase/admin";
import { ApiError } from "./errors.js";
import { toCamel } from "./case.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function bearerToken(request) {
  const header = request?.headers?.get?.("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) throw new ApiError("unauthenticated", 401, "Sign in to continue.");
  return match[1];
}

// Session via cookies (@supabase/ssr) or an Authorization: Bearer token. Pure identity — no
// project/permission checks, so callers can load a resource before deciding what 404 to show.
export async function authenticate(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new ApiError("service_unavailable", 503, "Authentication is unavailable.");

  const token = bearerToken(request); // throws 401 on a malformed (non-Bearer) header
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

function requireData(result, tag) {
  if (result.error) {
    console.error(`[lib/server/auth.${tag}]`, result.error);
    throw new ApiError("service_unavailable", 503, "The service is unavailable.");
  }
  return result.data;
}

// Confirms project membership and evaluates the permission key for an already-authenticated user.
// `notFoundOnDenied` (+ `notFoundMessage`) lets resource-scoped routes collapse "not a member",
// "not permitted" and a malformed/missing project id into the same 404 they give for a missing
// resource, instead of leaking whether that resource exists to a caller who can't access it.
export async function authorize({ admin, user, projectId, key, notFoundOnDenied = false, notFoundMessage = "Not found." }) {
  if (!isUuid(projectId)) {
    throw new ApiError("not_found", 404, notFoundOnDenied ? notFoundMessage : "Project not found.");
  }

  const deny = () => {
    throw notFoundOnDenied
      ? new ApiError("not_found", 404, notFoundMessage)
      : new ApiError("forbidden", 403, "You cannot perform this action.");
  };

  const project = requireData(await admin.schema("public").from("projects")
    .select("id,created_by,organization_id").eq("id", projectId).maybeSingle(), "authorize.project");

  const isMember = project && (!project.organization_id
    ? project.created_by === user.id
    : requireData(await admin.schema("public").from("organization_users")
        .select("user").eq("organization", project.organization_id).eq("user", user.id).maybeSingle(),
        "authorize.membership")?.user === user.id);
  if (!isMember) deny();

  const [rolesResult, grantsResult] = await Promise.all([
    admin.schema("public").from("roles").select("id,project_id,key,name,permissions")
      .eq("project_id", projectId).is("deleted_at", null),
    admin.from("role_grants").select("id,project_id,user_id,role_id,scope,status,deleted_at")
      .eq("project_id", projectId).eq("user_id", user.id).is("deleted_at", null),
  ]);
  const roles = requireData(rolesResult, "authorize.roles").map(toCamel);
  const grants = requireData(grantsResult, "authorize.grants").map(toCamel);

  const decision = evaluate(key, { config: rbacConfig, roles, grants, actorId: user.id });
  if (!decision.allowed) deny();
}

// Composition: authenticate then authorize, for the common "this route is scoped to one
// project and one permission key" case. Resource-scoped routes (provider secret/test) call
// authenticate() and authorize() separately so they can load the resource in between.
export async function requirePermission(request, projectId, key, options = {}) {
  const user = await authenticate(request);
  const admin = adminClient();
  if (!admin) throw new ApiError("service_unavailable", 503, "The service is unavailable.");
  await authorize({ admin, user, projectId, key, ...options });
  return { user, admin };
}
