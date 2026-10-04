import type { CustomerEventKind } from "../database/schemas/customer-events.js";

export class HistoryUserDto {
	id: string;
	name: string;
}

export class CustomerEventDto {
	id: string;
	/**
	 * `created`, `registered`, `profile_updated`, `password_changed`,
	 * `address_added`, `address_updated`, `address_removed`, `added_to_group`,
	 * `removed_from_group` or `note`.
	 */
	kind: CustomerEventKind;
	/**
	 * Details: `fields` (names of the fields changed), `addressId`, `groupId`
	 * and `groupName`, or `note`.
	 */
	data: Record<string, unknown>;
	/** The panel user who did it; null when the buyer or the system did. */
	user: HistoryUserDto | null;
	createdAt: Date;
}

export class CustomerEventPageDto {
	items: CustomerEventDto[];
	page: number;
	pageSize: number;
	/** Entries in every page. */
	total: number;
}

export class CustomerNoteDto {
	/** 1 to 2000 characters. */
	note: string;
}
