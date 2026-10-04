import { Module } from "@nestjs/common";
import { configError, missingEnv } from "../config/env.js";
import { FileStorage } from "./file-storage.js";
import { createS3Client, S3FileStorage } from "./s3-file-storage.js";

const requiredEnv = {
	endpoint: "STORAGE_ENDPOINT",
	region: "STORAGE_REGION",
	publicBucket: "STORAGE_PUBLIC_BUCKET",
	privateBucket: "STORAGE_PRIVATE_BUCKET",
	accessKeyId: "STORAGE_ACCESS_KEY_ID",
	secretAccessKey: "STORAGE_SECRET_ACCESS_KEY",
	publicUrl: "STORAGE_PUBLIC_URL",
} as const;

@Module({
	providers: [
		{
			provide: FileStorage,
			useFactory: (): FileStorage => {
				const missing = missingEnv(Object.values(requiredEnv));
				if (missing.length > 0) {
					configError(
						`Missing storage environment variables: ${missing.join(", ")}.`,
					);
				}
				const env = (name: string) => process.env[name] as string;
				const config = {
					endpoint: env(requiredEnv.endpoint),
					region: env(requiredEnv.region),
					publicBucket: env(requiredEnv.publicBucket),
					privateBucket: env(requiredEnv.privateBucket),
					accessKeyId: env(requiredEnv.accessKeyId),
					secretAccessKey: env(requiredEnv.secretAccessKey),
					publicUrl: env(requiredEnv.publicUrl),
				};
				return new S3FileStorage(config, createS3Client(config));
			},
		},
	],
	exports: [FileStorage],
})
export class StorageModule {}
