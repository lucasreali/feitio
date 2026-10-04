export class SwitchTenantDto {
	/** Id of one of the user's active stores (see `tenants` in GET /auth/me). */
	tenantId: string;
}
