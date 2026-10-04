export class CsrfTokenDto {
	/** Send it back in the `x-csrf-token` header on data-changing requests. */
	token: string;
}
