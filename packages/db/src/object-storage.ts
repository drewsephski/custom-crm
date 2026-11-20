import { z } from "zod";

const YEAR_SECONDS = 365 * 24 * 60 * 60;

export const OBJECT_STORAGE = {
	bucketVariable: "S3_PUBLIC_BUCKET",
	cacheControl: `public, max-age=${YEAR_SECONDS}, immutable`,
} as const;

const setting = z.string().trim().min(1);

const objectStorageEnv = z
	.object({
		AWS_ENDPOINT_URL_S3: z.url(),
		AWS_ACCESS_KEY_ID: setting,
		AWS_SECRET_ACCESS_KEY: setting,
		AWS_REGION: setting,
		S3_PUBLIC_BUCKET: setting,
	})
	.transform((env) => ({
		endpoint: env.AWS_ENDPOINT_URL_S3.replace(/\/+$/, ""),
		region: env.AWS_REGION,
		bucket: env.S3_PUBLIC_BUCKET,
		accessKeyId: env.AWS_ACCESS_KEY_ID,
		secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
	}));

export type ObjectStorageConfig = z.infer<typeof objectStorageEnv>;

export function objectStorageConfig(
	env: NodeJS.ProcessEnv = process.env,
): ObjectStorageConfig | null {
	const parsed = objectStorageEnv.safeParse(env);
	return parsed.success ? parsed.data : null;
}

export function publicObjectUrl(
	config: ObjectStorageConfig,
	key: string,
): string {
	return `${config.endpoint}/${config.bucket}/${key}`;
}

export async function putPublicObject(
	config: ObjectStorageConfig,
	key: string,
	bytes: Buffer,
	contentType: string,
): Promise<string> {
	const { PutObjectCommand, S3Client } = await import("@aws-sdk/client-s3");

	const client = new S3Client({
		endpoint: config.endpoint,
		region: config.region,
		forcePathStyle: true,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		},
	});

	try {
		await client.send(
			new PutObjectCommand({
				Bucket: config.bucket,
				Key: key,
				Body: bytes,
				ContentType: contentType,
				CacheControl: OBJECT_STORAGE.cacheControl,
			}),
		);
	} finally {
		client.destroy();
	}

	return publicObjectUrl(config, key);
}
