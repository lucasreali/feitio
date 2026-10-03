import { Module } from "@nestjs/common";
import { FileStorage } from "./file-storage.js";
import { S3FileStorage } from "./s3-file-storage.js";

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
				const missing = Object.values(requiredEnv).filter(
					(name) => !process.env[name],
				);
				if (missing.length > 0) {
					throw new Error(
						`Missing storage environment variables: ${missing.join(", ")}. Copy apps/api/.env.example to apps/api/.env or set them in the environment.`,
					);
				}
				const env = (name: string) => process.env[name] as string;
				return new S3FileStorage({
					endpoint: env(requiredEnv.endpoint),
					region: env(requiredEnv.region),
					publicBucket: env(requiredEnv.publicBucket),
					privateBucket: env(requiredEnv.privateBucket),
					accessKeyId: env(requiredEnv.accessKeyId),
					secretAccessKey: env(requiredEnv.secretAccessKey),
					publicUrl: env(requiredEnv.publicUrl),
				});
			},
		},
	],
	exports: [FileStorage],
})
export class StorageModule {}
