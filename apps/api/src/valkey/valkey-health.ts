import { Injectable } from "@nestjs/common";
import { Valkey } from "./valkey.js";

@Injectable()
export class ValkeyHealth {
	constructor(private readonly valkey: Valkey) {}

	async isReachable(): Promise<boolean> {
		try {
			return (await this.valkey.ping()) === "PONG";
		} catch {
			return false;
		}
	}
}
