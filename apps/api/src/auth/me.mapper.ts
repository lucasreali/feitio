import type { TenantId } from "../domain/ids.js";
import type { MeDto } from "./me.dto.js";
import type { ActiveMembership } from "./memberships.repository.js";

interface UserRow {
	id: string;
	email: string;
	name: string;
}

/** The panel's view of a user: never the password hash or the CPF. */
export function toMeDto(
	user: UserRow,
	activeTenantId: TenantId,
	memberships: ActiveMembership[],
): MeDto {
	return {
		id: user.id,
		email: user.email,
		name: user.name,
		activeTenantId,
		tenants: memberships.map((membership) => ({
			id: membership.tenantId,
			slug: membership.slug,
			name: membership.name,
			role: membership.role,
		})),
	};
}
