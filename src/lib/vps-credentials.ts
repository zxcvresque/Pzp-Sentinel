import { prisma } from "@/lib/db";
import { logCredentialAction } from "@/lib/github-log";
import { encryptSecret, decryptSecret } from "@/lib/secret-crypto";

// Which VpsServer secret columns mirror into the Credentials vault.
// `value` is the stored secret (for the SSH key we mirror the key-file URL,
// matching how the admin card downloads it via `ssh -i <keyfile>`).
type VpsSecretSource = {
  id: string;
  name: string;
  password?: string | null;
  sshKeyFileUrl?: string | null;
};

export const VPS_CRED_SPECS: ReadonlyArray<{
  credKind: string;
  label: string;
  get: (s: VpsSecretSource) => string;
}> = [
  { credKind: "VPS_PASSWORD", label: "Root Password", get: (s) => (s.password ?? "").trim() },
  { credKind: "VPS_SSH_KEY", label: "SSH Private Key", get: (s) => (s.sshKeyFileUrl ?? "").trim() },
];

/**
 * Mirror a VPS server's secrets into linked Credential rows (one per non-empty
 * secret), keyed on (vpsServerId, credKind). Idempotent: updates the existing
 * linked row, creates it if missing, and deletes it if the secret was cleared.
 * The VpsServer columns remain the source of truth; these rows are the
 * shareable, access-controlled view in the vault.
 *
 * IMPORTANT: `server` must carry PLAINTEXT secrets — this function encrypts the
 * stored `Credential.value` itself (AES-256-GCM via secret-crypto).
 */
export async function syncVpsCredentials(
  server: VpsSecretSource,
  createdById: string,
  actorName = "system"
): Promise<void> {
  for (const spec of VPS_CRED_SPECS) {
    const value = spec.get(server); // plaintext
    const existing = await prisma.credential.findFirst({
      where: { vpsServerId: server.id, credKind: spec.credKind },
    });

    if (!value) {
      if (existing) {
        await prisma.credential.delete({ where: { id: existing.id } });
        logCredentialAction({
          action: "VPS_UNLINK",
          userId: createdById,
          userName: actorName,
          entityId: existing.id,
          platform: server.name,
          details: `${spec.label} cleared`,
        }).catch(() => {});
      }
      continue;
    }

    if (existing) {
      if (decryptSecret(existing.value) !== value || existing.platform !== server.name || existing.label !== spec.label) {
        await prisma.credential.update({
          where: { id: existing.id },
          data: { value: encryptSecret(value), platform: server.name, label: spec.label },
        });
      }
    } else {
      const created = await prisma.credential.create({
        data: {
          platform: server.name,
          label: spec.label,
          value: encryptSecret(value),
          // status defaults to APPROVED
          createdById,
          vpsServerId: server.id,
          credKind: spec.credKind,
        },
      });
      logCredentialAction({
        action: "VPS_LINK",
        userId: createdById,
        userName: actorName,
        entityId: created.id,
        platform: server.name,
        details: spec.label,
      }).catch(() => {});
    }
  }
}
