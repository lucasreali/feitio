/**
 * Client for Valkey, the in-memory store. ioredis speaks the same protocol;
 * this alias is also the injection token for the shared client.
 *
 * SOLID: code depends on the full client, not on a narrower interface.
 * Valkey is a fixed choice and an interface would have one implementation;
 * add one if a second store ever has to sit behind the same code.
 */
export { Redis as Valkey } from "ioredis";
