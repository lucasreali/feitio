/**
 * Prepares the services of docker-compose.test.yml for the e2e suite
 * (`pnpm test:e2e:setup`, which starts them first): waits for them, creates
 * the application role, migrates and creates both buckets. Safe to run again.
 */
import { execFileSync } from "node:child_process";
import { createConnection } from "node:net";
import { dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
	CreateBucketCommand,
	PutBucketPolicyCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import pg from "pg";
import { loadTestEnv } from "./test-env.ts";

const apiDir = dirname(import.meta.dirname);
const WAIT_MS = 60_000;

try {
	loadTestEnv(apiDir);
} catch (error) {
	console.error((error as Error).message);
	process.exit(1);
}
const env = process.env as Record<string, string>;

async function waitFor(name: string, ready: () => Promise<unknown>) {
	const deadline = Date.now() + WAIT_MS;
	for (;;) {
		try {
			await ready();
			return;
		} catch (error) {
			if (Date.now() > deadline) {
				console.error(
					`e2e-setup: ${name} did not answer in ${WAIT_MS / 1000} s (${(error as Error).message}). Is docker-compose.test.yml up?`,
				);
				process.exit(1);
			}
			await sleep(1_000);
		}
	}
}

const postgres = async () => {
	const client = new pg.Client({
		connectionString: env.MIGRATION_DATABASE_URL,
	});
	await client.connect();
	await client.end();
};

const storage = async () => {
	const response = await fetch(`${env.STORAGE_ENDPOINT}/health`);
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}
};

const valkey = () => {
	const { hostname, port } = new URL(env.VALKEY_URL);
	return new Promise<void>((resolve, reject) => {
		const socket = createConnection(Number(port || 6379), hostname);
		socket.on("error", reject);
		socket.on("data", (data) => {
			socket.destroy();
			if (data.toString().startsWith("+PONG")) {
				resolve();
			} else {
				reject(new Error(data.toString()));
			}
		});
		socket.write("PING\r\n");
	});
};

await Promise.all([
	waitFor("PostgreSQL", postgres),
	waitFor("storage", storage),
	waitFor("Valkey", valkey),
]);

// Both read .env too, but variables already set (from .env.test) win.
for (const script of ["db:roles", "db:migrate"]) {
	execFileSync("pnpm", [script], { cwd: apiDir, stdio: "inherit" });
}

const s3 = new S3Client({
	endpoint: env.STORAGE_ENDPOINT,
	region: env.STORAGE_REGION,
	credentials: {
		accessKeyId: env.STORAGE_ACCESS_KEY_ID,
		secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
	},
	forcePathStyle: true,
});
for (const bucket of [env.STORAGE_PUBLIC_BUCKET, env.STORAGE_PRIVATE_BUCKET]) {
	try {
		await s3.send(new CreateBucketCommand({ Bucket: bucket }));
	} catch (error) {
		if ((error as Error).name !== "BucketAlreadyOwnedByYou") {
			throw error;
		}
	}
}
await s3.send(
	new PutBucketPolicyCommand({
		Bucket: env.STORAGE_PUBLIC_BUCKET,
		Policy: JSON.stringify({
			Version: "2012-10-17",
			Statement: [
				{
					Effect: "Allow",
					Principal: "*",
					Action: "s3:GetObject",
					Resource: `arn:aws:s3:::${env.STORAGE_PUBLIC_BUCKET}/*`,
				},
			],
		}),
	}),
);
console.log("e2e-setup: test services ready.");
