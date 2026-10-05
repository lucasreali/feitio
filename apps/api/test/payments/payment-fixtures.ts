import type { PanelClient } from "../fixtures.js";

/** A company that receives a store's sales. */
export const testMerchant = {
	name: "Loja da Ana",
	email: "loja@example.com",
	taxId: "11.222.333/0001-81",
	companyType: "MEI",
	phone: "(11) 98888-7777",
	monthlyIncome: 2500000,
	address: {
		street: "Av. Paulista",
		number: "1000",
		neighborhood: "Bela Vista",
		cep: "01310-100",
	},
};

/** Opens the store's payment account through the panel, as its owner. */
export async function openPaymentAccount(owner: PanelClient) {
	const response = await owner.post("/admin/payments/account", testMerchant);
	if (response.statusCode !== 201) {
		throw new Error(`Opening the payment account failed: ${response.body}`);
	}
	return response.json<{ walletId: string }>();
}
