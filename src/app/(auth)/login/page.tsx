import { LoginForm } from "./login-form";
import { authErrorMessage } from "@/lib/auth/errors";

/**
 * A server component so the code from an OAuth callback redirect survives the
 * round trip; reading `searchParams` on the client would need a Suspense
 * boundary and would still flash the wrong state on first paint.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <LoginForm initialError={authErrorMessage(error)} />;
}