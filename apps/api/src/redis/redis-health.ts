import { Injectable } from "@nestjs/common";
import { Redis } from "ioredis";

@Injectable()
export class RedisHealth {
	constructor(private readonly redis: Redis) {}

	async isReachable(): Promise<boolean> {
		try {
			return (await this.redis.ping()) === "PONG";
		} catch {
			return false;
		}
	}
}
