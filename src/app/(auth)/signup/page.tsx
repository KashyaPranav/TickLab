import { SignupForm } from "./signup-form";
import { authErrorMessage } from "@/lib/auth/errors";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <SignupForm initialError={authErrorMessage(error)} />;
}