import { parseArgs } from "node:util";
import { Cpf } from "../domain/cpf.js";
import { Email } from "../domain/email.js";
import { TenantSlug } from "../domain/tenant-slug.js";

export interface CreateStoreInput {
	slug: TenantSlug;
	name: string;
	/** Name and CPF only for a new user; an existing one is found by e-mail. */
	owner: { email: Email; name?: string; cpf?: Cpf };
}

export const USAGE =
	"Usage: pnpm store:create --slug <slug> --name <store name> --owner-email <e-mail> [--owner-name <name> --owner-cpf <cpf>]";

const required = (value: string | undefined, option: string) => {
	if (!value?.trim()) {
		throw new Error(`--${option} is required. ${USAGE}`);
	}
	return value.trim();
};

/** Reads the command line into domain types; throws with a clear message on bad input. */
export function parseCreateStoreArgs(argv: string[]): CreateStoreInput {
	const { values } = parseArgs({
		args: argv,
		options: {
			slug: { type: "string" },
			name: { type: "string" },
			"owner-email": { type: "string" },
			"owner-name": { type: "string" },
			"owner-cpf": { type: "string" },
		},
	});
	const ownerName = values["owner-name"]?.trim();
	const ownerCpf = values["owner-cpf"];
	if (Boolean(ownerName) !== Boolean(ownerCpf)) {
		throw new Error(
			"Give --owner-name and --owner-cpf together, for a new user.",
		);
	}
	return {
		slug: TenantSlug.parse(required(values.slug, "slug")),
		name: required(values.name, "name"),
		owner: {
			email: Email.parse(required(values["owner-email"], "owner-email")),
			...(ownerName && ownerCpf
				? { name: ownerName, cpf: Cpf.parse(ownerCpf) }
				: {}),
		},
	};
}
