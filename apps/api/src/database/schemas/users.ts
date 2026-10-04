import { sql } from "drizzle-orm";
import {
	check,
	pgPolicy,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import type { Cpf } from "../../domain/cpf.js";
import type { Email } from "../../domain/email.js";
import type { UserId } from "../../domain/ids.js";
import { appRole } from "../roles.js";

/**
 * A person who signs in to the admin panel. Platform row, not a tenant's:
 * one user can belong to several tenants (see memberships).
 */
export const users = pgTable(
	"users",
	{
		id: uuid("id")
			.primaryKey()
			.default(sql`uuid_generate_v7()`)
			.$type<UserId>(),
		/** Always lowercase (Email normalizes it), so `unique` covers every spelling. */
		email: text("email").notNull().unique().$type<Email>(),
		name: text("name").notNull(),
		/** The 11 digits, validated by Cpf; one user per person. */
		cpf: text("cpf").notNull().unique().$type<Cpf>(),
		/** scrypt hash from src/auth/password.ts; the password is never stored. */
		passwordHash: text("password_hash").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(table) => [
		check(
			"users_id_uuid_v7",
			sql`coalesce(uuid_extract_version(${table.id}), 0) = 7`,
		),
		check(
			"users_email_lowercase",
			sql`${table.email} = lower(${table.email})`,
		),
		check("users_cpf_digits", sql`${table.cpf} ~ '^[0-9]{11}$'`),
		// The API reads users to sign them in, before any tenant is known.
		// Users are written by the owner of the tables only, for now.
		pgPolicy("users_app_read", {
			for: "select",
			to: appRole,
			using: sql`true`,
		}),
	],
).enableRLS();
