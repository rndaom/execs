import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { UploadWizard } from "./upload-wizard";

export const metadata = { title: "Upload a config" };

export default async function UploadPage() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="mx-auto max-w-md pt-16 text-center">
        <h1 className="font-display text-3xl">Sign in to upload</h1>
        <p className="mt-3 text-ink-muted">
          Uploading configs requires a Steam account so authors get credit for their work.
        </p>
        <p className="mt-6">
          <Link href="/api/auth/steam" className="text-brand underline">
            Sign in through Steam
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div>
      <h1 className="mb-6 font-display text-3xl">Upload a config</h1>
      <UploadWizard />
    </div>
  );
}
