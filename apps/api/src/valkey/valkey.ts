/**
 * Client for Valkey, the in-memory store. ioredis speaks the same protocol;
 * this alias is also the injection token for the shared client.
 */
export { Redis as Valkey } from "ioredis";
