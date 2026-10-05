/** Payments' settings, from the environment. */
export interface PaymentSettings {
	/**
	 * Feitio's part of every payment, in percent.
	 *
	 * ponytail: one fee for every store; plans (P5) will set it per store.
	 */
	feePercent: number;
	/** Where the gateway reaches the API, for webhooks, without the trailing slash. */
	publicApiUrl: string;
}

export const PAYMENT_SETTINGS = Symbol("PAYMENT_SETTINGS");
