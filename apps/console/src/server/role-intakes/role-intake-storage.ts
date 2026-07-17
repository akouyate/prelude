import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { ROLE_INTAKE_UPLOAD_URL_TTL_SECONDS } from "../../domain/role-intake-policy";

export type RoleIntakeObjectMetadata = {
  byteSize: number;
  contentType: string | null;
};

export type RoleIntakeStorage = {
  copyObject(input: { fromKey: string; toKey: string }): Promise<void>;
  createUploadUrl(input: {
    contentType: string;
    key: string;
  }): Promise<string>;
  deleteObject(key: string): Promise<void>;
  getObjectBytes(key: string): Promise<Buffer>;
  headObject(key: string): Promise<RoleIntakeObjectMetadata | null>;
};

type RoleIntakeStorageConfig = {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  region: string;
  secretAccessKey: string;
};

let cachedStorage: RoleIntakeStorage | null | undefined;

export function getRoleIntakeStorage(): RoleIntakeStorage | null {
  if (cachedStorage !== undefined) {
    return cachedStorage;
  }

  const config = readStorageConfig();
  cachedStorage = config ? createR2RoleIntakeStorage(config) : null;
  return cachedStorage;
}

export function createR2RoleIntakeStorage(
  config: RoleIntakeStorageConfig,
): RoleIntakeStorage {
  const client = new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint,
    forcePathStyle: true,
    region: config.region,
  });

  return {
    async copyObject({ fromKey, toKey }) {
      await client.send(
        new CopyObjectCommand({
          Bucket: config.bucket,
          CopySource: `${config.bucket}/${encodeCopySourceKey(fromKey)}`,
          Key: toKey,
          MetadataDirective: "COPY",
        }),
      );
    },

    createUploadUrl({ contentType, key }) {
      return getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: config.bucket,
          ContentType: contentType,
          Key: key,
        }),
        { expiresIn: ROLE_INTAKE_UPLOAD_URL_TTL_SECONDS },
      );
    },

    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    },

    async getObjectBytes(key) {
      const response = await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      );
      if (!response.Body) {
        throw new Error("Role intake object did not include a body.");
      }

      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    },

    async headObject(key) {
      try {
        const response = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        );
        return {
          byteSize: response.ContentLength ?? 0,
          contentType: response.ContentType ?? null,
        };
      } catch (error) {
        if (isNotFoundError(error)) {
          return null;
        }
        throw error;
      }
    },
  };
}

export function buildQuarantineObjectKey(input: {
  intakeId: string;
  organizationId: string;
}): string {
  return `role-intakes/quarantine/${input.organizationId}/${input.intakeId}`;
}

export function buildSealedObjectKey(input: {
  intakeId: string;
  organizationId: string;
}): string {
  return `role-intakes/sealed/${input.organizationId}/${input.intakeId}`;
}

function readStorageConfig(): RoleIntakeStorageConfig | null {
  const endpoint = process.env.ROLE_INTAKE_R2_ENDPOINT?.trim();
  const accessKeyId = process.env.ROLE_INTAKE_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.ROLE_INTAKE_R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.ROLE_INTAKE_R2_BUCKET?.trim();

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }

  return {
    accessKeyId,
    bucket,
    endpoint,
    region: process.env.ROLE_INTAKE_R2_REGION?.trim() || "auto",
    secretAccessKey,
  };
}

function encodeCopySourceKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { $metadata?: { httpStatusCode?: number }; name?: string };
  return candidate.$metadata?.httpStatusCode === 404 || candidate.name === "NotFound";
}
