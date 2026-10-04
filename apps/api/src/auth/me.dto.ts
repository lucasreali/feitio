export class PanelTenantDto {
	id: string;
	/** Public identifier, sent as X-Tenant to the store routes. */
	slug: string;
	name: string;
	/** `owner` manages the store; `staff` works in it. */
	role: "owner" | "staff";
}

/** The signed-in user and the stores they can open in the panel. */
export class MeDto {
	id: string;
	email: string;
	name: string;
	/** The store the session is working in. */
	activeTenantId: string;
	/** Active stores the user belongs to, oldest membership first. */
	tenants: PanelTenantDto[];
}
