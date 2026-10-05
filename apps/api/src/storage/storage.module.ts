import { Module } from "@nestjs/common";
import { configOf } from "../config/config.js";
import { FileStorage } from "./file-storage.js";
import { createS3Client, S3FileStorage } from "./s3-file-storage.js";

@Module({
	providers: [
		{
			provide: FileStorage,
			useFactory: (): FileStorage => {
				const config = configOf("storage");
				return new S3FileStorage(config, createS3Client(config));
			},
		},
	],
	exports: [FileStorage],
})
export class StorageModule {}
